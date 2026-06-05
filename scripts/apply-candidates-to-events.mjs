#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

// Utility: Normalize URL for comparison (strip scheme, trailing slash, query params)
function normalizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    let normalized = `${parsed.hostname}${parsed.pathname}`;
    normalized = normalized.toLowerCase().replace(/\/$/, '');
    return normalized;
  } catch (e) {
    return url.toLowerCase().replace(/\/$/, '');
  }
}

// Utility: Simple fuzzy name match (normalize whitespace, case, punctuation)
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s\-–—]+/g, ' ')
    .replace(/[^\w\s]/g, '');
}

// Load files
function loadEvents() {
  const eventPath = path.join(dataDir, 'events.json');
  const text = fs.readFileSync(eventPath, 'utf-8');
  return JSON.parse(text);
}

function loadCandidates() {
  const candidatePath = path.join(dataDir, 'events-candidates.json');
  const text = fs.readFileSync(candidatePath, 'utf-8');
  return JSON.parse(text);
}

// Validate cost object
function validateCost(cost) {
  if (!cost) return { valid: false, reason: 'cost object missing' };
  if (typeof cost.is_free !== 'boolean') {
    return { valid: false, reason: 'cost.is_free is not boolean' };
  }
  if (cost.is_free) {
    if (cost.cost_level !== 'free' && cost.cost_level !== undefined) {
      return { valid: false, reason: 'cost_level should be "free" when is_free=true' };
    }
    return { valid: true };
  } else {
    if (!cost.lowest_price || cost.lowest_price <= 0) {
      return { valid: false, reason: 'cost.lowest_price must be positive when is_free=false' };
    }
    if (!cost.price_currency) {
      return { valid: false, reason: 'cost.price_currency required when is_free=false' };
    }
    return { valid: true };
  }
}

// Validate required fields
function validateRecord(record) {
  const required = ['id', 'name', 'event_url', 'start_date', 'end_date', 'delivery', 'source', 'location'];
  for (const field of required) {
    if (!record[field] || (typeof record[field] === 'string' && record[field].trim() === '')) {
      return { valid: false, reason: `missing or empty required field: ${field}` };
    }
  }

  // Validate dates
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(record.end_date)) {
    return { valid: false, reason: 'dates must be YYYY-MM-DD format' };
  }
  if (record.end_date < record.start_date) {
    return { valid: false, reason: 'end_date cannot be before start_date' };
  }

  // Validate URL
  if (!record.event_url.startsWith('https://')) {
    return { valid: false, reason: 'event_url must be absolute https://' };
  }

  // Validate location
  if (!record.location.country || !record.location.country_code) {
    return { valid: false, reason: 'location.country and country_code required' };
  }

  // Validate delivery + location consistency
  if (record.delivery === 'online') {
    if (!record.location.is_online || record.location.country !== 'Online') {
      return { valid: false, reason: 'online events must have is_online=true and country="Online"' };
    }
    if (record.location.city !== null && record.location.city !== undefined) {
      return { valid: false, reason: 'online events must have city=null' };
    }
  }

  // Validate cost object
  const costValidation = validateCost(record.cost);
  if (!costValidation.valid) {
    return { valid: false, reason: `cost validation: ${costValidation.reason}` };
  }

  return { valid: true };
}

// Check for duplicate
function findDuplicate(candidate, existingRecords) {
  // 1. Check exact event_url
  const normalizedCandidateUrl = normalizeUrl(candidate.event_url);
  const urlMatch = existingRecords.find(r => normalizeUrl(r.event_url) === normalizedCandidateUrl);
  if (urlMatch) {
    return { duplicate: true, key: `event_url: ${urlMatch.event_url}`, record: urlMatch };
  }

  // 2. Check exact id
  const idMatch = existingRecords.find(r => r.id === candidate.id);
  if (idMatch) {
    return { duplicate: true, key: `id: ${idMatch.id}`, record: idMatch };
  }

  // 3. Check fuzzy name + start_date + country
  const normalizedCandidateName = normalizeName(candidate.name);
  const fuzzyMatch = existingRecords.find(r => {
    return (
      normalizeName(r.name) === normalizedCandidateName &&
      r.start_date === candidate.start_date &&
      r.location.country === candidate.location.country
    );
  });
  if (fuzzyMatch) {
    return {
      duplicate: true,
      key: `name+date+country: ${fuzzyMatch.name} (${fuzzyMatch.start_date}, ${fuzzyMatch.location.country})`,
      record: fuzzyMatch,
    };
  }

  return { duplicate: false };
}

