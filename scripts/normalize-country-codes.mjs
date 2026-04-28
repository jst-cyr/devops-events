#!/usr/bin/env node

// Normalize event country_code values with delivery-aware rules:
// - online events => country_code: null
// - in_person/hybrid events => country_code must be a non-null ISO alpha-2 value
//
// Usage:
//   node scripts/normalize-country-codes.mjs [path-to-events-json]
//
// Default target: data/events.json

import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_FILE = "data/events.json";
const targetFile = process.argv[2] || DEFAULT_FILE;

const COUNTRY_CODE_FALLBACKS = {
  angola: "AO",
  argentina: "AR",
  australia: "AU",
  austria: "AT",
  belgium: "BE",
  "bosnia and herzegovina": "BA",
  brazil: "BR",
  bulgaria: "BG",
  canada: "CA",
  chile: "CL",
  colombia: "CO",
  croatia: "HR",
  "czech republic": "CZ",
  denmark: "DK",
  finland: "FI",
  france: "FR",
  georgia: "GE",
  germany: "DE",
  greece: "GR",
  hungary: "HU",
  india: "IN",
  indonesia: "ID",
  ireland: "IE",
  israel: "IL",
  italy: "IT",
  japan: "JP",
  kenya: "KE",
  lithuania: "LT",
  luxembourg: "LU",
  malaysia: "MY",
  mexico: "MX",
  netherlands: "NL",
  "new zealand": "NZ",
  nigeria: "NG",
  norway: "NO",
  peru: "PE",
  philippines: "PH",
  poland: "PL",
  portugal: "PT",
  romania: "RO",
  russia: "RU",
  serbia: "RS",
  singapore: "SG",
  "south africa": "ZA",
  "south korea": "KR",
  spain: "ES",
  sweden: "SE",
  switzerland: "CH",
  taiwan: "TW",
  tanzania: "TZ",
  thailand: "TH",
  turkey: "TR",
  turkiye: "TR",
  uk: "GB",
  ukraine: "UA",
  "united kingdom": "GB",
  "united states": "US",
  usa: "US",
  uzbekistan: "UZ",
  vietnam: "VN",
};

function normalizeCountryKey(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function loadEvents(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const records = Array.isArray(parsed.records) ? parsed.records : [];
  return { parsed, records };
}

function buildCountryCodeLookup(records) {
  const lookup = { ...COUNTRY_CODE_FALLBACKS };

  for (const record of records) {
    const location = record.location || {};
    const delivery = (record.delivery || "").toLowerCase();
    const countryKey = normalizeCountryKey(location.country);
    const code = typeof location.country_code === "string" ? location.country_code.trim().toUpperCase() : "";

    if (!countryKey || !code || delivery === "online") {
      continue;
    }

    lookup[countryKey] = code;
  }

  return lookup;
}

function ensureLocationShape(record) {
  if (record.location && typeof record.location === "object") {
    return record.location;
  }

  record.location = {
    city: null,
    region: null,
    country: record.delivery === "online" ? "Online" : "",
    country_code: null,
    is_online: record.delivery === "online",
    venue: null,
  };

  return record.location;
}

function normalizeCountryCodes(records, lookup) {
  let onlineToNull = 0;
  let filledMissing = 0;
  let uppercased = 0;
  const unresolved = [];

  for (const record of records) {
    const location = ensureLocationShape(record);
    const delivery = (record.delivery || "").toLowerCase();
    const countryKey = normalizeCountryKey(location.country);

    if (delivery === "online" || countryKey === "online") {
      if (location.country_code !== null) {
        onlineToNull += 1;
      }
      location.country_code = null;
      location.is_online = true;
      if (!location.country || !String(location.country).trim()) {
        location.country = "Online";
      }
      continue;
    }

    if (typeof location.country_code === "string" && location.country_code.trim()) {
      const normalizedCode = location.country_code.trim().toUpperCase();
      if (normalizedCode !== location.country_code) {
        uppercased += 1;
      }
      location.country_code = normalizedCode;
      continue;
    }

    const resolvedCode = lookup[countryKey];
    if (resolvedCode) {
      location.country_code = resolvedCode;
      filledMissing += 1;
      continue;
    }

    unresolved.push({
      id: record.id || null,
      name: record.name || null,
      delivery: record.delivery || null,
      country: location.country || null,
    });
  }

  return {
    onlineToNull,
    filledMissing,
    uppercased,
    unresolved,
  };
}

function main() {
  const { parsed, records } = loadEvents(targetFile);
  const lookup = buildCountryCodeLookup(records);
  const result = normalizeCountryCodes(records, lookup);

  writeFileSync(targetFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

  console.log(`Updated ${targetFile}`);
  console.log(`Online country_code -> null: ${result.onlineToNull}`);
  console.log(`Filled missing country_code: ${result.filledMissing}`);
  console.log(`Uppercased country_code: ${result.uppercased}`);
  console.log(`Unresolved in-person/hybrid records: ${result.unresolved.length}`);

  if (result.unresolved.length > 0) {
    for (const entry of result.unresolved.slice(0, 20)) {
      console.log(`  - ${entry.id || entry.name} | ${entry.delivery || "unknown"} | ${entry.country || "unknown"}`);
    }
    process.exitCode = 2;
  }
}

main();
