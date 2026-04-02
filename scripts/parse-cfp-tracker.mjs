#!/usr/bin/env node

// Parse the AdatoSystems CFP tracker HTML snapshot, reconcile against
// events.json, and produce:
//   - data/adatosystems-cfp-validation-<date>.json  (reconciliation report)
//   - data/cfp-candidates.json                      (prioritised DevOps-relevant CFP candidates)
//
// Usage:
//   node scripts/parse-cfp-tracker.mjs <YYYY-MM-DD>
//
// The <date> argument is the run date (defaults to today in UTC).
// Expects the HTML snapshot at data/adatosystems-cfp-tracker-<date>.html
// (download first with: curl.exe -L "https://adatosystems.com/cfp-tracker/" -o "data/adatosystems-cfp-tracker-<date>.html")

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const WINDOW_DAYS = 56;
const KEYWORD_PATTERN =
  /devops|sreday|o11y|observability|cloud native|kcd|kubernetes|platform|llmday|apidays/i;

const EXCLUDED_COUNTRIES = new Set([
  "china",
  "romania",
  "mexico",
  "argentina",
  "bolivia",
  "brazil",
  "chile",
  "colombia",
  "ecuador",
  "guyana",
  "paraguay",
  "peru",
  "suriname",
  "uruguay",
  "venezuela",
  "belize",
  "costa rica",
  "el salvador",
  "guatemala",
  "honduras",
  "nicaragua",
  "panama",
  "saudi arabia",
  "iraq",
  "iran",
  "israel",
  "united arab emirates",
  "qatar",
  "kuwait",
  "oman",
  "bahrain",
  "jordan",
  "lebanon",
  "yemen",
  "syria",
]);

const EXCLUDED_AFRICA_COUNTRIES = new Set([
  "algeria",
  "angola",
  "benin",
  "botswana",
  "burkina faso",
  "burundi",
  "cabo verde",
  "cameroon",
  "central african republic",
  "chad",
  "comoros",
  "democratic republic of the congo",
  "djibouti",
  "egypt",
  "equatorial guinea",
  "eritrea",
  "eswatini",
  "ethiopia",
  "gabon",
  "gambia",
  "ghana",
  "guinea",
  "guinea-bissau",
  "ivory coast",
  "cote d'ivoire",
  "kenya",
  "lesotho",
  "liberia",
  "libya",
  "madagascar",
  "malawi",
  "mali",
  "mauritania",
  "mauritius",
  "morocco",
  "mozambique",
  "namibia",
  "niger",
  "nigeria",
  "republic of the congo",
  "rwanda",
  "sao tome and principe",
  "senegal",
  "seychelles",
  "sierra leone",
  "somalia",
  "south africa",
  "south sudan",
  "sudan",
  "tanzania",
  "togo",
  "tunisia",
  "uganda",
  "zambia",
  "zimbabwe",
]);

const EXCLUDED_GEO_TOKENS = [
  "romania",
  "brasov",
  "mexico",
  "brazil",
  "rio de janeiro",
  "recife",
  "campinas",
  "natal",
  "feira de santana",
  "goiania",
  "goi\u00e2nia",
  "sao paulo",
  "s\u00e3o paulo",
  "peru",
  "lima",
  "argentina",
  "bolivia",
  "chile",
  "colombia",
  "ecuador",
  "guyana",
  "paraguay",
  "suriname",
  "uruguay",
  "venezuela",
  "belize",
  "costa rica",
  "el salvador",
  "guatemala",
  "honduras",
  "nicaragua",
  "panama",
  "china",
];

function isExcludedGeography(event) {
  const country = (event.country || "").trim().toLowerCase();
  const geographyText = [event.city || "", event.country || "", event.event_url || "", event.name || ""]
    .join(" ")
    .toLowerCase();

  if (EXCLUDED_COUNTRIES.has(country) || EXCLUDED_AFRICA_COUNTRIES.has(country)) {
    return true;
  }

  return EXCLUDED_GEO_TOKENS.some((token) => geographyText.includes(token));
}

