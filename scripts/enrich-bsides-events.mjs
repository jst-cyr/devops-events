#!/usr/bin/env node

/**
 * Enrich BSides event candidates with authoritative data from individual event websites.
 * 
 * Pipeline:
 * 1. Load BSides candidates from events-candidates.json (linked from bsides.org)
 * 2. For each candidate:
 *    a. Fetch the bsides.org event page to find the official event website link
 *    b. Fetch the official website to extract:
 *       - Location: city, region, country, country_code, venue
 *       - Cost: pricing tiers, lowest_price, is_free (verified)
 *       - CFP: cfp_url, cfp_close_date, status
 * 3. Validate data quality (location + cost required, no "Unknown" values)
 * 4. Output:
 *    - bsides-enriched-YYYY-MM-DD.json (ready to merge)
 *    - bsides-enrichment-review-YYYY-MM-DD.json (needs manual review)
 *    - bsides-enrichment-report-YYYY-MM-DD.json (summary)
 * 
 * Usage: node scripts/enrich-bsides-events.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Country code mapping
const COUNTRY_CODE_MAP = {
  'United States': 'US',
  'United Kingdom': 'GB',
  'Canada': 'CA',
  'Australia': 'AU',
  'Germany': 'DE',
  'France': 'FR',
  'Netherlands': 'NL',
  'Sweden': 'SE',
  'Denmark': 'DK',
  'Norway': 'NO',
  'Finland': 'FI',
  'Poland': 'PL',
  'Portugal': 'PT',
  'Spain': 'ES',
  'Italy': 'IT',
  'Brazil': 'BR',
  'India': 'IN',
  'China': 'CN',
  'Japan': 'JP',
  'Singapore': 'SG',
  'Ireland': 'IE',
  'Austria': 'AT',
  'Switzerland': 'CH',
  'Belgium': 'BE',
  'Argentina': 'AR',
  'Mexico': 'MX',
  'New Zealand': 'NZ',
  'Hong Kong': 'HK',
  'South Africa': 'ZA',
  'Greece': 'GR',
  'Israel': 'IL',
  'Czech Republic': 'CZ',
  'Hungary': 'HU',
  'Romania': 'RO',
  'Thailand': 'TH',
  'Malaysia': 'MY',
  'Indonesia': 'ID',
  'Pakistan': 'PK',
  'Nigeria': 'NG',
  'Kenya': 'KE',
  'Colombia': 'CO',
  'Chile': 'CL',
  'Peru': 'PE',
};

// Configuration
const CONFIG = {
  RATE_LIMIT_MS: 1200, // 1.2 seconds between requests (respectful)
  TIMEOUT_MS: 15000,
  RUN_DATE: new Date().toISOString().split('T')[0],
  INPUT_FILE: path.join(PROJECT_ROOT, 'data', 'events-candidates.json'),
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
 * Fetch URL with timeout and error handling
 */
async function fetchWithTimeout(url, timeoutMs = CONFIG.TIMEOUT_MS) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (devops-events enrichment; +https://github.com/devops-events)',
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
 * Extract official event website URL from bsides.org event page
 */
function extractOfficialWebsiteFromBsidesPage(html) {
  if (!html) return null;

  // Look for website link in common patterns
  const patterns = [
    // href with "website" or "official" in text or attribute
    /<a[^>]*href=["']([^"']+)["'][^>]*>(?:\s*<[^>]*>)*\s*(?:website|official|www|visit|event)\s*(?:<[^>]*>)*\s*<\/a>/i,
    // href outside of bsides.org domain
    /<a[^>]*href=["'](?!https?:\/\/(?:www\.)?bsides\.org)([^"']+)["'][^>]*>([^<]*)<\/a>/i,
    // Direct website link pattern
    /(?:website|official|event url)[:\s]+<a[^>]*href=["']([^"']+)["']/i,
    // Schema.org markup
    /"url"\s*:\s*"([^"]+(?<!bsides\.org))"(?=.*"name")/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      let url = match[1];
      // Ensure URL is absolute
      if (url && !url.startsWith('http')) {
        url = 'https://' + url;
      }
      // Verify it's not a bsides.org URL
      if (url && !url.includes('bsides.org')) {
        return url;
      }
    }
  }

  return null;
}

