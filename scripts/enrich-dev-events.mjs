#!/usr/bin/env node

// Enrich shortlisted dev.events records by fetching each detail page
// and extracting the canonical (non-dev.events) event URL.
//
// Usage:
//   node scripts/enrich-dev-events.mjs <YYYY-MM-DD>
//
// Input:   data/dev-events-shortlist-<date>.json
// Output:  data/dev-events-enriched-<date>.json

import { readFileSync, writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";

const DELAY_MS = 1500; // polite pause between requests
const EXCLUDED_SHORTLIST_TOPIC_PATTERN =
  /power\s+platform|microsoft\s+power\s+platform|power\s*apps?|power\s*automate|power\s*bi|dynamics\s*365/i;
const EXCLUDED_SHORTLIST_FORMAT_PATTERN =
  /^\s*course\s*:|\bcourse\b|\bbootcamp\b|\btraining\b|\bcertification\b|\/courses?\//i;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let runDate = args[0];
if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
  const d = new Date();
  runDate = d.toISOString().slice(0, 10);
}

const inputFile = `data/dev-events-shortlist-${runDate}.json`;
const outputFile = `data/dev-events-enriched-${runDate}.json`;

console.log(`Input : ${inputFile}`);
console.log(`Output: ${outputFile}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch a URL following redirects, return { body, finalUrl, redirectUrl }. */
function fetchPage(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; devops-events-bot/1.0)",
        },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (maxRedirects <= 0)
            return reject(new Error("Too many redirects"));
          const target = new URL(res.headers.location, url).href;
          return resolve(
            fetchPage(target, maxRedirects - 1).then((r) => ({
              ...r,
              redirectUrl: r.redirectUrl || target,
            }))
          );
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf-8"),
            finalUrl: url,
            redirectUrl: null,
          })
        );
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
 * Extract canonical URL from a dev.events detail page HTML.
 * Priority:
 *   1. Explicit outbound link (Visit website, Official site, etc.)
 *   2. Embedded iframe src
 *   3. null (not found)
 */
function extractCanonicalUrl(html, devEventsUrl) {
  // Strategy 1: Look for explicit outbound links
  // Common patterns: "Visit website", "Official site", "Event website", "conference website"
  const linkPatterns = [
    /href="(https?:\/\/[^"]+)"[^>]*>\s*(?:Visit\s+website|Official\s+site|Event\s+website|conference\s+website|Go\s+to\s+website|Website)/gi,
    /href="(https?:\/\/[^"]+)"[^>]*>\s*(?:Visit|Official|Website)/gi,
  ];

  for (const pattern of linkPatterns) {
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const url = m[1];
      if (isValidCanonicalUrl(url, devEventsUrl)) {
        return { url, method: "explicit_outbound_link" };
      }
    }
  }

  // Strategy 2: Look for iframe src (embedded event page)
  const iframeRe = /<iframe[^>]+src="(https?:\/\/[^"]+)"[^>]*>/gi;
  let m;
  while ((m = iframeRe.exec(html)) !== null) {
    const url = m[1];
    if (isValidCanonicalUrl(url, devEventsUrl)) {
      return { url, method: "iframe_src" };
    }
  }

  // Strategy 3: Look for og:url or canonical link that's NOT dev.events
  const ogUrlRe = /<meta[^>]+property="og:url"[^>]+content="(https?:\/\/[^"]+)"/i;
  const ogMatch = ogUrlRe.exec(html);
  if (ogMatch && isValidCanonicalUrl(ogMatch[1], devEventsUrl)) {
    return { url: ogMatch[1], method: "og_url" };
  }

  const canonicalRe = /<link[^>]+rel="canonical"[^>]+href="(https?:\/\/[^"]+)"/i;
  const canMatch = canonicalRe.exec(html);
  if (canMatch && isValidCanonicalUrl(canMatch[1], devEventsUrl)) {
    return { url: canMatch[1], method: "canonical_link" };
  }

  // Strategy 4: Look for any prominent external link in the main content area
  // Find links that look like event homepages (not social media, not dev.events)
  const allLinks = [];
  const allLinksRe = /href="(https?:\/\/[^"]+)"/gi;
  while ((m = allLinksRe.exec(html)) !== null) {
    const url = m[1];
    if (
      isValidCanonicalUrl(url, devEventsUrl) &&
      !url.includes("twitter.com") &&
      !url.includes("x.com") &&
      !url.includes("linkedin.com") &&
      !url.includes("facebook.com") &&
      !url.includes("youtube.com") &&
      !url.includes("github.com") &&
      !url.includes("meetup.com") &&
      !url.includes("google.com") &&
      !url.includes("fonts.") &&
      !url.includes("cdn.") &&
      !url.includes("schema.org") &&
      !url.includes("cloudflare")
    ) {
      allLinks.push(url);
    }
  }
  if (allLinks.length > 0) {
    // Return the first external link as a best guess
    return { url: allLinks[0], method: "first_external_link" };
  }

  return null;
}

function isValidCanonicalUrl(url, devEventsUrl) {
  if (!url || !url.startsWith("https://")) return false;
  if (url.includes("dev.events")) return false;
  if (url.startsWith("javascript:")) return false;
  if (url.startsWith("data:")) return false;
  if (url.length < 10) return false;
  return true;
}

/** Remove obvious tracking params from a URL. */
function cleanUrl(url) {
  try {
    const u = new URL(url);
    const removeParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "ref",
      "source",
      "fbclid",
      "gclid",
    ];
    removeParams.forEach((p) => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

function getShortlistExclusionReason(record) {
  const searchText = [
    record.name || "",
    record.topic || "",
    record.dev_events_url || "",
  ].join(" ");

  if (EXCLUDED_SHORTLIST_TOPIC_PATTERN.test(searchText)) {
    return "excluded topic: Microsoft Power Platform family";
  }

  if (EXCLUDED_SHORTLIST_FORMAT_PATTERN.test(searchText)) {
    return "excluded format: course/training content";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const input = JSON.parse(readFileSync(inputFile, "utf-8"));
  const allRecords = Array.isArray(input.records) ? input.records : [];
  const excludedAtShortlist = allRecords
    .map((r) => ({ record: r, reason: getShortlistExclusionReason(r) }))
    .filter((x) => Boolean(x.reason));
  const records = allRecords.filter((r) => !getShortlistExclusionReason(r));

  if (excludedAtShortlist.length > 0) {
    console.log(
      `\nShortlist pre-filter: excluded ${excludedAtShortlist.length} out-of-scope records before enrichment.`
    );
    for (const x of excludedAtShortlist) {
      console.log(`  - EXCLUDED: ${x.record.name} (${x.reason})`);
    }
  }

  console.log(`\nProcessing ${records.length} events...\n`);

  const enriched = [];
  const issues = [];
  let resolved = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const label = `[${i + 1}/${records.length}] ${r.name}`;
    process.stdout.write(`${label} ... `);

    try {
      const { body } = await fetchPage(r.dev_events_url);
      const result = extractCanonicalUrl(body, r.dev_events_url);

      if (result) {
        const canonicalUrl = cleanUrl(result.url);
        const methodNote = {
          explicit_outbound_link:
            "Canonical URL extracted via explicit outbound link.",
          iframe_src:
            "Canonical URL extracted from dev.events embedded iframe src (raw HTML fallback).",
          og_url: "Canonical URL extracted via og:url meta tag.",
          canonical_link: "Canonical URL extracted via canonical link tag.",
          first_external_link:
            "Canonical URL extracted via first external link (best guess).",
        }[result.method];

        enriched.push({
          ...r,
          event_url: canonicalUrl,
          canonical_method: result.method,
          notes: methodNote,
        });
        resolved++;
        console.log(`✓ ${result.method} → ${canonicalUrl}`);
      } else {
        failed++;
        issues.push({
          source: "dev.events",
          discovered_name: r.name,
          discovered_url: r.dev_events_url,
          attempted_url: r.dev_events_url,
          stage: "canonical_url_resolution",
          reason: "missing_canonical_url",
          http_status: 200,
          in_window: true,
          notes:
            "No canonical URL found on dev.events detail page. No outbound links, iframe, or meta tags detected.",
        });
        console.log(`✗ no canonical URL found`);
      }
    } catch (err) {
      failed++;
      issues.push({
        source: "dev.events",
        discovered_name: r.name,
        discovered_url: r.dev_events_url,
        attempted_url: r.dev_events_url,
        stage: "canonical_url_resolution",
        reason: "fetch_error",
        http_status: null,
        in_window: true,
        notes: `Error fetching detail page: ${err.message}`,
      });
      console.log(`✗ ERROR: ${err.message}`);
    }

    if (i < records.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n--- Enrichment Summary ---`);
  console.log(`Total:    ${records.length}`);
  console.log(`Resolved: ${resolved}`);
  console.log(`Failed:   ${failed}`);

  const output = {
    generated_at: new Date().toISOString(),
    source_file: inputFile,
    enrichment: {
      total: records.length,
      resolved,
      failed,
      excluded_at_shortlist: excludedAtShortlist.length,
    },
    records: enriched,
    issues,
  };

  writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`\nOutput saved to ${outputFile}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
