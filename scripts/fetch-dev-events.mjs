#!/usr/bin/env node

// Fetch all events from dev.events by paginating through the date-filtered
// index.  Extracts JSON-LD structured data embedded in each page.
//
// Usage:
//   node scripts/fetch-dev-events.mjs [YYYY-MM-DD] [--window-days N]
//
// Defaults: today, 180-day window.
// Output:   data/dev-events-<date>.json

import { writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const WINDOW_DAYS = 180;
const PAGE_SIZE_GUESS = 30; // approximate events per page; used for safety cap
const MAX_PAGES = 100;
const DELAY_MS = 1200; // polite pause between requests

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let runDate = null;
let windowDays = WINDOW_DAYS;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--window-days" && args[i + 1]) {
    windowDays = parseInt(args[++i], 10);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(args[i])) {
    runDate = args[i];
  }
}

if (!runDate) {
  const d = new Date();
  runDate = d.toISOString().slice(0, 10);
}

const startDate = runDate;
const endDate = addDays(startDate, windowDays);

console.log(`Run date  : ${runDate}`);
console.log(`Window    : ${startDate} → ${endDate} (${windowDays} days)`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch a URL and return the response body as a string. */
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; devops-events-bot/1.0)" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow redirect
        return resolve(fetchPage(new URL(res.headers.location, url).href));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

/**
 * Parse all JSON-LD Event blocks from raw HTML.
 * Returns an array of schema.org Event objects.
 */
function extractJsonLdEvents(html) {
  const events = [];
  // Match <script type="application/ld+json"> ... </script>
  const re = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      const t = obj["@type"] || "";
      if (t === "Event" || t.endsWith("Event") || t === "EducationEvent") {
        events.push(obj);
      }
    } catch {
      // skip malformed JSON-LD
    }
  }
  return events;
}

/**
 * Extract the dev.events detail URL slug from a JSON-LD event.
 * The `url` field is e.g. "https://dev.events/conferences/some-slug-abc123"
 */
function extractSlug(event) {
  const url = event.url || "";
  const match = url.match(/\/conferences\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Parse structured location from the JSON-LD description field.
 * Description format: "<topic> conference in <city>, <region>, <country>, <continent>"
 * or "<topic> conference Online"
 */
function parseLocation(event) {
  const desc = event.description || "";
  const result = { city: null, region: null, country: null, continent: null, is_online: false };

  if (/\bOnline\b/i.test(desc)) {
    result.is_online = true;
  }

  // e.g. "SRE conference in San Francisco, California, United States, North America"
  const inMatch = desc.match(/conference\s+in\s+(.+)/i);
  if (inMatch) {
    const parts = inMatch[1].split(",").map((s) => s.trim());
    if (parts.length >= 1) result.city = parts[0];
    if (parts.length >= 3) {
      result.country = parts[parts.length - 2];
      result.continent = parts[parts.length - 1];
    } else if (parts.length === 2) {
      result.country = parts[1];
    }
    if (parts.length >= 4) {
      result.region = parts.slice(1, parts.length - 2).join(", ");
    }
  }

  // Check for "and Online" in description (hybrid)
  if (/and\s+Online/i.test(desc)) {
    result.is_online = true;
  }

  return result;
}

/**
 * Extract topic tags from the description.
 * e.g. "SRE conference in ..." → ["sre"]
 */
function parseTopic(event) {
  const desc = event.description || "";
  const topicMatch = desc.match(/^(.+?)\s+(?:conference|masterclass|meetup|workshop|summit)/i);
  if (topicMatch) {
    return topicMatch[1].trim();
  }
  return null;
}

/**
 * Check if a page has a "Show more" / next page indicator.
 */
function hasNextPage(html, currentPage) {
  // Look for hx-vals with next page number
  const nextPage = currentPage + 1;
  return html.includes(`"page": "${nextPage}"`) || html.includes(`"page":"${nextPage}"`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const allEvents = new Map(); // slug → event record, deduplicates across pages
  let page = 1;
  let totalFetched = 0;

  while (page <= MAX_PAGES) {
    const url = `https://dev.events/?startDate=${startDate}&endDate=${endDate}&page=${page}`;
    process.stdout.write(`  Fetching page ${page}... `);

    let html;
    try {
      html = await fetchPage(url);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      break;
    }

    const events = extractJsonLdEvents(html);
    console.log(`${events.length} events`);

    if (events.length === 0) {
      console.log("  No events on page, stopping pagination.");
      break;
    }

    for (const ev of events) {
      const slug = extractSlug(ev);
      if (!slug || allEvents.has(slug)) continue;

      const loc = parseLocation(ev);
      const topic = parseTopic(ev);
      const name = ev.name || (ev.performer && ev.performer.name) || "";
      const evStartDate = ev.startDate ? ev.startDate.slice(0, 10) : null;
      const evEndDate = ev.endDate ? ev.endDate.slice(0, 10) : null;

      allEvents.set(slug, {
        name,
        dev_events_slug: slug,
        dev_events_url: ev.url || `https://dev.events/conferences/${slug}`,
        start_date: evStartDate,
        end_date: evEndDate,
        topic: topic,
        location: {
          city: loc.city,
          region: loc.region,
          country: loc.country,
          continent: loc.continent,
          is_online: loc.is_online,
        },
      });
    }

    totalFetched += events.length;

    // Check for next page
    if (!hasNextPage(html, page)) {
      console.log("  No next page indicator found, stopping.");
      break;
    }

    page++;
    await sleep(DELAY_MS);
  }

  const records = [...allEvents.values()];
  records.sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));

  const output = {
    generated_at: new Date().toISOString(),
    source: "dev.events",
    start_date: startDate,
    end_date: endDate,
    window_days: windowDays,
    total_pages_fetched: page,
    total_events: records.length,
    records,
  };

  const outPath = `data/dev-events-${runDate}.json`;
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");

  console.log(`\nDone.`);
  console.log(`  Pages fetched : ${page}`);
  console.log(`  Unique events : ${records.length}`);
  console.log(`  Output        : ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