/**
 * Extract location from website or infer from event name
 */
function extractLocation(html, eventName, eventId) {
  const location = {
    city: null,
    region: null,
    country: null,
    country_code: null,
    venue: null,
  };

  if (!html) {
    // Try to infer from event name/ID
    return inferLocationFromName(eventName, eventId, location);
  }

  // Look for common location patterns
  const cityCountryPatterns = [
    // "City, Country" or "City, State, Country"
    /(?:location|venue|at|in)[:\s]*<[^>]*>?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*(?:([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
    // Schema.org addressLocality/addressCountry
    /"addressLocality"\s*:\s*"([^"]+)"[^}]*"addressCountry"\s*:\s*"([A-Z]{2})"/,
    // Address pattern
    /(\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir)),?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s+([A-Z]+)\s+(\d{5}(?:-\d{4})?)/,
  ];

  for (const pattern of cityCountryPatterns) {
    const match = html.match(pattern);
    if (match) {
      location.city = match[1]?.trim() || null;
      if (match[3]) {
        location.country = match[3]?.trim() || null;
        location.country_code = COUNTRY_CODE_MAP[location.country] || null;
        location.region = match[2]?.trim() || null;
      }
      if (match && match[1] && !match[3]) {
        // Only city matched
        location.city = match[1]?.trim() || null;
      }
      if (Object.values(location).some((v) => v)) {
        return location;
      }
    }
  }

  // Fallback: infer from name
  return inferLocationFromName(eventName, eventId, location);
}

/**
 * Infer location from event name or ID
 */
function inferLocationFromName(eventName, eventId, baseLocation = {}) {
  const location = { ...baseLocation };

  // Try to extract city from event name (e.g., "BSides Recife" -> "Recife")
  const nameMatch = (eventName || eventId || '').match(/bsides\s+([a-z]+)/i);
  if (nameMatch) {
    const cityName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
    location.city = cityName;
    location.inferred_from_name = true;
  }

  return location;
}

/**
 * Extract cost information from website
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
    cost.notes = 'No website data available';
    return cost;
  }

  // Look for "free" indicators
  const freePatterns = [/free\s+(?:admission|entry|event|ticket|conference)/i, /no\s+charge/i, /complimentary/i, /gratis/i];

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
    { regex: /(\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:DKK|CHF|BRL|SEK|NOK|CZK)/i, currency: 'OTHER' },
  ];

  let minPrice = null;
  let foundCurrency = null;

  for (const { regex, currency } of pricingPatterns) {
    let match;
    const globalRegex = new RegExp(regex.source, regex.flags + (regex.flags.includes('g') ? '' : 'g'));
    while ((match = globalRegex.exec(html)) !== null) {
      const priceStr = match[1].replace(/[^0-9.,-]/g, '').replace(/[,]/g, '');
      const price = parseFloat(priceStr);
      if (!isNaN(price) && price > 0) {
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
    cost.notes = `Pricing information extracted from event website`;
    cost.found_pricing_info = true;
    return cost;
  }

  // Look for "Coming Soon" or "Not Yet Posted" pricing indicators
  if (/pricing.*coming|price.*soon|tickets.*available.*soon|pricing.*not.*yet/i.test(html)) {
    cost.notes = 'Pricing information coming soon or not yet posted';
    cost.found_pricing_info = true;
    return cost;
  }

  // Default to assumed free
  cost.is_free = true;
  cost.cost_level = 'free';
  cost.notes = 'No pricing information found; assumed free (community event typical pattern)';
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
    { name: 'confab', regex: /https?:\/\/(?:www\.)?confab\.com\/[^\s"'<>]+/i },
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

  // Look for "Call for Papers" or "CFP" text indicating CFP exists
  if (/call\s+for\s+(?:papers|speakers|proposals|sessions)|submit\s+talk|speak|propose|cfp\s+open/i.test(html)) {
    cfp.has_cfp = true;
    cfp.cfp_status = 'open';
  }

  return cfp;
}

/**
 * Enrich a single BSides candidate
 */
