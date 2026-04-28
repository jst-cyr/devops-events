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

  for (const candidate of candidates) {
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
