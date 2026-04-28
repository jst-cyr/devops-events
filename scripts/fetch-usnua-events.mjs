#!/usr/bin/env node

// Fetch upcoming networking user group events from usnua.com (US Networking
// User Association). Scrapes the homepage for upcoming event RSVP links, then
// fetches each detail page to extract venue, date, and location.
//
// Usage:
//   node scripts/fetch-usnua-events.mjs [YYYY-MM-DD]
//
// Output: data/usnua-events-<date>.json
// Format: { records: [...] } compatible with reconcile-events.py

import { writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.usnua.com";
const DELAY_MS = 1500;

// All events from usnua.com are US-based in-person user group meetups
const FIXED_TAGS = ["networking", "network-engineering"];
const FIXED_SOURCE = "usnua.com";
const FIXED_DELIVERY = "in_person";
const FIXED_EVENT_TYPE = "user_group";
const FIXED_COUNTRY = "United States";
const FIXED_COUNTRY_CODE = "US";

// Canonical US state abbreviation → full state name
const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

const MONTH_MAP = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let runDate = args[0];
if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
  runDate = new Date().toISOString().slice(0, 10);
}
console.log(`Run date: ${runDate}`);
console.log(`Source  : ${BASE_URL}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchPage(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; devops-events-bot/1.0)" } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (maxRedirects <= 0) return reject(new Error("Too many redirects"));
          const target = new URL(res.headers.location, url).href;
          return resolve(fetchPage(target, maxRedirects - 1));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      }
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

/**
 * Extract the text content of an HTML element (strips all tags).
 */
function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse "April 29th, 2026" → "2026-04-29"
 */
function parseUsnuaDate(raw) {
  if (!raw) return null;
  const m = raw.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i
  );
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  const day = m[2].padStart(2, "0");
  const year = m[3];
  return `${year}-${month}-${day}`;
}

/**
 * Extract all upcoming event URLs from the usnua.com homepage HTML.
 * usnua.com serves absolute URLs like:
 *   https://www.usnua.com/mnnug-spring-event-2026?hsLang=en
 * associated with RSVP buttons in the Upcoming Events section.
 *
 * Strategy: find all absolute usnua.com hrefs that match the year-slug
 * pattern (e.g. *-202X), deduplicate, and strip tracking params.
 */
function extractEventLinks(html) {
  const urls = new Set();

  // Match absolute usnua.com links with year-slug patterns (e.g. -2026, -2027)
  const re = /href="(https:\/\/www\.usnua\.com\/[a-z0-9][a-z0-9-]*-202\d[^"]*)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    // Strip query params (e.g. ?hsLang=en) to get the canonical event URL
    const clean = m[1].replace(/\?.*$/, "");
    urls.add(clean);
  }

  return [...urls];
}

/**
 * Parse a usnua.com event detail page.
 * Returns { name, startDate, venue, city, stateCode }
 *
 * In the stripped plain text the address block looks like:
 *   ... Venue Name  Street Address  City, ST Zip ...
 * e.g.
 *   Wooden Hill Brewing Company 7421 Bush Lake Road Edina, MN 55439
 */
function parseDetailPage(html, _eventUrl) {
  // ---- Name: first h1 ----
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const name = h1Match ? stripTags(h1Match[1]) : null;

  // ---- Date: find "Month Xth, YYYY" pattern ----
  const dateRe =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}\b/gi;
  const dateMatches = [...html.matchAll(dateRe)].map((m) => m[0]);
  const startDate = dateMatches.length > 0 ? parseUsnuaDate(dateMatches[0]) : null;

  // ---- Venue and address ----
  // Strip scripts/styles and all HTML tags to get plain prose text.
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const plain = stripTags(noScripts);

  let venue = null;
  let city = null;
  let stateCode = null;

  // Match a US street address ending with a recognized street suffix, then city/state/zip.
  // e.g. "7421 Bush Lake Road Edina, MN 55439"
  const addrRe =
    /(\d+\s+[A-Za-z0-9\s.#]+?(?:Road|Rd|Street|St|Avenue|Ave|Blvd|Boulevard|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Circle|Cir|Trail|Trl|Pkwy|Parkway)\.?)\s+([A-Za-z][A-Za-z\s.]+),\s+([A-Z]{2})\s+\d{5}/gi;

  const addrMatches = [...plain.matchAll(addrRe)];
  if (addrMatches.length > 0) {
    const match = addrMatches[0];
    city = match[2].trim();
    stateCode = match[3].trim().toUpperCase();

    // Venue name = text immediately before the street number in the plain stream.
    // Format: "... {time} {Venue Name} {street#} ..."
    const matchStart = match.index;
    const before = plain.slice(Math.max(0, matchStart - 250), matchStart).trim();

    // Find the last capitalized multi-word phrase that isn't a time, date or nav keyword.
    // e.g. "... 4:30 - 7:30PM Wooden Hill Brewing Company "
    const phraseRe = /([A-Z][A-Za-z0-9\s&'.,-]{3,80}?)(?=\s+\d|\s*$)/g;
    const phrases = [...before.matchAll(phraseRe)].map((m) => m[1].trim());
    for (let i = phrases.length - 1; i >= 0; i--) {
      const c = phrases[i];
      // reject pure time patterns "4:30 - 7:30PM"
      if (/^\d{1,2}:\d{2}/.test(c)) continue;
      // reject nav/meta text
      if (/^(?:RSVP|Register|Sponsor|Agenda|Contact|About|Blog|Home|Membership|Get\s|Our\s|Share\s|Start\s|Become\s|Member\s|This\s)/i.test(c)) continue;
      // reject if it's a fragment of the event name
      const cNorm = c.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
      const nameNorm = (name || "").toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
      if (cNorm === nameNorm || nameNorm.includes(cNorm)) continue;

      if (c.length > 3 && c.length < 120) {
        // Strip leading/trailing AM/PM bleed-over from time strings
        let clean = c.replace(/^(?:AM|PM)\s+/i, "").replace(/\s+(?:AM|PM)$/i, "").trim();
        // Reject date fragments like "May 27th,"
        if (/^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d/i.test(clean)) continue;
        if (clean.length > 3) {
          venue = clean;
          break;
        }
      }
    }
  } else {
    // Fallback: no street address found — try to extract city/state only
    const cityOnlyRe = /([A-Za-z][A-Za-z\s.]+),\s+([A-Z]{2})\s+\d{5}/g;
    const cityMatch = cityOnlyRe.exec(plain);
    if (cityMatch) {
      city = cityMatch[1].trim();
      stateCode = cityMatch[2].trim().toUpperCase();
    }
  }

  return { name, startDate, venue, city, stateCode };
}

/**
 * Build a slug-based event ID from a full usnua.com URL.
 * e.g. "https://www.usnua.com/mnnug-spring-event-2026" → "usnua-mnnug-spring-event-2026"
 */
function buildEventId(url) {
  try {
    const path = new URL(url).pathname;
    return "usnua-" + path.replace(/^\//, "").replace(/[?#].*$/, "");
  } catch {
    return "usnua-" + url.replace(/.*\//, "");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Step 1: Fetch homepage and extract event slugs
  console.log("\nFetching homepage...");
  let homepageHtml;
  try {
    homepageHtml = await fetchPage(BASE_URL);
  } catch (err) {
    console.error(`ERROR fetching homepage: ${err.message}`);
    process.exit(1);
  }

  const slugs = extractEventLinks(homepageHtml);
  console.log(`Found ${slugs.length} upcoming event URLs`);

  if (slugs.length === 0) {
    console.warn("No event links found. The homepage structure may have changed.");
  }

  // Step 2: Fetch each detail page
  const records = [];
  const issues = [];

  for (let i = 0; i < slugs.length; i++) {
    const eventUrl = slugs[i];
    process.stdout.write(`  [${i + 1}/${slugs.length}] ${eventUrl} ... `);

    try {
      const html = await fetchPage(eventUrl);
      const { name, startDate, venue, city, stateCode } = parseDetailPage(html, eventUrl);

      if (!name || !startDate) {
        issues.push({ eventUrl, reason: `missing ${!name ? "name" : "date"}` });
        console.log(`⚠ skipped (${!name ? "no name" : "no date"})`);
        if (i < slugs.length - 1) await sleep(DELAY_MS);
        continue;
      }

      const stateName = stateCode ? STATE_NAMES[stateCode] : null;
      const id = buildEventId(eventUrl);

      records.push({
        id,
        name,
        event_url: eventUrl,
        start_date: startDate,
        end_date: startDate, // NUG events are single-day
        delivery: FIXED_DELIVERY,
        event_type: FIXED_EVENT_TYPE,
        tags: FIXED_TAGS,
        source: FIXED_SOURCE,
        location: {
          city: city || null,
          region: stateName || stateCode || null,
          country: FIXED_COUNTRY,
          country_code: FIXED_COUNTRY_CODE,
          venue: venue || null,
          is_online: false,
        },
        cfp: {
          cfp_url: null,
          cfp_open_date: null,
          cfp_close_date: null,
          cfp_status: "unknown",
        },
        // NUG events are free vendor-sponsored community meetups.
        // No pricing fields are present on usnua.com event pages — only an RSVP form.
        cost: {
          is_free: true,
          cost_level: "free",
          notes: "Free to attend; vendor-sponsored community event. No ticket pricing on event page.",
        },
        notes: null,
      });

      const loc = [city, stateCode].filter(Boolean).join(", ");
      console.log(`✓  ${name} | ${startDate} | ${loc}`);
    } catch (err) {
      issues.push({ eventUrl, reason: err.message });
      console.log(`✗ ERROR: ${err.message}`);
    }

    if (i < slugs.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Step 3: Write output
  const outPath = `data/usnua-events-${runDate}.json`;
  const output = {
    generated_at: new Date().toISOString(),
    run_date: runDate,
    source: BASE_URL,
    total_links_found: slugs.length,
    total_records: records.length,
    total_issues: issues.length,
    records,
    issues,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");

  console.log("\n--- Summary ---");
  console.log(`  Event links found : ${slugs.length}`);
  console.log(`  Records extracted : ${records.length}`);
  console.log(`  Issues/skipped    : ${issues.length}`);
  console.log(`  Output            : ${outPath}`);

  if (issues.length > 0) {
    console.log("\nIssues:");
    for (const issue of issues) {
      console.log(`  - ${issue.slug}: ${issue.reason}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