async function enrichCandidate(candidate) {
  const result = {
    ...candidate,
    enrichment: {
      attempted: false,
      success: false,
      official_website_url: null,
      location_extracted: false,
      cost_extracted: false,
      cfp_extracted: false,
      extraction_errors: [],
      data_sources: {},
    },
  };

  try {
    result.enrichment.attempted = true;

    // Step 1: Fetch bsides.org event page to find official website
    if (!candidate.event_url || !candidate.event_url.includes('bsides.org')) {
      result.enrichment.extraction_errors.push('Not a bsides.org event URL');
      return result;
    }

    const bsidesResponse = await fetchWithTimeout(candidate.event_url);
    if (!bsidesResponse.ok) {
      result.enrichment.extraction_errors.push(
        `Could not fetch bsides.org page: ${bsidesResponse.status || bsidesResponse.error}`
      );
      // Don't return yet; try with fallback
    } else {
      const officialUrl = extractOfficialWebsiteFromBsidesPage(bsidesResponse.text);
      if (officialUrl) {
        result.enrichment.official_website_url = officialUrl;
        result.enrichment.data_sources.website = officialUrl;
      }
    }

    // Step 2: If we found official website, fetch and extract data
    if (result.enrichment.official_website_url) {
      const websiteResponse = await fetchWithTimeout(result.enrichment.official_website_url);
      if (websiteResponse.ok) {
        const websiteHtml = websiteResponse.text;

        // Extract location
        const location = extractLocation(websiteHtml, candidate.name, candidate.id);
        if (location.city || location.country) {
          result.location = { ...result.location, ...location };
          result.enrichment.location_extracted = true;
        }

        // Extract cost
        const cost = extractCost(websiteHtml, candidate.name);
        if (cost.found_pricing_info) {
          result.cost = { ...result.cost, ...cost };
          result.enrichment.cost_extracted = true;
        }

        // Extract CFP
        const cfpData = extractCFP(websiteHtml, candidate.name);
        if (cfpData.has_cfp) {
          result.cfp = { ...result.cfp, ...cfpData };
          result.enrichment.cfp_extracted = true;
        }

        result.enrichment.success = result.enrichment.location_extracted || result.enrichment.cost_extracted;
      } else {
        result.enrichment.extraction_errors.push(
          `Could not fetch official website: ${websiteResponse.status || websiteResponse.error}`
        );
      }
    } else {
      // Fallback: try to extract from bsides page or infer from name
      if (bsidesResponse.ok) {
        const location = extractLocation(bsidesResponse.text, candidate.name, candidate.id);
        if (location.city || location.country) {
          result.location = { ...result.location, ...location };
          result.enrichment.location_extracted = true;
        }
      }
    }
  } catch (error) {
    result.enrichment.extraction_errors.push(`Enrichment error: ${error.message}`);
  }

  return result;
}

/**
 * Validate candidate against quality thresholds
 */
function validateCandidate(candidate) {
  const issues = [];
  const warnings = [];

  // Check location data - REQUIRED
  if (!candidate.location) {
    issues.push('No location object');
  } else {
    const { city, country, country_code } = candidate.location;
    if (!city || city === 'Unknown' || city === null) {
      issues.push('City missing or "Unknown"');
    }
    if (!country || country === 'Unknown' || country === null) {
      issues.push('Country missing or "Unknown"');
    }
    if (!country_code || country_code === null) {
      issues.push('country_code missing');
    }
  }

  // Check cost data - REQUIRED to be explicit
  if (!candidate.cost) {
    issues.push('No cost data');
  } else {
    if (candidate.cost.is_free === true && candidate.cost.notes?.includes('assumed')) {
      issues.push('is_free=true but "assumed free" (needs verification)');
    }
  }

  // Warnings (not blockers)
  if (!candidate.cfp || !candidate.cfp.has_cfp) {
    warnings.push('No CFP information found');
  }

  if (candidate.enrichment?.location_extracted === false) {
    warnings.push('Location was not extracted from website');
  }

  return {
    passed: issues.length === 0,
    issues,
    warnings,
  };
}

/**
 * Main enrichment pipeline
 */
