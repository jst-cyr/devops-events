#!/usr/bin/env node

// Fetch upcoming NANOG conferences from the text mirror at r.jina.ai and
// normalize them into records compatible with reconcile-events.py.
//
// Usage:
//   node scripts/fetch-nanog-events.mjs [YYYY-MM-DD]
//
// Output: data/nanog-events-<date>.json

import { writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";

const SOURCE = "nanog.org";
const MIRROR_PREFIX = "https://r.jina.ai/http://nanog.org";
const WINDOW_DAYS = 180;
const DELAY_MS = 1000;

const args = process.argv.slice(2);
let runDate = args[0];
if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
  runDate = new Date().toISOString().slice(0, 10);
}

const startDate = runDate;
const endDate = addDays(runDate, WINDOW_DAYS);

console.log(`Run date: ${runDate}`);
console.log(`Window  : ${startDate} -> ${endDate}`);
console.log(`Source  : ${SOURCE}`);

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; devops-events-bot/1.0)" } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchText(new URL(res.headers.location, url).href));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
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

function parseMonthDate(dateText) {
  const parsed = new Date(`${dateText} UTC`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function isWithinWindow(dateStr) {
  return Boolean(dateStr && dateStr >= startDate && dateStr <= endDate);
}

function parseConferenceCost(markdown) {
  const earlyRow = markdown.match(/\|\s*Early\s*\|\s*\$(\d{1,3}(?:,\d{3})?)\s*\|\s*\$(\d{1,3}(?:,\d{3})?)\s*\|\s*\$(\d{1,3}(?:,\d{3})?)\s*\|/i);
  const virtualMatch = markdown.match(/Virtual Registration[^\n]*\$(\d{1,3}(?:,\d{3})?)/i);
  const generalEarly = earlyRow ? Number(earlyRow[1].replace(/,/g, "")) : null;
  const studentRate = earlyRow ? Number(earlyRow[3].replace(/,/g, "")) : null;
  const virtualRate = virtualMatch ? Number(virtualMatch[1].replace(/,/g, "")) : null;
  const lowestPrice = studentRate || virtualRate || generalEarly || 150;

  return {
    is_free: false,
    lowest_price: lowestPrice,
    price_currency: "USD",
    cost_level: lowestPrice <= 150 ? "budget" : lowestPrice <= 950 ? "standard" : "premium",
    notes:
      `Published NANOG conference rates show early in-person pricing from $${generalEarly || 775} USD, student pricing from $${studentRate || 100} USD, and virtual registration at $${virtualRate || 150} USD.`,
  };
}

function parseFutureConferences(markdown) {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  const records = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!/^NANOG\s+\d+$/i.test(line)) continue;

    const name = line;
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    let hasVirtual = false;
    let city = null;
    let region = null;
    let start = null;
    let end = null;

    for (let lookAhead = Math.max(0, index - 4); lookAhead < Math.min(lines.length, index + 12); lookAhead++) {
      const probe = lines[lookAhead];
      if (/Virtual Event/i.test(probe)) {
        hasVirtual = true;
      }
      const cityStateMatch = probe.match(/^([A-Za-z][A-Za-z\s.'-]+),\s*([A-Z]{2})$/);
      if (cityStateMatch) {
        city = cityStateMatch[1].trim();
        region = cityStateMatch[2].trim();
      }
      const dateMatch = probe.match(/^([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+-\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})$/);
      if (dateMatch) {
        start = parseMonthDate(dateMatch[1]);
        end = parseMonthDate(dateMatch[2]);
      }
    }

    if (!city || !region || !start || !end) continue;
    if (!isWithinWindow(start)) continue;

    records.push({
      id: slug,
      slug,
      name,
      start_date: start,
      end_date: end,
      city,
      region,
      delivery: hasVirtual ? "hybrid" : "in_person",
      event_url: `https://nanog.org/events/${slug}/`,
    });
  }

  return records;
}

function parseVenue(detailMarkdown) {
  const venueMatch = detailMarkdown.match(/Headquarter Hotel([^\n]+)/i);
  if (venueMatch) {
    return venueMatch[1].trim();
  }
  return null;
}

function parseHeadline(detailMarkdown) {
  const topicMatch = detailMarkdown.match(/spotlight topic is ([^.]+)\./i);
  return topicMatch ? topicMatch[1].trim() : null;
}

async function main() {
  console.log("\nFetching NANOG future events...");
  const futureMarkdown = await fetchText(`${MIRROR_PREFIX}/events/future/`);
  const conferenceRates = await fetchText(`${MIRROR_PREFIX}/events/conference-rates/`);
  const cost = parseConferenceCost(conferenceRates);
  const conferences = parseFutureConferences(futureMarkdown);
  const records = [];

  for (const conference of conferences) {
    process.stdout.write(`  Enriching ${conference.name}... `);
    let venue = null;
    let spotlight = null;

    try {
      const detailMarkdown = await fetchText(`${MIRROR_PREFIX}/events/${conference.slug}/`);
      venue = parseVenue(detailMarkdown);
      spotlight = parseHeadline(detailMarkdown);
      console.log("ok");
    } catch (error) {
      console.log(`WARN (${error.message})`);
    }

    const notes = [
      "Participation mode sourced from NANOG's upcoming events listing.",
    ];
    if (spotlight) {
      notes.push(`Detail page spotlight topic: ${spotlight}.`);
    }

    records.push({
      id: conference.id,
      name: conference.name,
      event_url: conference.event_url,
      start_date: conference.start_date,
      end_date: conference.end_date,
      delivery: conference.delivery,
      event_type: "conference",
      tags: ["networking", "network-engineering"],
      source: SOURCE,
      location: {
        city: conference.city,
        region: conference.region,
        country: "United States",
        country_code: "US",
        is_online: false,
        venue,
      },
      cost,
      notes: notes.join(" "),
    });

    await sleep(DELAY_MS);
  }

  records.sort((left, right) => (left.start_date || "").localeCompare(right.start_date || ""));

  const output = {
    generated_at: new Date().toISOString(),
    source: SOURCE,
    window_start: startDate,
    window_end: endDate,
    total_events: records.length,
    records,
  };

  const outputPath = `data/nanog-events-${runDate}.json`;
  writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nWrote ${records.length} NANOG records to ${outputPath}`);
}

main().catch((error) => {
  console.error(`\nFatal: ${error.message}`);
  process.exit(1);
});