// ---------------------------------------------------------------------------
// Resolve run date
// ---------------------------------------------------------------------------
const runDate = (() => {
  const arg = process.argv[2];
  if (arg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      console.error("Error: date argument must be YYYY-MM-DD");
      process.exit(1);
    }
    return arg;
  }
  const now = new Date();
  return now.toISOString().slice(0, 10);
})();

const htmlPath = `data/adatosystems-cfp-tracker-${runDate}.html`;
if (!existsSync(htmlPath)) {
  console.error(`Error: HTML snapshot not found at ${htmlPath}`);
  console.error(`Download it first:\n  curl.exe -L "https://adatosystems.com/cfp-tracker/" -o "${htmlPath}"`);
  process.exit(1);
}

console.log(`Run date: ${runDate}`);
console.log(`HTML snapshot: ${htmlPath}`);

// ---------------------------------------------------------------------------
// Parse HTML table
// ---------------------------------------------------------------------------
const html = readFileSync(htmlPath, "utf8");

const tableMatch = html.match(/<table[^>]*class="tablesorter"[^>]*>([\s\S]*?)<\/table>/);
if (!tableMatch) {
  console.error("Error: table with class='tablesorter' not found in HTML.");
  process.exit(1);
}

const tbodyMatch = tableMatch[1].match(/<tbody>([\s\S]*?)<\/tbody>/);
if (!tbodyMatch) {
  console.error("Error: <tbody> not found inside table.");
  process.exit(1);
}

const rows = [...tbodyMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
console.log("Total rows in table:", rows.length);

const trackerEvents = rows
  .map((row) => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => {
      const content = m[1].trim();
      const linkMatch = content.match(/href="([^"]+)"/i);
      const text = content.replace(/<[^>]+>/g, "").replace(/&#8217;/g, "'").trim();
      return { text, link: linkMatch ? linkMatch[1] : null };
    });
    if (cells.length < 8) return null;
    return {
      name: cells[0].text,
      city: cells[1].text,
      country: cells[2].text,
      event_start: cells[3].text,
      event_end: cells[4].text,
      cfp_close: cells[5].text,
      event_url: cells[6].link,
      cfp_url: cells[7].link,
    };
  })
  .filter(Boolean);

console.log("Parsed events:", trackerEvents.length);

// ---------------------------------------------------------------------------
// Filter to 56-day CFP window
// ---------------------------------------------------------------------------
const windowStart = runDate;
const windowEndDate = new Date(new Date(`${runDate}T00:00:00Z`).getTime() + WINDOW_DAYS * 86400000);
const windowEnd = windowEndDate.toISOString().slice(0, 10);

const inWindow = trackerEvents.filter(
  (e) => e.cfp_close >= windowStart && e.cfp_close <= windowEnd,
);
console.log(`\nCFP window: ${windowStart} to ${windowEnd}`);
console.log("In-window CFPs:", inWindow.length);

// ---------------------------------------------------------------------------
// Reconcile against events.json (+ events-candidates.json if present)
// ---------------------------------------------------------------------------
const eventsJson = JSON.parse(readFileSync("data/events.json", "utf8"));
const allRecords = [...eventsJson.records];

const candidatesPath = "data/events-candidates.json";
if (existsSync(candidatesPath)) {
  const candidatesJson = JSON.parse(readFileSync(candidatesPath, "utf8"));
  if (candidatesJson.records) allRecords.push(...candidatesJson.records);
}

const existingUrls = new Set(allRecords.map((r) => r.event_url));
const existingCfpUrls = new Set(
  allRecords.filter((r) => r.cfp?.cfp_url).map((r) => r.cfp.cfp_url),
);
const existingNames = new Set(allRecords.map((r) => r.name.toLowerCase()));

