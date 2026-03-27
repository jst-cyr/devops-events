import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("data/adatosystems-cfp-tracker-2026-03-27.html", "utf8");

const tableMatch = html.match(/<table[^>]*class="tablesorter"[^>]*>([\s\S]*?)<\/table>/);
if (!tableMatch) { console.log("Table not found"); process.exit(1); }

const tbody = tableMatch[1].match(/<tbody>([\s\S]*?)<\/tbody>/);
if (!tbody) { console.log("Tbody not found"); process.exit(1); }

const rows = [...tbody[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
console.log("Total rows in table:", rows.length);

const events = rows.map(row => {
  const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => {
    const content = m[1].trim();
    const linkMatch = content.match(/href="([^"]+)"/i);
    const textMatch = content.replace(/<[^>]+>/g, "").trim();
    return { text: textMatch, link: linkMatch ? linkMatch[1] : null };
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
    cfp_url: cells[7].link
  };
}).filter(Boolean);

console.log("Parsed events:", events.length);

// Filter to 56-day CFP window: 2026-03-27 to 2026-05-22
const windowStart = "2026-03-27";
const windowEnd = "2026-05-22";
const inWindow = events.filter(e => e.cfp_close >= windowStart && e.cfp_close <= windowEnd);
console.log("In 56-day CFP window:", inWindow.length);
console.log();
inWindow.forEach(e => console.log(e.cfp_close, "|", e.name, "|", e.city, e.country, "|", e.event_url));

// Now reconcile against events.json
const eventsJson = JSON.parse(readFileSync("data/events.json", "utf8"));
const existingUrls = new Set(eventsJson.records.map(r => r.event_url));
const existingIds = new Set(eventsJson.records.map(r => r.id));
const existingNames = new Set(eventsJson.records.map(r => r.name.toLowerCase()));

console.log("\n=== RECONCILIATION ===");
const missing = [];
const covered = [];
const nameOnly = [];

for (const e of inWindow) {
  const urlMatch = e.event_url && existingUrls.has(e.event_url);
  const cfpUrlMatch = e.cfp_url && [...eventsJson.records].some(r =>
    r.cfp?.cfp_url === e.cfp_url
  );
  const nameMatch = existingNames.has(e.name.toLowerCase());

  if (urlMatch || cfpUrlMatch) {
    covered.push(e);
  } else if (nameMatch) {
    nameOnly.push(e);
    console.log("NAME-ONLY MATCH:", e.name, "| CFP closes:", e.cfp_close);
  } else {
    missing.push(e);
    console.log("MISSING:", e.name, "|", e.city, e.country, "| CFP closes:", e.cfp_close, "| URL:", e.event_url);
  }
}

console.log("\nTotals: covered=" + covered.length, "name_only=" + nameOnly.length, "missing=" + missing.length);

// Write validation report
const report = {
  generated_at: new Date().toISOString(),
  window_start: windowStart,
  window_end: windowEnd,
  considered_rows: inWindow.length,
  covered_by_url: covered.length,
  name_match_only: nameOnly.length,
  missing_count: missing.length,
  missing: missing,
  name_match_only_list: nameOnly
};
writeFileSync("data/adatosystems-cfp-validation-2026-03-27.json", JSON.stringify(report, null, 2) + "\n");
console.log("\nValidation report written to data/adatosystems-cfp-validation-2026-03-27.json");
