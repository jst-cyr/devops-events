#!/usr/bin/env node
/**
 * Phase 2: Agent Relevance Filter
 * 
 * Applies geographic filtering, topic-based auto-include/exclude,
 * and outputs ambiguous records for agent name-level review.
 * 
 * Usage: node scripts/phase2-relevance-filter.mjs <YYYY-MM-DD>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const configDir = path.join(__dirname, '..', 'config');

const runDate = process.argv[2];
if (!runDate) {
  console.error('Usage: node scripts/phase2-relevance-filter.mjs <YYYY-MM-DD>');
  process.exit(1);
}

// Load data
const devEvents = JSON.parse(fs.readFileSync(path.join(dataDir, `dev-events-${runDate}.json`), 'utf-8'));
const geoConfig = JSON.parse(fs.readFileSync(path.join(configDir, 'excluded-geographies.json'), 'utf-8'));
const existingEvents = JSON.parse(fs.readFileSync(path.join(dataDir, 'events.json'), 'utf-8'));

const excludedCountries = new Set([
  ...geoConfig.excluded_countries.map(c => c.toLowerCase()),
  ...geoConfig.excluded_africa_countries.map(c => c.toLowerCase()),
]);
const excludedGeoTokens = new Set(geoConfig.excluded_geo_tokens.map(t => t.toLowerCase()));

// Topics clearly in-scope for DevOps/SRE/infrastructure
const includeTopics = new Set([
  'DevOps', 'Docker / Kubernetes', 'SRE', 'Cloud', 'AWS', 'Azure',
  'Linux / OS', 'Operating Systems / OS', 'Serverless', 'Cybersecurity / InfoSec',
]);

// Topics clearly out-of-scope
const excludeTopics = new Set([
  'Crypto / Blockchain', 'Web3', 'PHP', 'Symfony', 'Laravel', 'Drupal', 'WordPress',
  'Fintech', 'HR / Hiring / Recruiting', 'UI / UX', 'Product management',
  'Ruby', 'Ruby on Rails', 'Game dev', 'Salesforce', 'Angular', 'React', 'Flutter',
  'SAP', 'AR / VR / XR', 'Startup', 'Business Analysis', 'Android', 'iOS / Swift',
  'Mobile', 'MongoDB', 'Postgres', 'SQL', 'Data / Database', 'C/C++',
  'Haskell', 'Clojure', 'Scala', 'Kotlin', 'Elixir', 'DDD',
  'Scrum', 'Project management / PMO', 'Functional programming', 'Hardware / IoT',
  'Java', 'JavaScript', '.NET', 'Python', 'Data Science', 'Web / Frontend',
  'Full-stack', 'Agile', 'CIO', 'CTO', 'Machine Learning (ML)', 'Apple', 'Django',
]);

// Build existing event signatures for dedup
const existingSigs = new Set();
const existingUrls = new Set();
for (const e of existingEvents.records) {
  const name = (e.name || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  const date = e.start_date || '';
  const country = (e.location?.country || '').toLowerCase().trim();
  existingSigs.add(`${name}|${date}|${country}`);
  if (e.event_url) existingUrls.add(e.event_url.toLowerCase().replace(/\/$/, ''));
}

// Counters
const stats = {
  total: devEvents.records.length,
  excluded_geography: 0,
  excluded_topic: 0,
  excluded_relevance_name: 0,
  already_tracked: 0,
  shortlisted: 0,
};

const shortlisted = [];
const excludedDetails = { geography: [], topic: [], relevance: [], tracked: [] };
const ambiguousForReview = [];

for (const r of devEvents.records) {
  const country = (r.location?.country || '').toLowerCase().trim();
  const city = (r.location?.city || '').toLowerCase().trim();

  // 1. Geographic filter
  if ((country && excludedCountries.has(country)) || (city && excludedGeoTokens.has(city))) {
    stats.excluded_geography++;
    excludedDetails.geography.push({ name: r.name, country: r.location?.country, city: r.location?.city });
    continue;
  }

  // 2. Topic filter
  const topic = r.topic || '';
  if (excludeTopics.has(topic)) {
    stats.excluded_topic++;
    excludedDetails.topic.push({ name: r.name, topic });
    continue;
  }

  // 3. Already-tracked check
  const normName = (r.name || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  const sig = `${normName}|${r.start_date || ''}|${country}`;
  const normUrl = (r.event_url || '').toLowerCase().replace(/\/$/, '');
  if (existingSigs.has(sig) || existingUrls.has(normUrl)) {
    stats.already_tracked++;
    excludedDetails.tracked.push({ name: r.name, start_date: r.start_date });
    continue;
  }

  // 4. Auto-include or flag for review
  if (includeTopics.has(topic)) {
    shortlisted.push(r);
    stats.shortlisted++;
  } else {
    // Ambiguous topic - needs name-level review
    ambiguousForReview.push(r);
  }
}

console.log('=== PHASE 2: RELEVANCE FILTER RESULTS ===');
console.log(`Total extracted: ${stats.total}`);
console.log(`Excluded by geography: ${stats.excluded_geography}`);
console.log(`Excluded by topic: ${stats.excluded_topic}`);
console.log(`Already tracked: ${stats.already_tracked}`);
console.log(`Auto-included (in-scope topics): ${stats.shortlisted}`);
console.log(`Ambiguous (needs name review): ${ambiguousForReview.length}`);
console.log('');

// Output ambiguous records for agent review
console.log('=== AMBIGUOUS RECORDS FOR NAME-LEVEL REVIEW ===');
const ambiguousByTopic = {};
for (const r of ambiguousForReview) {
  const t = r.topic || '(none)';
  if (!ambiguousByTopic[t]) ambiguousByTopic[t] = [];
  ambiguousByTopic[t].push(r);
}

for (const [topic, records] of Object.entries(ambiguousByTopic).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n--- ${topic} (${records.length}) ---`);
  for (const r of records) {
    console.log(`  ${r.name} | ${r.location?.city || '?'}, ${r.location?.country || '?'} | ${r.start_date}`);
  }
}

// Write auto-included shortlist and ambiguous for review
const shortlistOutput = {
  generated_at: new Date().toISOString(),
  source_file: `data/dev-events-${runDate}.json`,
  stats,
  ambiguous_count: ambiguousForReview.length,
  records: shortlisted,
};

fs.writeFileSync(
  path.join(dataDir, `dev-events-auto-included-${runDate}.json`),
  JSON.stringify(shortlistOutput, null, 2) + '\n',
  'utf-8'
);

const ambiguousOutput = {
  generated_at: new Date().toISOString(),
  source_file: `data/dev-events-${runDate}.json`,
  count: ambiguousForReview.length,
  records: ambiguousForReview,
};

fs.writeFileSync(
  path.join(dataDir, `dev-events-ambiguous-${runDate}.json`),
  JSON.stringify(ambiguousOutput, null, 2) + '\n',
  'utf-8'
);

console.log(`\nWrote auto-included: data/dev-events-auto-included-${runDate}.json (${shortlisted.length} records)`);
console.log(`Wrote ambiguous: data/dev-events-ambiguous-${runDate}.json (${ambiguousForReview.length} records)`);
