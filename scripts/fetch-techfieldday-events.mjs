#!/usr/bin/env node

// Fetch upcoming network-focused Tech Field Day events from the WordPress REST
// API and normalize them into records compatible with reconcile-events.py.
//
// Usage:
//   node scripts/fetch-techfieldday-events.mjs [YYYY-MM-DD]
//
// Output: data/techfieldday-events-<date>.json

import { writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";

const BASE_URL = "https://techfieldday.com";
const SOURCE = "techfieldday.com";
const WINDOW_DAYS = 180;
const PAGE_SIZE = 20;
const DELAY_MS = 1000;
const NETWORK_TITLE_PATTERN = /\b(networking|network|mobility|wireless)\b/i;

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

const LOCATION_OVERRIDES = {
  "silicon valley": {
    city: "Silicon Valley",
    region: "California",
    country: "United States",
    country_code: "US",
  },
};

const args = process.argv.slice(2);
let runDate = args[0];
if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
  runDate = new Date().toISOString().slice(0, 10);
}

const startDate = runDate;
const endDate = addDays(runDate, WINDOW_DAYS);

console.log(`Run date: ${runDate}`);
console.log(`Window  : ${startDate} -> ${endDate}`);
console.log(`Source  : ${BASE_URL}`);

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; devops-events-bot/1.0)" } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchJson(new URL(res.headers.location, url).href));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve({
              data: JSON.parse(Buffer.concat(chunks).toString("utf-8")),
              headers: res.headers,
            });
          } catch (error) {
            reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(60_000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

function isWithinWindow(dateStr) {
  return Boolean(dateStr && dateStr >= startDate && dateStr <= endDate);
}

function getEventDates(post) {
  const info = post?.["toolset-meta"]?.["event-information"];
  const startRaw = info?.sdate?.raw;
  const endRaw = info?.edate?.raw;

  if (!startRaw || !endRaw) {
    return { startDate: null, endDate: null };
  }

  const startDate = new Date(Number(startRaw) * 1000).toISOString().slice(0, 10);
  const endDate = new Date(Number(endRaw) * 1000).toISOString().slice(0, 10);
  return { startDate, endDate };
}

function normalizeLocationName(name) {
  const normalized = String(name || "").trim();
  if (!normalized) {
    return {
      city: null,
      region: null,
      country: "United States",
      country_code: "US",
    };
  }

  const override = LOCATION_OVERRIDES[normalized.toLowerCase()];
  if (override) {
    return { ...override };
  }

  const cityStateMatch = normalized.match(/^(.+?),\s*([A-Z]{2})$/);
  if (cityStateMatch) {
    const regionCode = cityStateMatch[2].toUpperCase();
    return {
      city: cityStateMatch[1].trim(),
      region: STATE_NAMES[regionCode] || regionCode,
      country: "United States",
      country_code: "US",
    };
  }

  return {
    city: normalized,
    region: null,
    country: "United States",
    country_code: "US",
  };
}

function buildTags(name) {
  const tags = ["networking", "network-engineering"];
  if (/mobility/i.test(name)) {
    tags.push("wireless");
  }
  return tags;
}

async function fetchLocationTerm(locationId, cache) {
  if (!locationId) return null;
  if (cache.has(locationId)) return cache.get(locationId);

  const url = `${BASE_URL}/wp-json/wp/v2/location/${locationId}`;
  try {
    const response = await fetchJson(url);
    const term = response.data;
    const normalized = normalizeLocationName(term?.name);
    cache.set(locationId, normalized);
    return normalized;
  } catch (error) {
    console.warn(`[WARN] Failed to resolve location ${locationId}: ${error.message}`);
    const fallback = normalizeLocationName(null);
    cache.set(locationId, fallback);
    return fallback;
  }
}

async function fetchAllEvents() {
  const events = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${BASE_URL}/wp-json/wp/v2/event?per_page=${PAGE_SIZE}&page=${page}`;
    process.stdout.write(`  Fetching page ${page}... `);
    const response = await fetchJson(url);
    const pageEvents = Array.isArray(response.data) ? response.data : [];
    totalPages = Number(response.headers["x-wp-totalpages"] || totalPages);
    console.log(`${pageEvents.length} events`);
    events.push(...pageEvents);
    page += 1;
    if (page <= totalPages) {
      await sleep(DELAY_MS);
    }
  }

  return events;
}

async function main() {
  const posts = await fetchAllEvents();
  const locationCache = new Map();
  const records = [];

  for (const post of posts) {
    const name = decodeHtml(post?.title?.rendered);
    if (!NETWORK_TITLE_PATTERN.test(name)) {
      continue;
    }

    const { startDate, endDate } = getEventDates(post);
    if (!isWithinWindow(startDate)) {
      continue;
    }

    const locationIds = Array.isArray(post?.location) ? post.location : [];
    const location = await fetchLocationTerm(locationIds[0], locationCache);

    records.push({
      id: `techfieldday-${post.slug}`,
      name,
      event_url: post.link,
      start_date: startDate,
      end_date: endDate,
      delivery: "hybrid",
      event_type: "conference",
      tags: buildTags(name),
      source: SOURCE,
      location: {
        city: location.city,
        region: location.region,
        country: location.country,
        country_code: location.country_code,
        is_online: false,
        venue: null,
      },
      cost: {
        is_free: true,
        cost_level: "free",
        notes:
          "No public ticket pricing listed. Tech Field Day directs prospective delegates to contact the organizers to attend, and presentations are streamed live on the event page.",
      },
      notes:
        "Date sourced from Tech Field Day WordPress event metadata. Delivery set to hybrid because the event has a physical location and the event page states presentations are streamed live.",
    });
  }

  records.sort((left, right) => {
    const dateCompare = (left.start_date || "").localeCompare(right.start_date || "");
    if (dateCompare !== 0) return dateCompare;
    return left.name.localeCompare(right.name);
  });

  const output = {
    generated_at: new Date().toISOString(),
    source: SOURCE,
    window_start: startDate,
    window_end: endDate,
    total_events: records.length,
    records,
  };

  const outputPath = `data/techfieldday-events-${runDate}.json`;
  writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nWrote ${records.length} Tech Field Day records to ${outputPath}`);
}

main().catch((error) => {
  console.error(`\nFatal: ${error.message}`);
  process.exit(1);
});