#!/usr/bin/env node
/**
 * Phase 2 + Phase 5 Combined: Agent Relevance Filter with Name-Level Review
 * 
 * Applies geographic, topic, name-level, and already-tracked filtering
 * to produce a validated shortlist from the enriched dev.events file.
 * 
 * Agent judgments on ambiguous topics are encoded as whitelists below.
 * 
 * Usage: node scripts/phase2-agent-shortlist.mjs <YYYY-MM-DD>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const configDir = path.join(__dirname, '..', 'config');

const runDate = process.argv[2];
if (!runDate) {
  console.error('Usage: node scripts/phase2-agent-shortlist.mjs <YYYY-MM-DD>');
  process.exit(1);
}

// Load data
const enrichedFile = path.join(dataDir, `dev-events-enriched-${runDate}.json`);
const enriched = JSON.parse(fs.readFileSync(enrichedFile, 'utf-8'));
const geoConfig = JSON.parse(fs.readFileSync(path.join(configDir, 'excluded-geographies.json'), 'utf-8'));
const existingEvents = JSON.parse(fs.readFileSync(path.join(dataDir, 'events.json'), 'utf-8'));

const excludedCountries = new Set([
  ...geoConfig.excluded_countries.map(c => c.toLowerCase()),
  ...geoConfig.excluded_africa_countries.map(c => c.toLowerCase()),
]);
const excludedGeoTokens = new Set(geoConfig.excluded_geo_tokens.map(t => t.toLowerCase()));

// ─── Topic classifications ─────────────────────────────────────────────
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

// ─── Agent name-level whitelist for ambiguous topics ────────────────────
// These are specific events from ambiguous topics that agent judgment determined
// are relevant to DevOps/SRE/infrastructure operations.
//
// Matching is case-insensitive substring match against event name.
const ambiguousKeepNames = [
  // AI topic — security/infrastructure AI only
  'Confidential Computing Summit',
  'Offensive AI Con',
  'AI Security Summit',
  'Data Centre Expo',
  'Open Source Observability Day',
  'Civo Navigate',

  // Microsoft topic — infrastructure-focused MS events
  'Experts Live UK',
  'Experts Live Austria',
  'Experts Live Sweden',
  'TechMentor',
  'Cybersecurity Live',
  'Nordic Integration Summit',

  // Tech topic — infrastructure-relevant
  'S2N: Storage Server Network',
  'Open Tech Day',    // Software-defined Storage
  'Feature Flags',
  'KeyCloakCon',

  // Open Source topic — security/monitoring
  'European Open Source Security Forum',
  'OWASP Global AppSec',
  'Open Source Monitoring Conference',
  'All Things Open',

  // Tech leadership — DevOps org patterns
  'Fast Flow Conf',

  // Software architecture — performance/SRE
  'P99 CONF',

  // BSD / OS — sysadmin/infrastructure
  'BSDCan',
  'EuroBSDCon',
];

// ─── Name-level EXCLUSION list (overrides auto-include topics) ──────────
// Events that have an in-scope topic classification but are actually out-of-scope.
// Applied AFTER topic auto-include, catching misclassified events.
const alwaysExcludeNames = [
  // Gartner executive/analyst events (not practitioner conferences)
  'Gartner',

  // Web3/crypto events misclassified under Cybersecurity
  'Neocypherpunk',
  'web3',

  // CMS events misclassified
  'Umbraco',

  // Marketing/CEO events in cybersecurity space
  'CyberMarketingCon',
  'CyberCEO',

  // General dev conferences without DevOps/SRE focus
  'Carolina Code Conference',

  // Vendor-specific product roadshows (not practitioner conferences)
  'Nutanix',
  '.NEXT on Tour',
];

const alwaysExcludePatterns = alwaysExcludeNames.map(n => n.toLowerCase());

function isAlwaysExclude(name, eventUrl) {
  const lowerName = (name || '').toLowerCase();
  const lowerUrl = (eventUrl || '').toLowerCase();
  return alwaysExcludePatterns.some(pattern =>
    lowerName.includes(pattern) || lowerUrl.includes(pattern)
  );
}

// Compile name matchers (case-insensitive)
const ambiguousKeepPatterns = ambiguousKeepNames.map(n => n.toLowerCase());

function isAmbiguousKeep(name) {
  const lower = (name || '').toLowerCase();
  return ambiguousKeepPatterns.some(pattern => lower.includes(pattern));
}

// ─── Existing event signatures for dedup ────────────────────────────────
const existingSigs = new Set();
const existingUrls = new Set();
for (const e of existingEvents.records) {
  const name = (e.name || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  const date = e.start_date || '';
  const country = (e.location?.country || '').toLowerCase().trim();
  existingSigs.add(`${name}|${date}|${country}`);
  if (e.event_url) existingUrls.add(e.event_url.toLowerCase().replace(/\/$/, ''));
}

// ─── Process records ────────────────────────────────────────────────────
const stats = {
  total: enriched.records.length,
  excluded_geography: 0,
  excluded_topic: 0,
  excluded_relevance_name: 0,
  already_tracked: 0,
  no_canonical_url: 0,
  shortlisted: 0,
};

const shortlisted = [];
const excluded = { geography: [], topic: [], relevance: [], tracked: [], no_url: [] };

for (const r of enriched.records) {
  const country = (r.location?.country || '').toLowerCase().trim();
  const city = (r.location?.city || '').toLowerCase().trim();

  // 1. Geographic filter
  if ((country && excludedCountries.has(country)) || (city && excludedGeoTokens.has(city))) {
    stats.excluded_geography++;
    excluded.geography.push({ name: r.name, country: r.location?.country, city: r.location?.city });
    continue;
  }

  // 2. Must have canonical URL (enrichment succeeded)
  if (!r.event_url || r.event_url.includes('dev.events')) {
    stats.no_canonical_url++;
    excluded.no_url.push({ name: r.name, event_url: r.event_url });
    continue;
  }

  // 3. Already-tracked check
  const normName = (r.name || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  const sig = `${normName}|${r.start_date || ''}|${country}`;
  const normUrl = (r.event_url || '').toLowerCase().replace(/\/$/, '');
  if (existingSigs.has(sig) || existingUrls.has(normUrl)) {
    stats.already_tracked++;
    excluded.tracked.push({ name: r.name, start_date: r.start_date });
    continue;
  }

  const topic = r.topic || '';

  // 4. Name-level exclusion override (catches misclassified events)
  if (isAlwaysExclude(r.name, r.event_url)) {
    stats.excluded_relevance_name++;
    excluded.relevance.push({ name: r.name, topic, reason: 'name-level exclusion override (misclassified or out-of-scope)' });
    continue;
  }

  // 5. Topic filter
  if (excludeTopics.has(topic)) {
    stats.excluded_topic++;
    excluded.topic.push({ name: r.name, topic });
    continue;
  }

  if (includeTopics.has(topic)) {
    shortlisted.push(r);
    stats.shortlisted++;
    continue;
  }

  // 6. Ambiguous topic — check agent name whitelist
  if (isAmbiguousKeep(r.name)) {
    shortlisted.push(r);
    stats.shortlisted++;
  } else {
    stats.excluded_relevance_name++;
    excluded.relevance.push({ name: r.name, topic, reason: 'ambiguous topic, not in agent whitelist' });
  }
}

// ─── Output ─────────────────────────────────────────────────────────────
console.log('=== PHASE 2 AGENT SHORTLIST RESULTS ===');
console.log(`Total enriched records: ${stats.total}`);
console.log(`Excluded by geography: ${stats.excluded_geography}`);
console.log(`Excluded by topic (auto): ${stats.excluded_topic}`);
console.log(`Excluded by relevance (agent name review): ${stats.excluded_relevance_name}`);
console.log(`Already tracked in events.json: ${stats.already_tracked}`);
console.log(`No canonical URL: ${stats.no_canonical_url}`);
console.log(`SHORTLISTED: ${stats.shortlisted}`);
console.log('');

// Topic breakdown of shortlisted
const topicCounts = {};
for (const r of shortlisted) {
  const t = r.topic || '(ambiguous-kept)';
  topicCounts[t] = (topicCounts[t] || 0) + 1;
}
console.log('Shortlisted by topic:');
for (const [topic, count] of Object.entries(topicCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${topic}: ${count}`);
}

// Write shortlist
const output = {
  generated_at: new Date().toISOString(),
  source_file: `data/dev-events-enriched-${runDate}.json`,
  phase: 'Phase 2 + Phase 5 agent relevance filter',
  stats,
  records: shortlisted,
};

const outPath = path.join(dataDir, `dev-events-shortlist-${runDate}.json`);
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
console.log(`\nWrote shortlist: ${outPath} (${shortlisted.length} records)`);

// Write issues for excluded ambiguous records
const issues = excluded.relevance.map(r => ({
  source: 'dev.events',
  discovered_name: r.name,
  stage: 'content_validation',
  reason: `out-of-scope: ${r.topic} topic, name does not indicate DevOps/SRE/infrastructure focus`,
  notes: r.reason,
}));

if (issues.length > 0) {
  const issuesPath = path.join(dataDir, 'events-issues.json');
  let existingIssues = { records: [] };
  try {
    existingIssues = JSON.parse(fs.readFileSync(issuesPath, 'utf-8'));
  } catch (e) { /* file may not exist */ }
  existingIssues.records.push(...issues);
  fs.writeFileSync(issuesPath, JSON.stringify(existingIssues, null, 2) + '\n', 'utf-8');
  console.log(`Appended ${issues.length} exclusion issues to ${issuesPath}`);
}