console.log("\n=== RECONCILIATION ===");
const missing = [];
const covered = [];
const nameOnly = [];

for (const e of inWindow) {
  const urlMatch = e.event_url && existingUrls.has(e.event_url);
  const cfpUrlMatch = e.cfp_url && existingCfpUrls.has(e.cfp_url);
  const nameMatch = existingNames.has(e.name.toLowerCase());

  if (urlMatch || cfpUrlMatch) {
    covered.push(e);
  } else if (nameMatch) {
    nameOnly.push(e);
    console.log("NAME-ONLY MATCH:", e.name, "| CFP closes:", e.cfp_close);
  } else {
    missing.push(e);
    console.log(
      "MISSING:",
      e.name,
      "|",
      e.city,
      e.country,
      "| CFP closes:",
      e.cfp_close,
      "| URL:",
      e.event_url,
    );
  }
}

console.log(
  "\nTotals: covered=" + covered.length,
  "name_only=" + nameOnly.length,
  "missing=" + missing.length,
);

// ---------------------------------------------------------------------------
// Write validation report
// ---------------------------------------------------------------------------
const validationPath = `data/adatosystems-cfp-validation-${runDate}.json`;
const report = {
  generated_at: new Date().toISOString(),
  window_start: windowStart,
  window_end: windowEnd,
  considered_rows: inWindow.length,
  covered_by_url: covered.length,
  name_match_only: nameOnly.length,
  missing_count: missing.length,
  missing,
  name_match_only_list: nameOnly,
};
writeFileSync(validationPath, JSON.stringify(report, null, 2) + "\n");
console.log(`\nValidation report written to ${validationPath}`);

// ---------------------------------------------------------------------------
// Build cfp-candidates.json (DevOps-relevant subset with priority tiers)
// ---------------------------------------------------------------------------
const runDateMs = new Date(`${runDate}T00:00:00Z`).getTime();

const candidates = missing
  .filter((e) => {
    const searchText = [e.name, e.event_url || "", e.cfp_url || ""].join(" ");
    return KEYWORD_PATTERN.test(searchText) && !isExcludedGeography(e);
  })
  .sort((a, b) => {
    if (a.cfp_close !== b.cfp_close) return a.cfp_close.localeCompare(b.cfp_close);
    return a.name.localeCompare(b.name);
  })
  .map((e, i) => {
    const daysUntil = Math.round(
      (new Date(`${e.cfp_close}T00:00:00Z`).getTime() - runDateMs) / 86400000,
    );
    let tier = "p2_medium";
    if (daysUntil <= 14) tier = "p0_urgent";
    else if (daysUntil <= 28) tier = "p1_high";
    return {
      rank: i + 1,
      name: e.name,
      city: e.city,
      country: e.country,
      event_start: e.event_start,
      event_end: e.event_end,
      cfp_close_date: e.cfp_close,
      days_until_cfp_close: daysUntil,
      priority_tier: tier,
      event_url: e.event_url,
      cfp_url: e.cfp_url,
    };
  });

const cfpCandidates = {
  generated_at: new Date().toISOString(),
  source_report: validationPath,
  window_start: windowStart,
  window_end: windowEnd,
  prioritization:
    "Sorted by cfp_close_date asc, then name; tiers by days until close (<=14 p0, <=28 p1, else p2).",
  total_candidates: candidates.length,
  candidates,
};

writeFileSync("data/cfp-candidates.json", JSON.stringify(cfpCandidates, null, 2) + "\n");
console.log("\nCFP candidates written to data/cfp-candidates.json");
console.log("Total DevOps-relevant CFP candidates:", candidates.length);
candidates.forEach((c) =>
  console.log(
    `  #${c.rank} [${c.priority_tier}] ${c.name} | CFP closes: ${c.cfp_close_date} (${c.days_until_cfp_close}d) | ${c.event_url}`,
  ),
);
