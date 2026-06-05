#!/usr/bin/env node

// Fetch upcoming BSides events from the official BSides iCal feed and
// normalize records for reconcile-events.py.
//
// Enrichment steps per event:
// 1) Parse iCal fields (name/date/location/bsides event page).
// 2) Fetch BSides event detail page to extract:
//    - Canonical external event URL (chapter site / registration page)
//    - CFP URL when available
//
// Usage:
//   node scripts/fetch-bsides-events.mjs [YYYY-MM-DD] [--window-days N] [--max-events N] [--skip-detail-fetch]
//
// Output: data/bsides-events-<date>.json

import { writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";

const SOURCE = "bsides.org";
const ICS_URL = "https://bsides.org/events/list/?ical=1";
const LIST_URL = "https://bsides.org/events/list/";
const WINDOW_DAYS = 180;
const DETAIL_DELAY_MS = 700;
const USER_AGENT = "Mozilla/5.0 (compatible; devops-events-bot/1.0)";

const CFP_URL_HINT = /\bcfp\b|call\s*for\s*(?:speakers|papers)|pretalx|sessionize|papercall|sessionize\.com/i;
const ONLINE_HINT = /\bonline\b|\bvirtual\b|\bremote\b/i;

const SOCIAL_HOST_PATTERN = /(^|\.)twitter\.com$|(^|\.)x\.com$|(^|\.)linkedin\.com$|(^|\.)facebook\.com$|(^|\.)instagram\.com$|(^|\.)youtube\.com$|(^|\.)t\.me$|(^|\.)infosec\.exchange$|(^|\.)mastodon\.social$/i;

const COUNTRY_CODE_BY_NAME = {
  "argentina": "AR",
  "australia": "AU",
  "austria": "AT",
  "belgium": "BE",
  "bolivia": "BO",
  "brazil": "BR",
  "canada": "CA",
  "chile": "CL",
  "colombia": "CO",
  "croatia": "HR",
  "czech republic": "CZ",
  "czechia": "CZ",
  "denmark": "DK",
  "estonia": "EE",
  "finland": "FI",
  "france": "FR",
  "germany": "DE",
  "greece": "GR",
  "india": "IN",
  "ireland": "IE",
  "israel": "IL",
  "italy": "IT",
  "mexico": "MX",
  "moldova": "MD",
  "morocco": "MA",
  "netherlands": "NL",
  "nepal": "NP",
  "new zealand": "NZ",
  "norway": "NO",
  "poland": "PL",
  "portugal": "PT",
  "romania": "RO",
  "slovenia": "SI",
  "south africa": "ZA",
  "spain": "ES",
  "sweden": "SE",
  "switzerland": "CH",
  "united kingdom": "GB",
  "uk": "GB",
  "united states": "US",
  "usa": "US",
  "wales": "GB",
};

const US_STATE_TO_NAME = {
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

const args = process.argv.slice(2);
let runDate = null;
let windowDays = WINDOW_DAYS;
let maxEvents = null;
let skipDetailFetch = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    runDate = arg;
    continue;
  }
  if (arg === "--window-days" && args[i + 1]) {
    windowDays = Number.parseInt(args[i + 1], 10);
    i += 1;
    continue;
  }
  if (arg === "--max-events" && args[i + 1]) {
    maxEvents = Number.parseInt(args[i + 1], 10);
    i += 1;
    continue;
  }
  if (arg === "--skip-detail-fetch") {
    skipDetailFetch = true;
  }
}

if (!runDate) {
  runDate = new Date().toISOString().slice(0, 10);
}

const windowStart = runDate;
const windowEnd = addDays(runDate, windowDays);

console.log(`Run date: ${runDate}`);
console.log(`Window  : ${windowStart} -> ${windowEnd}`);
console.log(`Source  : ${ICS_URL}`);

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toIsoDateUTC(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&#8216;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " ")).trim();
}

