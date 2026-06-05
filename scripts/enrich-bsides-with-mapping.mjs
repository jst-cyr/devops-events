#!/usr/bin/env node

/**
 * Enrich BSides event candidates using official website data from the mapping.
 * 
 * Pipeline:
 * 1. Load BSides candidates from events-candidates.json
 * 2. Load website mapping from bsides-website-mapping-YYYY-MM-DD.json
 * 3. For each candidate, look up the official website
 * 4. Fetch the official website to extract:
 *    - Location: city, region, country, country_code (prefer mapping + website data)
 *    - Cost: pricing tiers, lowest_price, is_free (verified)
 *    - CFP: cfp_url, cfp_status
 * 5. Validate data quality (location + cost required, no "Unknown" values)
 * 6. Output enriched and review files
 * 
 * Usage: node scripts/enrich-bsides-with-mapping.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Configuration
const CONFIG = {
  RATE_LIMIT_MS: 1200,
  TIMEOUT_MS: 15000,
  RUN_DATE: new Date().toISOString().split('T')[0],
  INPUT_FILE: path.join(PROJECT_ROOT, 'data', 'events-candidates.json'),
  MAPPING_FILE: path.join(PROJECT_ROOT, 'data', 'bsides-website-mapping-2026-06-05.json'),
  get OUTPUT_ENRICHED() {
    return path.join(PROJECT_ROOT, 'data', `bsides-enriched-${this.RUN_DATE}.json`);
  },
  get OUTPUT_REVIEW() {
    return path.join(PROJECT_ROOT, 'data', `bsides-enrichment-review-${this.RUN_DATE}.json`);
  },
  get OUTPUT_REPORT() {
    return path.join(PROJECT_ROOT, 'data', `bsides-enrichment-report-${this.RUN_DATE}.json`);
  },
};

/**
 * Fetch URL with timeout
 */
async function fetchWithTimeout(url, timeoutMs = CONFIG.TIMEOUT_MS) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (devops-events enrichment)',
      },
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { ok: false, status: response.status, url };
    }
    const text = await response.text();
    return { ok: true, status: response.status, text, url };
  } catch (error) {
    return { ok: false, error: error.message, url };
  }
}

/**
 * Extract cost information from website HTML
 */
function extractCost(html, eventName) {
  const cost = {
    is_free: null,
    lowest_price: null,
    price_currency: null,
    cost_level: null,
    notes: null,
    found_pricing_info: false,
  };

  if (!html) {
    cost.notes = 'No website content available';
    return cost;
  }

  // Look for "free" indicators
  const freePatterns = [
    /free\s+(?:admission|entry|event|ticket|conference)/i,
    /no\s+charge/i,
    /complimentary/i,
    /gratis/i,
  ];

  for (const pattern of freePatterns) {
    if (pattern.test(html)) {
      cost.is_free = true;
      cost.cost_level = 'free';
      cost.notes = 'Free event confirmed on website';
      cost.found_pricing_info = true;
      return cost;
    }
  }

  // Look for pricing patterns
  const pricingPatterns = [
    { regex: /\$\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)\b/g, currency: 'USD' },
    { regex: /€\s*(\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{2})?)\b/g, currency: 'EUR' },
    { regex: /£\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)\b/g, currency: 'GBP' },
    { regex: /R\$\s*(\d{1,4}(?:,\d{3})*(?:,\d{2})?)\b/g, currency: 'BRL' },
    { regex: /CHF\s*(\d{1,4}(?:\.?\d{3})*(?:\.\d{2})?)\b/gi, currency: 'CHF' },
    { regex: /DKK\s*(\d{1,4}(?:\.?\d{3})*(?:\.\d{2})?)\b/gi, currency: 'DKK' },
  ];

  let minPrice = null;
  let foundCurrency = null;

  for (const { regex, currency } of pricingPatterns) {
    let match;
    const globalRegex = new RegExp(regex.source, regex.flags + (regex.flags.includes('g') ? '' : 'g'));
    while ((match = globalRegex.exec(html)) !== null) {
      const priceStr = match[1].replace(/[^0-9.,-]/g, '').replace(/[,]/g, '');
      const price = parseFloat(priceStr);
      if (!isNaN(price) && price > 0 && price < 10000) {
        if (minPrice === null || price < minPrice) {
          minPrice = price;
          foundCurrency = currency;
        }
      }
    }
  }

  if (minPrice !== null) {
    cost.is_free = false;
    cost.lowest_price = Math.round(minPrice * 100) / 100;
    cost.price_currency = foundCurrency;
    cost.cost_level = minPrice < 50 ? 'standard' : minPrice < 150 ? 'premium' : 'ultra-premium';
    cost.notes = `Pricing extracted from website`;
    cost.found_pricing_info = true;
    return cost;
  }

  // Look for "Coming Soon" indicators
  if (/pricing.*coming|price.*soon|tickets.*available.*soon|pricing.*not.*yet/i.test(html)) {
    cost.notes = 'Pricing information not yet published';
    cost.found_pricing_info = true;
    return cost;
  }

  // Default to assumed free (community events often are)
  cost.is_free = true;
  cost.cost_level = 'free';
  cost.notes = 'No pricing information found; assumed free (typical for community-run BSides)';
  return cost;
}