// Topic-to-tags mapping for dev.events candidates
const TOPIC_TAGS_MAP = {
  'DevOps': ['devops'],
  'Docker / Kubernetes': ['kubernetes', 'containers', 'cloud-native'],
  'Cloud': ['cloud'],
  'Azure': ['cloud', 'azure'],
  'AWS': ['cloud', 'aws'],
  'SRE': ['sre'],
  'Linux / OS': ['linux', 'sysadmin'],
  'BSD / OS': ['bsd', 'sysadmin'],
  'Cybersecurity / InfoSec': ['security'],
  'Open Source': ['open-source'],
  'Serverless': ['cloud', 'serverless'],
  'Tech': ['devops'],
  'Artificial Intelligence (AI)': ['ai', 'devops'],
};

// Country name to ISO 3166-1 alpha-2 code
const COUNTRY_CODE_MAP = {
  'United States': 'US', 'Canada': 'CA', 'United Kingdom': 'GB', 'Germany': 'DE',
  'France': 'FR', 'Netherlands': 'NL', 'Belgium': 'BE', 'Denmark': 'DK',
  'Norway': 'NO', 'Sweden': 'SE', 'Austria': 'AT', 'Switzerland': 'CH',
  'Italy': 'IT', 'Spain': 'ES', 'Portugal': 'PT', 'Ireland': 'IE',
  'Poland': 'PL', 'Hungary': 'HU', 'Japan': 'JP', 'Australia': 'AU',
  'New Zealand': 'NZ', 'India': 'IN', 'Indonesia': 'ID', 'Hong Kong': 'HK',
  'Online': 'XX', 'Russia': 'RU',
};

// Generate a slug-style id from event name and start_date
function generateId(name, startDate) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const year = startDate ? startDate.substring(0, 4) : '';
  // Avoid appending year if slug already ends with the year
  if (slug.endsWith(year)) return slug;
  return `${slug}-${year}`;
}

// Normalize a candidate record to conform to EventRecord schema
function normalizeCandidate(record) {
  const r = { ...record };

  // Generate id if missing
  if (!r.id) {
    r.id = generateId(r.name, r.start_date);
  }

  // Set source if missing
  if (!r.source) {
    if (r.dev_events_slug || r.dev_events_url) {
      r.source = 'dev.events';
    } else if (r.id?.startsWith('bsides-')) {
      r.source = 'bsides.org';
    } else {
      r.source = 'unknown';
    }
  }

  // Set delivery if missing
  if (!r.delivery) {
    if (r.location?.is_online) {
      // Check if it also has a city (hybrid)
      r.delivery = r.location.city ? 'hybrid' : 'online';
    } else {
      r.delivery = 'in_person';
    }
  }

  // Fix location for online events
  if (r.delivery === 'online') {
    r.location = r.location || {};
    r.location.is_online = true;
    r.location.city = null;
    r.location.country = 'Online';
    r.location.country_code = 'XX';
  }

  // Fix location for hybrid events
  if (r.delivery === 'hybrid') {
    r.location = r.location || {};
    r.location.is_online = true;
    // Keep city/country for hybrid; fix country to strip "and Online" suffixes
    if (r.location.country) {
      r.location.country = r.location.country.replace(/\s+and\s+Online$/i, '').trim();
    }
    // Resolve country_code if missing
    if (!r.location.country_code && r.location.country) {
      r.location.country_code = COUNTRY_CODE_MAP[r.location.country] || null;
    }
  }

  // Resolve country_code if missing for in_person
  if (r.delivery === 'in_person' && !r.location?.country_code && r.location?.country) {
    r.location.country_code = COUNTRY_CODE_MAP[r.location.country] || null;
  }

  // Set tags if missing
  if (!r.tags && r.topic) {
    r.tags = TOPIC_TAGS_MAP[r.topic] || ['devops'];
  }

  // Set cost if missing — assume free per data model unknown pricing rule
  if (!r.cost) {
    r.cost = {
      is_free: true,
      cost_level: 'free',
      notes: 'Pricing not verified; assumed free until confirmed.',
    };
  } else {
    // Fix null is_free — apply unknown pricing rule
    if (r.cost.is_free === null || r.cost.is_free === undefined) {
      r.cost.is_free = true;
      r.cost.cost_level = 'free';
      r.cost.lowest_price = null;
      if (!r.cost.notes) r.cost.notes = 'Pricing not verified; assumed free until confirmed.';
    }
    // Clean up null price_currency when free
    if (r.cost.is_free && r.cost.price_currency === null) {
      delete r.cost.price_currency;
    }
    // Clean up found_pricing_info (not part of EventRecord schema)
    delete r.cost.found_pricing_info;
  }

  // Fix http:// URLs to https://
  if (r.event_url && r.event_url.startsWith('http://')) {
    r.event_url = r.event_url.replace('http://', 'https://');
  }

  // Set event_type if missing
  if (!r.event_type) {
    r.event_type = 'conference';
  }

  // Clean up dev.events-specific fields that don't belong in events.json
  delete r.dev_events_slug;
  delete r.dev_events_url;
  delete r.topic;
  delete r.canonical_method;
  delete r.canonical_notes;
  delete r.enrichment;
  delete r.validation;
  delete r.continent;
  if (r.location) delete r.location.continent;

  return r;
}

