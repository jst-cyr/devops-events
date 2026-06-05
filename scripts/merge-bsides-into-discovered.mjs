#!/usr/bin/env node
/**
 * Replaces raw BSides records in discovered-events-<date>.json with enriched
 * BSides records from bsides-enriched-<date>.json. Strips enrichment/validation
 * metadata before merging so reconcile-events.py sees clean input.
 *
 * Usage:
 *   node scripts/merge-bsides-into-discovered.mjs [run-date]
 *   node scripts/merge-bsides-into-discovered.mjs 2026-06-05
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

const runDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

const discoveredPath = path.join(dataDir, `discovered-events-${runDate}.json`);
const enrichedPath = path.join(dataDir, `bsides-enriched-${runDate}.json`);

if (!fs.existsSync(discoveredPath)) {
  console.error(`[ERROR] Not found: ${discoveredPath}`);
  process.exit(1);
}
if (!fs.existsSync(enrichedPath)) {
  console.error(`[ERROR] Not found: ${enrichedPath}`);
  process.exit(1);
}

const discovered = JSON.parse(fs.readFileSync(discoveredPath, 'utf-8'));
const enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'));

const rawBsidesCount = discovered.records.filter((r) => r.source === 'bsides.org').length;

// Strip pipeline-internal metadata that reconcile-events.py doesn't need
function stripMetadata(record) {
  const clean = { ...record };
  delete clean.enrichment;
  delete clean.validation;
  return clean;
}

const nonBsides = discovered.records.filter((r) => r.source !== 'bsides.org');
const enrichedBsides = enriched.records.map(stripMetadata);

const merged = {
  ...discovered,
  generated_at: new Date().toISOString().replace('+00:00', 'Z'),
  records: [...nonBsides, ...enrichedBsides],
};

fs.writeFileSync(discoveredPath, JSON.stringify(merged, null, 2));

console.log(`[MERGE] ${discoveredPath}`);
console.log(`  Non-BSides records kept: ${nonBsides.length}`);
console.log(`  Raw BSides removed:      ${rawBsidesCount}`);
console.log(`  Enriched BSides added:   ${enrichedBsides.length}`);
console.log(`  Total output records:    ${merged.records.length}`);