/**
 * Extract CFP information from website
 */
function extractCFP(html, eventName) {
  const cfp = {
    has_cfp: false,
    cfp_url: null,
    cfp_status: 'unknown',
  };

  if (!html) return cfp;

  // Look for CFP platform links
  const cfpPlatforms = [
    { name: 'sessionize', regex: /https?:\/\/sessionize\.com\/[^\s"'<>]+/i },
    { name: 'papercall', regex: /https?:\/\/www\.papercall\.io\/[^\s"'<>]+/i },
    { name: 'pretalx', regex: /https?:\/\/pretalx\.com\/[^\s"'<>]+/i },
  ];

  for (const { name, regex } of cfpPlatforms) {
    const match = html.match(regex);
    if (match) {
      cfp.has_cfp = true;
      cfp.cfp_url = match[0];
      cfp.cfp_status = 'open';
      return cfp;
    }
  }

  // Look for CFP text indicators
  if (/call\s+for\s+(?:papers|speakers|proposals|sessions)|submit\s+(?:talk|proposal)|speak|propose/i.test(html)) {
    cfp.has_cfp = true;
    cfp.cfp_status = 'open';
  }

  return cfp;
}

/**
 * Enrich a single BSides candidate using mapping + website data
 */
async function enrichCandidate(candidate, mapping) {
  const result = {
    ...candidate,
    enrichment: {
      attempted: false,
      success: false,
      from_mapping: false,
      from_website: false,
      official_website_url: null,
      cost_extracted: false,
      cfp_extracted: false,
      errors: [],
    },
  };

  try {
    result.enrichment.attempted = true;

    // Try to find mapping entry using fuzzy matching
    const candidateId = candidate.id?.toLowerCase() || '';
    const candidateName = candidate.name?.toLowerCase() || '';

    // Strategy 1: Exact match on event_id
    let mappingEntry = mapping.events.find((e) => e.event_id.toLowerCase() === candidateId);

    // Strategy 2: Match after stripping suffixes
    if (!mappingEntry) {
      const cleanedId = candidateId
        .replace(/^bsides-/, '')
        .replace(/^bsides/, '')
        .replace(/-2$/, '')
        .replace(/-2026$/, '')
        .replace(/-\d+$/, '')
        .toLowerCase()
        .trim();

      mappingEntry = mapping.events.find((e) => {
        const mappingIdClean = e.event_id
          .toLowerCase()
          .replace(/^bsides-/, '')
          .replace(/-2026$/, '')
          .replace(/-2$/, '')
          .trim();
        return mappingIdClean === cleanedId;
      });
    }

    // Strategy 3: Match on name similarity
    if (!mappingEntry) {
      mappingEntry = mapping.events.find((e) => {
        const eName = e.name?.toLowerCase() || '';
        return eName.includes(candidateName) || candidateName.includes(eName.replace(/bsides\s*/i, ''));
      });
    }

    // Use mapping data for location
    if (mappingEntry) {
      result.enrichment.official_website_url = mappingEntry.official_website;
      result.enrichment.from_mapping = true;

      if (mappingEntry.location.city) {
        result.location = result.location || {};
        result.location.city = mappingEntry.location.city;
        result.location.region = mappingEntry.location.region;
        result.location.country = mappingEntry.location.country;
        result.location.country_code = mappingEntry.location.country_code;
        result.enrichment.success = true;
      }
    }

    // Step 2: Fetch official website for cost and CFP data
    if (result.enrichment.official_website_url) {
      const websiteResponse = await fetchWithTimeout(result.enrichment.official_website_url);
      if (websiteResponse.ok) {
        result.enrichment.from_website = true;
        const html = websiteResponse.text;

        // Extract cost
        const cost = extractCost(html, candidate.name);
        if (cost.found_pricing_info) {
          result.cost = { ...result.cost, ...cost };
          result.enrichment.cost_extracted = true;
        }

        // Extract CFP
        const cfpData = extractCFP(html, candidate.name);
        if (cfpData.has_cfp) {
          result.cfp = { ...result.cfp, ...cfpData };
          result.enrichment.cfp_extracted = true;
        }
      } else {
        result.enrichment.errors.push(`Could not fetch website: ${websiteResponse.status || websiteResponse.error}`);
      }
    } else if (mappingEntry) {
      result.enrichment.errors.push('No official website URL in mapping');
    } else {
      result.enrichment.errors.push('Event not found in mapping');
    }
  } catch (error) {
    result.enrichment.errors.push(`Error: ${error.message}`);
  }

  return result;
}

/**
 * Validate candidate
 */
function validateCandidate(candidate) {
  const issues = [];

  // Check location - REQUIRED
  if (!candidate.location) {
    issues.push('No location data');
  } else {
    if (!candidate.location.city || candidate.location.city === 'Unknown' || candidate.location.city === null) {
      issues.push('City missing or "Unknown"');
    }
    if (!candidate.location.country || candidate.location.country === 'Unknown' || candidate.location.country === null) {
      issues.push('Country missing or "Unknown"');
    }
    if (!candidate.location.country_code || candidate.location.country_code === null) {
      issues.push('country_code missing');
    }
  }

  // Check cost - at least should have some info
  if (!candidate.cost) {
    issues.push('No cost data');
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}

/**
 * Main enrichment pipeline
 */
async function main() {
  console.log('\n🚀 BSides Event Enrichment with Mapping\n');
  console.log(`Input file: ${CONFIG.INPUT_FILE}`);
  console.log(`Mapping file: ${CONFIG.MAPPING_FILE}`);
  console.log(`Run date: ${CONFIG.RUN_DATE}\n`);

  // Load files
  if (!fs.existsSync(CONFIG.INPUT_FILE)) {
    console.error(`❌ Input file not found: ${CONFIG.INPUT_FILE}`);
    process.exit(1);
  }
  if (!fs.existsSync(CONFIG.MAPPING_FILE)) {
    console.error(`❌ Mapping file not found: ${CONFIG.MAPPING_FILE}`);
    process.exit(1);
  }

  const candidatesData = JSON.parse(fs.readFileSync(CONFIG.INPUT_FILE, 'utf8'));
  const mappingData = JSON.parse(fs.readFileSync(CONFIG.MAPPING_FILE, 'utf8'));

  const allCandidates = candidatesData.records || [];
  const bsidesCandidates = allCandidates.filter((c) => c.id?.startsWith('bsides-'));

  console.log(`📊 Candidates Summary:`);
  console.log(`   Total in file: ${allCandidates.length}`);
  console.log(`   BSides events: ${bsidesCandidates.length}`);
  console.log(`   Mapping events: ${mappingData.events.length}\n`);

  // Enrich candidates
  const enriched = [];
  const review = [];

  for (let i = 0; i < bsidesCandidates.length; i++) {
    const candidate = bsidesCandidates[i];
    process.stdout.write(`\rEnriching: ${i + 1}/${bsidesCandidates.length}`);

    const enrichedCandidate = await enrichCandidate(candidate, mappingData);
    const validation = validateCandidate(enrichedCandidate);
    enrichedCandidate.validation = validation;

    if (validation.passed) {
      enriched.push(enrichedCandidate);
    } else {
      review.push(enrichedCandidate);
    }

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, CONFIG.RATE_LIMIT_MS));
  }

  console.log('\n\n✅ Enrichment Complete\n');

  // Generate report
  const report = {
    run_date: CONFIG.RUN_DATE,
    timestamp: new Date().toISOString(),
    summary: {
      total_bsides_candidates: bsidesCandidates.length,
      ready_to_merge: enriched.length,
      needs_review: review.length,
      success_rate: `${Math.round((enriched.length / bsidesCandidates.length) * 100)}%`,
    },
    enrichment_details: {
      found_in_mapping: enriched.filter((c) => c.enrichment?.from_mapping).length +
        review.filter((c) => c.enrichment?.from_mapping).length,
      website_data_fetched: enriched.filter((c) => c.enrichment?.from_website).length +
        review.filter((c) => c.enrichment?.from_website).length,
      cost_data_extracted: enriched.filter((c) => c.enrichment?.cost_extracted).length,
      cfp_data_extracted: enriched.filter((c) => c.enrichment?.cfp_extracted).length,
    },
    common_issues: {},
  };

  // Count common issues
  for (const candidate of review) {
    for (const issue of candidate.validation?.issues || []) {
      report.common_issues[issue] = (report.common_issues[issue] || 0) + 1;
    }
  }

  // Write outputs
  fs.writeFileSync(
    CONFIG.OUTPUT_ENRICHED,
    JSON.stringify(
      {
        metadata: {
          run_date: CONFIG.RUN_DATE,
          timestamp: new Date().toISOString(),
          total_records: enriched.length,
          status: 'ready_to_merge',
          notes: 'These events have complete location data and are ready to merge into events.json',
        },
        records: enriched,
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    CONFIG.OUTPUT_REVIEW,
    JSON.stringify(
      {
        metadata: {
          run_date: CONFIG.RUN_DATE,
          timestamp: new Date().toISOString(),
          total_records: review.length,
          status: 'needs_manual_review',
          notes: 'These events need manual review before merging',
        },
        records: review,
      },
      null,
      2
    )
  );

  fs.writeFileSync(CONFIG.OUTPUT_REPORT, JSON.stringify(report, null, 2));

  // Print results
  console.log(`📋 Results:\n`);
  console.log(`   ✅ Ready to merge: ${enriched.length} events`);
  console.log(`   ⚠️  Needs review: ${review.length} events`);
  console.log(`   📊 Success rate: ${report.summary.success_rate}`);
  console.log(`\n📊 Enrichment Details:`);
  console.log(`   Found in mapping: ${report.enrichment_details.found_in_mapping}`);
  console.log(`   Website data fetched: ${report.enrichment_details.website_data_fetched}`);
  console.log(`   Cost data extracted: ${report.enrichment_details.cost_data_extracted}`);
  console.log(`   CFP data extracted: ${report.enrichment_details.cfp_data_extracted}`);
  console.log(`\n📁 Output files:`);
  console.log(`   ✅ ${path.relative(PROJECT_ROOT, CONFIG.OUTPUT_ENRICHED)}`);
  console.log(`   ⚠️  ${path.relative(PROJECT_ROOT, CONFIG.OUTPUT_REVIEW)}`);
  console.log(`   📊 ${path.relative(PROJECT_ROOT, CONFIG.OUTPUT_REPORT)}\n`);

  if (review.length > 0 && Object.keys(report.common_issues).length > 0) {
    console.log(`🔍 Issues in review queue:`);
    const sorted = Object.entries(report.common_issues).sort((a, b) => b[1] - a[1]);
    for (const [issue, count] of sorted) {
      console.log(`   • ${issue}: ${count} events`);
    }
  }

  console.log('\n✨ Done!\n');
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