async function main() {
  console.log('\n🚀 BSides Event Enrichment Pipeline Started\n');
  console.log(`Input file: ${CONFIG.INPUT_FILE}`);
  console.log(`Run date: ${CONFIG.RUN_DATE}\n`);

  // Load candidates
  if (!fs.existsSync(CONFIG.INPUT_FILE)) {
    console.error(`❌ Input file not found: ${CONFIG.INPUT_FILE}`);
    process.exit(1);
  }

  const candidatesData = JSON.parse(fs.readFileSync(CONFIG.INPUT_FILE, 'utf8'));
  const allCandidates = candidatesData.records || [];

  // Filter to BSides events only
  const bsidesCandidates = allCandidates.filter((c) => c.id?.startsWith('bsides-'));

  console.log(`📊 Candidates Summary:`);
  console.log(`   Total in file: ${allCandidates.length}`);
  console.log(`   BSides events: ${bsidesCandidates.length}`);
  console.log(
    `   Missing city: ${bsidesCandidates.filter((c) => !c.location?.city || c.location.city === 'Unknown').length}`
  );
  console.log(
    `   Missing country: ${bsidesCandidates.filter((c) => !c.location?.country || c.location.country === 'Unknown').length}\n`
  );

  // Track results
  const enriched = [];
  const review = [];
  let processed = 0;
  let skipped = 0;

  // Enrich candidates (with rate limiting)
  for (const candidate of bsidesCandidates) {
    process.stdout.write(
      `\rProcessing: ${processed + skipped + 1}/${bsidesCandidates.length} [${processed} enriched, ${skipped} skipped]`
    );

    // Enrich
    const enrichedCandidate = await enrichCandidate(candidate);
    processed++;

    // Validate
    const validation = validateCandidate(enrichedCandidate);
    enrichedCandidate.validation = validation;

    // Route to appropriate output
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
    validation_summary: {
      passed: enriched.length,
      failed: review.length,
      common_issues: {},
      common_warnings: {},
    },
    enrichment_details: {
      with_official_website: bsidesCandidates.filter((c) => c.enrichment?.official_website_url).length,
      location_extracted: enriched.filter((c) => c.enrichment?.location_extracted).length,
      cost_extracted: enriched.filter((c) => c.enrichment?.cost_extracted).length,
      cfp_found: enriched.filter((c) => c.cfp?.has_cfp).length,
    },
  };

  // Count common issues
  for (const candidate of review) {
    if (candidate.validation?.issues) {
      for (const issue of candidate.validation.issues) {
        report.validation_summary.common_issues[issue] =
          (report.validation_summary.common_issues[issue] || 0) + 1;
      }
    }
    if (candidate.validation?.warnings) {
      for (const warning of candidate.validation.warnings) {
        report.validation_summary.common_warnings[warning] =
          (report.validation_summary.common_warnings[warning] || 0) + 1;
      }
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
          notes: 'These events have complete location and cost data and are ready to merge into events.json',
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
          notes: 'These events need manual review before merging (missing location, cost, or other data gaps)',
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
  console.log(`   📊 Enrichment success rate: ${report.summary.success_rate}`);
  console.log(`\n📊 Enrichment Details:`);
  console.log(`   Official websites found: ${report.enrichment_details.with_official_website}`);
  console.log(`   Location data extracted: ${report.enrichment_details.location_extracted}`);
  console.log(`   Cost data extracted: ${report.enrichment_details.cost_extracted}`);
  console.log(`   CFP information found: ${report.enrichment_details.cfp_found}`);
  console.log(`\n📁 Output files:`);
  console.log(`   ✅ ${path.relative(PROJECT_ROOT, CONFIG.OUTPUT_ENRICHED)}`);
  console.log(`   ⚠️  ${path.relative(PROJECT_ROOT, CONFIG.OUTPUT_REVIEW)}`);
  console.log(`   📊 ${path.relative(PROJECT_ROOT, CONFIG.OUTPUT_REPORT)}`);

  if (review.length > 0 && Object.keys(report.validation_summary.common_issues).length > 0) {
    console.log(`\n🔍 Top issues in review queue:`);
    const sortedIssues = Object.entries(report.validation_summary.common_issues)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    for (const [issue, count] of sortedIssues) {
      console.log(`   • ${issue}: ${count} events`);
    }
  }

  console.log('\n✨ Done!\n');
}

main().catch((error) => {
  console.error('❌ Pipeline error:', error);
  process.exit(1);
});
