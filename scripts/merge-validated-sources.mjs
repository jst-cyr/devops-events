#!/usr/bin/env node
/**
 * Merge all validated sources into a single file for reconciliation.
 * 
 * Combines:
 * - dev-events-shortlist (Phase 2 agent-filtered)
 * - BSides enriched
 * - USNUA events
 * - TechFieldDay events
 * - NANOG events (if any)
 * 
 * Usage: node scripts/merge-validated-sources.mjs <YYYY-MM-DD>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

const runDate = process.argv[2];
if (!runDate) {
  console.error('Usage: node scripts/merge-validated-sources.mjs <YYYY-MM-DD>');
  process.exit(1);
}

function loadIfExists(filename) {
  const fp = path.join(dataDir, filename);
  if (fs.existsSync(fp)) {
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    return data.records || [];
  }
  return [];
}

// Load all sources
const devEventsShortlist = loadIfExists(`dev-events-shortlist-${runDate}.json`);
const bsidesEnriched = loadIfExists(`bsides-enriched-${runDate}.json`);
const usnuaEvents = loadIfExists(`usnua-events-${runDate}.json`);
const techFieldDay = loadIfExists(`techfieldday-events-${runDate}.json`);
const nanogEvents = loadIfExists(`nanog-events-${runDate}.json`);

console.log('=== SOURCE COUNTS ===');
console.log(`Dev.events shortlist: ${devEventsShortlist.length}`);
console.log(`BSides enriched: ${bsidesEnriched.length}`);
console.log(`USNUA events: ${usnuaEvents.length}`);
console.log(`TechFieldDay events: ${techFieldDay.length}`);
console.log(`NANOG events: ${nanogEvents.length}`);

// Strip canonical-method provenance notes from dev.events enriched records.
// These notes contain the word "embedded" (referring to HTML iframe extraction),
// which falsely triggers the reconcile script's \bembedded\b exclusion regex.
const PROVENANCE_NOTES = [
  'Canonical URL extracted from dev.events embedded iframe src (raw HTML fallback).',
  'Canonical URL extracted via explicit outbound link.',
  'Canonical URL extracted via redirect.',
];

function stripProvenanceNotes(record) {
  if (record.notes && PROVENANCE_NOTES.includes(record.notes)) {
    const cleaned = { ...record };
    // Move provenance to a metadata field, clear notes for reconcile
    cleaned.canonical_notes = cleaned.notes;
    cleaned.notes = null;
    return cleaned;
  }
  return record;
}

// Merge all records
const allRecords = [
  ...devEventsShortlist.map(stripProvenanceNotes),
  ...bsidesEnriched,
  ...usnuaEvents,
  ...techFieldDay,
  ...nanogEvents,
];

console.log(`\nTotal merged records: ${allRecords.length}`);

// Detect records with enrichment errors and write to events-issues.json
const errorRecords = allRecords.filter(r => r.enrichment?.errors?.length > 0);
if (errorRecords.length > 0) {
  const issuesPath = path.join(dataDir, 'events-issues.json');
  let existingIssues = { records: [] };
  try {
    existingIssues = JSON.parse(fs.readFileSync(issuesPath, 'utf-8'));
  } catch (e) { /* file may not exist */ }

  const newIssues = errorRecords.map(r => ({
    source: r.source || (r.id?.startsWith('bsides-') ? 'bsides.org' : 'unknown'),
    discovered_name: r.name,
    discovered_url: r.event_url,
    stage: 'enrichment',
    reason: r.enrichment.errors.join('; '),
    notes: `Official website URL: ${r.enrichment?.official_website_url || 'none'}. Event included as candidate but website could not be verified.`,
  }));

  existingIssues.records.push(...newIssues);
  fs.writeFileSync(issuesPath, JSON.stringify(existingIssues, null, 2) + '\n', 'utf-8');
  console.log(`\n⚠️  Flagged ${newIssues.length} enrichment errors in ${issuesPath}`);
}

// Write merged file
const output = {
  generated_at: new Date().toISOString(),
  source_run_date: runDate,
  sources: {
    dev_events_shortlist: devEventsShortlist.length,
    bsides_enriched: bsidesEnriched.length,
    usnua_events: usnuaEvents.length,
    techfieldday_events: techFieldDay.length,
    nanog_events: nanogEvents.length,
  },
  records: allRecords,
};

const outPath = path.join(dataDir, `discovered-events-${runDate}.json`);
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
console.log(`\nWrote: ${outPath}`);