// Main merge workflow
async function mergeEvents() {
  console.log('[MERGE] Loading events.json and events-candidates.json...');
  const eventsData = loadEvents();
  const candidatesData = loadCandidates();

  const existingRecords = eventsData.records || [];
  const candidates = candidatesData.records || [];

  console.log(`[MERGE] Existing records: ${existingRecords.length}`);
  console.log(`[MERGE] Candidates to process: ${candidates.length}`);

  const inserted = [];
  const skipped = [];

  for (const rawCandidate of candidates) {
    // Normalize candidate to EventRecord schema
    const candidate = normalizeCandidate(rawCandidate);
    console.log(`[MERGE] Processing: ${candidate.id}...`);

    // Check validation first
    const validation = validateRecord(candidate);
    if (!validation.valid) {
      skipped.push({
        name: candidate.name,
        id: candidate.id,
        reason: 'invalid',
        detail: validation.reason,
      });
      console.log(`  ✗ Invalid: ${validation.reason}`);
      continue;
    }

    // Check for duplicate
    const dupResult = findDuplicate(candidate, existingRecords);
    if (dupResult.duplicate) {
      skipped.push({
        name: candidate.name,
        id: candidate.id,
        reason: 'duplicate',
        detail: dupResult.key,
      });
      console.log(`  ✗ Duplicate: ${dupResult.key}`);
      continue;
    }

    // Record passes all checks; insert
    existingRecords.push(candidate);
    inserted.push(candidate.id);
    console.log(`  ✓ Inserted`);
  }

  // Write updated events.json
  const updatedEvents = {
    ...eventsData,
    records: existingRecords,
  };

  const eventsPath = path.join(dataDir, 'events.json');
  fs.writeFileSync(eventsPath, JSON.stringify(updatedEvents, null, 2) + '\n', 'utf-8');
  console.log(`\n[WRITE] Updated data/events.json with ${existingRecords.length} total records`);

  // Report
  console.log('\n=== MERGE SUMMARY ===');
  console.log(`Candidates processed: ${candidates.length}`);
  console.log(`Inserted: ${inserted.length}`);
  console.log(`Skipped: ${skipped.length}`);

  if (inserted.length > 0) {
    console.log('\n=== INSERTED RECORDS ===');
    inserted.forEach(id => console.log(`  • ${id}`));
  }

  if (skipped.length > 0) {
    console.log('\n=== SKIPPED RECORDS ===');
    skipped.forEach(s => {
      console.log(`  • ${s.name} (${s.id})`);
      console.log(`    Reason: ${s.reason}`);
      console.log(`    Detail: ${s.detail}`);
    });
  }

  console.log('\n[SUCCESS] Merge completed.');
}

mergeEvents().catch(err => {
  console.error('[ERROR]', err.message);
  process.exit(1);
});