function normalizeCountryKey(country) {
  return String(country || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function countryCodeFromCountry(country) {
  const key = normalizeCountryKey(country);
  return COUNTRY_CODE_BY_NAME[key] || null;
}

function normalizeRegion(region) {
  const raw = cleanText(region);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (US_STATE_TO_NAME[upper]) return US_STATE_TO_NAME[upper];
  return raw;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function buildIdFromEventUrl(eventUrl, fallbackName) {
  try {
    const path = new URL(eventUrl).pathname.replace(/\/+$/, "");
    const last = path.split("/").filter(Boolean).at(-1);
    if (last) return `bsides-${last}`;
  } catch {
    // no-op fallback below
  }
  return `bsides-${slugify(fallbackName)}`;
}

function isWithinWindow(dateStr) {
  return Boolean(dateStr && dateStr >= windowStart && dateStr <= windowEnd);
}

function fetchText(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      { headers: { "User-Agent": USER_AGENT } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (maxRedirects <= 0) return reject(new Error("Too many redirects"));
          const redirectUrl = new URL(res.headers.location, url).href;
          return resolve(fetchText(redirectUrl, maxRedirects - 1));
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

function unfoldIcsLines(icsText) {
  const rawLines = String(icsText || "").split(/\r?\n/);
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseIcsValue(rawValue) {
  return String(rawValue || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseIcsDate(value, isEndDate) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (/^\d{8}$/.test(raw)) {
    const year = Number.parseInt(raw.slice(0, 4), 10);
    const month = Number.parseInt(raw.slice(4, 6), 10);
    const day = Number.parseInt(raw.slice(6, 8), 10);
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (isEndDate) {
      dt.setUTCDate(dt.getUTCDate() - 1);
    }
    return dt.toISOString().slice(0, 10);
  }

  if (/^\d{8}T\d{6}Z$/.test(raw)) {
    const year = Number.parseInt(raw.slice(0, 4), 10);
    const month = Number.parseInt(raw.slice(4, 6), 10);
    const day = Number.parseInt(raw.slice(6, 8), 10);
    const hour = Number.parseInt(raw.slice(9, 11), 10);
    const minute = Number.parseInt(raw.slice(11, 13), 10);
    const second = Number.parseInt(raw.slice(13, 15), 10);
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second))
      .toISOString()
      .slice(0, 10);
  }

  return null;
}

function parseIcsEvents(icsText) {
  const lines = unfoldIcsLines(icsText);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const sep = line.indexOf(":");
    if (sep <= 0) continue;

    const keyPart = line.slice(0, sep);
    const valuePart = line.slice(sep + 1);
    const key = keyPart.split(";")[0].toUpperCase();
    const value = parseIcsValue(valuePart);

    if (!(key in current)) {
      current[key] = value;
    } else if (Array.isArray(current[key])) {
      current[key].push(value);
    } else {
      current[key] = [current[key], value];
    }
  }

  return events;
}

function extractUrlsFromText(text) {
  if (!text) return [];
  const matches = String(text).match(/https?:\/\/[^\s<>()]+/gi) || [];
  return matches.map((url) => url.replace(/[),.;]+$/, ""));
}

function normalizeEventPathKey(url) {
  try {
    const u = new URL(url);
    return (u.pathname || "").replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(url || "").trim().toLowerCase();
  }
}

function extractListEventHints(listHtml) {
  const hints = new Map();
  const rowRe = /<li[^>]*class="[^"]*tribe-events-calendar-list__event-row[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let rowMatch;

  while ((rowMatch = rowRe.exec(listHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const anchor = rowHtml.match(/<a[^>]*href="([^"]+)"[^>]*title="([^"]*)"[^>]*>/i);
    if (!anchor) continue;

    const eventUrl = decodeHtmlEntities(anchor[1] || "").trim();
    const titleText = cleanText(anchor[2] || "");

    const venueAddressMatch = rowHtml.match(/tribe-events-calendar-list__event-venue-address[^>]*>\s*([\s\S]*?)<\/span>/i);
    const descriptionMatch = rowHtml.match(/tribe-events-calendar-list__event-description[^>]*>\s*<p>([\s\S]*?)<\/p>/i);

    const venueAddress = venueAddressMatch ? cleanText(venueAddressMatch[1]) : "";
    const descriptionText = descriptionMatch ? cleanText(descriptionMatch[1]) : "";
    const summarySuffix = titleText.includes(" - ") ? titleText.split(" - ").slice(1).join(" - ") : "";

    const hasCompactDescriptionLocation =
      descriptionText.length > 0 &&
      descriptionText.length <= 70 &&
      /,\s*[A-Z]{2},\s*(?:USA|United States)\b|,\s*[A-Za-z][A-Za-z\s.'-]{2,}$/.test(descriptionText);

    const locationHint = venueAddress || summarySuffix || (hasCompactDescriptionLocation ? descriptionText : "");
    if (!locationHint) continue;

    const key = normalizeEventPathKey(eventUrl);
    if (!hints.has(key)) {
      hints.set(key, {
        locationHint,
        titleText,
        descriptionText,
      });
    }
  }

  return hints;
}

function parseLocation(rawLocation, rawSummary, rawDescription) {
  const locationText = cleanText(rawLocation || "");
  const descriptionText = cleanText(rawDescription || "");
  const summaryText = cleanText(rawSummary || "");

  let city = null;
  let region = null;
  let country = null;

  const candidates = [];
  if (locationText) candidates.push(locationText);
  if (summaryText.includes(" - ")) {
    candidates.push(summaryText.split(" - ").slice(1).join(" - ").trim());
  }

  // Do not derive location from free-text descriptions.
  // BSides descriptions frequently contain prose with commas that are not addresses.

  for (const block of candidates) {
    const compact = cleanText(block);
    if (!compact) continue;

    const usMatch = compact.match(/\b([^,]+),\s*([A-Z]{2}),\s*(USA|United States)\b/i);
    if (usMatch) {
      city = cleanText(usMatch[1]);
      region = normalizeRegion(usMatch[2]);
      country = "United States";
      break;
    }

    const threePart = compact.match(/\b([^,]+),\s*([^,]+),\s*([^,]+)\b/);
    if (threePart) {
      city = cleanText(threePart[1]);
      region = normalizeRegion(threePart[2]);
      country = cleanText(threePart[3]);
      if (country.length > 30) {
        city = null;
        region = null;
        country = null;
        continue;
      }
      break;
    }

    const twoPart = compact.match(/\b([^,]+),\s*([^,]+)\b/);
    if (twoPart) {
      city = cleanText(twoPart[1]);
      country = cleanText(twoPart[2]);
      break;
    }
  }

  if (!country && ONLINE_HINT.test(`${summaryText} ${descriptionText} ${locationText}`)) {
    return {
      city: null,
      region: null,
      country: "Online",
      country_code: null,
      is_online: true,
      venue: null,
    };
  }

  const cleanCountry = country ? cleanText(country) : null;
  const countryCode = cleanCountry ? countryCodeFromCountry(cleanCountry) : null;

  return {
    city: city || null,
    region: region || null,
    country: cleanCountry || "Unknown",
    country_code: countryCode,
    is_online: false,
    venue: locationText || null,
  };
}

function parseLinkCandidatesFromHtml(html) {
  const links = [];
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(html)) !== null) {
    const href = decodeHtmlEntities(match[1] || "").trim();
    const text = cleanText(match[2] || "");
    links.push({ href, text });
  }
  return links;
}

function toAbsoluteUrl(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function isUsefulExternalUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = (parsed.hostname || "").toLowerCase();
    const path = (parsed.pathname || "").toLowerCase();
    const query = (parsed.search || "").toLowerCase();
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (host === "bsides.org" || host.endsWith(".bsides.org")) return false;
    if (SOCIAL_HOST_PATTERN.test(host)) return false;
    if (host.includes("google.com") && path.includes("/calendar")) return false;
    if (host.includes("outlook.")) return false;
    if (path.endsWith(".ics") || query.includes("ical=1") || query.includes("outlook-ical=1")) return false;
    if (query.includes("action=template") || query.includes("rru=addsubscription")) return false;
    if (url.toLowerCase().startsWith("webcal://")) return false;
    return true;
  } catch {
    return false;
  }
}

function scoreEventUrlCandidate(url, text) {
  const hay = `${url} ${text}`.toLowerCase();
  if (CFP_URL_HINT.test(hay)) return -10;

  let score = 0;
  if (/ticket|register|event|conference|summit/.test(hay)) score += 4;
  if (/website|site|homepage/.test(hay)) score += 6;
  if (/agenda|schedule|speaker/.test(hay)) score += 2;
  if (/\/\@/.test(url) || /securitybsidesglobal/.test(hay)) score -= 8;
  if (/docs\.|github\.|linkedin\.|x\.com|twitter\.com|facebook\.com/.test(hay)) score -= 6;

  return score;
}

function findBestExternalEventUrl(links, fallbackUrl) {
  const candidates = [];
  for (const link of links) {
    const absolute = toAbsoluteUrl(link.href, fallbackUrl);
    if (!isUsefulExternalUrl(absolute)) continue;
    candidates.push({
      url: absolute,
      score: scoreEventUrlCandidate(absolute, link.text),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 0 && candidates[0].score >= 0) {
    return candidates[0].url;
  }
  return fallbackUrl;
}

function findCfpUrl(candidates, fallbackUrl, notes = "") {
  const urls = [];
  for (const item of candidates) {
    const absolute = toAbsoluteUrl(item.href || item, fallbackUrl);
    if (!absolute) continue;
    urls.push({
      url: absolute,
      text: cleanText(item.text || ""),
    });
  }

  const notesUrls = extractUrlsFromText(notes).map((url) => ({ url, text: "" }));
  urls.push(...notesUrls);

  for (const entry of urls) {
    if (CFP_URL_HINT.test(`${entry.url} ${entry.text}`)) {
      return entry.url;
    }
  }

  return null;
}

async function enrichFromDetailPage(event) {
  const html = await fetchText(event.event_url);
  const links = parseLinkCandidatesFromHtml(html);

  const canonicalEventUrl = findBestExternalEventUrl(links, event.event_url);
  const detailCfpUrl = findCfpUrl(links, event.event_url, `${event.notes || ""} ${event.raw_description || ""}`);

  const detailText = cleanText(html);
  const isOnlineHint = ONLINE_HINT.test(detailText);

  return {
    canonicalEventUrl,
    detailCfpUrl,
    isOnlineHint,
  };
}

function classifyDelivery(location, textBlob) {
  const online = ONLINE_HINT.test(textBlob || "") || Boolean(location.is_online);
  if (online && location.country !== "Online") {
    return "hybrid";
  }
  if (online) return "online";
  return "in_person";
}

function normalizeIcsEventToRecord(icsEvent) {
  const name = cleanText(icsEvent.SUMMARY || "");
  const eventUrl = cleanText(icsEvent.URL || "");
  const rawDescription = parseIcsValue(icsEvent.DESCRIPTION || "");
  const description = cleanText(rawDescription);

  const startDate = parseIcsDate(icsEvent.DTSTART, false);
  const endDate = parseIcsDate(icsEvent.DTEND, true) || startDate;

  const location = parseLocation(icsEvent.LOCATION, name, rawDescription);
  const cfpFromIcs = findCfpUrl([], eventUrl, `${rawDescription} ${description}`);

  const delivery = classifyDelivery(location, `${name} ${description} ${rawDescription}`);

  return {
    id: buildIdFromEventUrl(eventUrl, name),
    name,
    event_url: eventUrl,
    start_date: startDate,
    end_date: endDate,
    delivery,
    event_type: "conference",
    tags: ["security", "community", "bsides"],
    source: SOURCE,
    location,
    cfp: {
      has_cfp: Boolean(cfpFromIcs),
      cfp_url: cfpFromIcs,
      cfp_open_date: null,
      cfp_close_date: null,
      cfp_timezone: null,
      cfp_status: cfpFromIcs ? "open" : "unknown",
    },
    cost: {
      is_free: true,
      cost_level: "free",
      notes: "BSides events are community-run security conferences; pricing often free or sponsor-supported unless posted otherwise.",
    },
    notes: description || null,
    raw_description: rawDescription || "",
  };
}

async function main() {
  let listHtml = "";
  try {
    listHtml = await fetchText(LIST_URL);
  } catch (error) {
    console.warn(`WARN: could not fetch BSides list page for location hints: ${error.message}`);
  }

  const listHintsByPath = listHtml ? extractListEventHints(listHtml) : new Map();

  let icsText;
  try {
    icsText = await fetchText(ICS_URL);
  } catch (error) {
    console.error(`Failed to fetch BSides iCal feed: ${error.message}`);
    process.exit(1);
  }

  const icsEvents = parseIcsEvents(icsText);
  const normalized = icsEvents
    .map(normalizeIcsEventToRecord)
    .filter((event) => event.name && event.start_date && event.end_date && event.event_url)
    .filter((event) => isWithinWindow(event.start_date));

  const dedupeMap = new Map();
  for (const event of normalized) {
    const hint = listHintsByPath.get(normalizeEventPathKey(event.event_url));
    if (hint) {
      const parsedHintLocation = parseLocation(
        hint.locationHint,
        hint.titleText || event.name,
        "",
      );

      if (event.location.country === "Unknown" && parsedHintLocation.country !== "Unknown") {
        event.location = {
          ...event.location,
          city: parsedHintLocation.city,
          region: parsedHintLocation.region,
          country: parsedHintLocation.country,
          country_code: parsedHintLocation.country_code,
          venue: event.location.venue || parsedHintLocation.venue,
        };
      }
    }

    const key = `${event.start_date}|${event.name.toLowerCase()}|${event.event_url}`;
    if (!dedupeMap.has(key)) dedupeMap.set(key, event);
  }

  let records = [...dedupeMap.values()]
    .sort((a, b) => {
      const byDate = (a.start_date || "").localeCompare(b.start_date || "");
      if (byDate !== 0) return byDate;
      return a.name.localeCompare(b.name);
    });

  if (Number.isInteger(maxEvents) && maxEvents > 0) {
    records = records.slice(0, maxEvents);
  }

  const issues = [];

  if (!skipDetailFetch) {
    for (let i = 0; i < records.length; i += 1) {
      const event = records[i];
      process.stdout.write(`  [${i + 1}/${records.length}] Enriching ${event.name} ... `);

      try {
        const enriched = await enrichFromDetailPage(event);

        event.event_url = enriched.canonicalEventUrl || event.event_url;
        if (!event.id || event.id === "bsides-") {
          event.id = buildIdFromEventUrl(event.event_url, event.name);
        }

        if (enriched.detailCfpUrl && !event.cfp.cfp_url) {
          event.cfp.cfp_url = enriched.detailCfpUrl;
          event.cfp.has_cfp = true;
          event.cfp.cfp_status = "open";
        }

        if (enriched.isOnlineHint && event.delivery === "in_person") {
          event.delivery = "hybrid";
        }

        console.log("ok");
      } catch (error) {
        issues.push({
          name: event.name,
          event_url: event.event_url,
          stage: "detail_enrichment",
          reason: error.message,
        });
        console.log(`warn (${error.message})`);
      }

      if (i < records.length - 1) {
        await sleep(DETAIL_DELAY_MS);
      }
    }
  }

  for (const event of records) {
    delete event.raw_description;
  }

  const output = {
    generated_at: new Date().toISOString(),
    source: SOURCE,
    feed_url: ICS_URL,
    window_start: windowStart,
    window_end: windowEnd,
    total_events: records.length,
    total_with_cfp: records.filter((event) => event.cfp?.has_cfp).length,
    records,
    issues,
  };

  const outputPath = `data/bsides-events-${runDate}.json`;
  writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");

  console.log(`\nWrote ${records.length} BSides records to ${outputPath}`);
  console.log(`Records with CFP URLs: ${output.total_with_cfp}`);
  if (issues.length > 0) {
    console.log(`Issues: ${issues.length}`);
  }
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});
