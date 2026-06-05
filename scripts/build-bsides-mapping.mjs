#!/usr/bin/env node

/**
 * Build BSides event mapping from allbsides.com
 * This discovers official website URLs for each BSides event
 * 
 * Usage: node scripts/build-bsides-mapping.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Hard-coded mapping from allbsides.com as of 2026-06-05
// In production, this should be scraped from allbsides.com dynamically
const ALLBSIDES_MAPPING = {
  'bsides-harrisburg': {
    name: 'BSides Harrisburg',
    dates: '2026-05-29',
    website: 'https://bsideshbg.com/',
    country: 'United States',
    region: 'Pennsylvania',
    city: 'Harrisburg',
  },
  'bsides-chennai': {
    name: 'BSides Chennai',
    dates: '2026-05-30',
    website: 'https://www.bsideschennai.in/',
    country: 'India',
    region: null,
    city: 'Chennai',
  },
  'bsides-maine': {
    name: 'BSides Maine',
    dates: '2026-05-30',
    website: 'https://www.bsidesmaine.org/',
    country: 'United States',
    region: 'Maine',
    city: null,
  },
  'bsides-edmonton': {
    name: 'BSides Edmonton',
    dates: '2026-06-05 - 06-06',
    website: 'https://www.bsidesedmonton.ca/',
    country: 'Canada',
    region: 'Alberta',
    city: 'Edmonton',
  },
  'bsides-recife': {
    name: 'BSides Recife',
    dates: '2026-06-05 - 06-06',
    website: 'https://www.bsidesrecife.com.br/',
    country: 'Brazil',
    region: 'Pernambuco',
    city: 'Recife',
  },
  'bsides-kristiansand': {
    name: 'BSides Kristiansand',
    dates: '2026-06-05',
    website: 'https://bsideskrs.no/',
    country: 'Norway',
    region: null,
    city: 'Kristiansand',
  },
  'bsides-roanoke': {
    name: 'BSides Roanoke',
    dates: '2026-06-05',
    website: 'https://bsidesroa.org/',
    country: 'United States',
    region: 'Virginia',
    city: 'Roanoke',
  },
  'bsides-buffalo': {
    name: 'BSides Buffalo',
    dates: '2026-06-06',
    website: 'https://www.bsidesbuffalo.org/',
    country: 'United States',
    region: 'New York',
    city: 'Buffalo',
  },
  'bsides-fort-wayne': {
    name: 'BSides Fort Wayne',
    dates: '2026-06-06',
    website: 'https://www.bsidesfortwayne.org/',
    country: 'United States',
    region: 'Indiana',
    city: 'Fort Wayne',
  },
  'bsides-boulder': {
    name: 'BSides Boulder',
    dates: '2026-06-12',
    website: 'https://www.bsidesboulder.org/',
    country: 'United States',
    region: 'Colorado',
    city: 'Boulder',
  },
  'bsides-satx': {
    name: 'BSides SATX',
    dates: '2026-06-13',
    website: 'https://www.bsidessatx.com/',
    country: 'United States',
    region: 'Texas',
    city: 'San Antonio',
  },
  'bsides-dsm': {
    name: 'BSides Des Moines',
    dates: '2026-06-13',
    website: 'https://www.bsidesdsm.org/',
    country: 'United States',
    region: 'Iowa',
    city: 'Des Moines',
  },
  'bsides-leeds': {
    name: 'BSides Leeds',
    dates: '2026-06-13',
    website: 'https://bsidesleeds.com/',
    country: 'United Kingdom',
    region: 'West Yorkshire',
    city: 'Leeds',
  },
  'bsides-umea': {
    name: 'BSides Umeå',
    dates: '2026-06-16',
    website: 'https://indico.neic.no/event/287/',
    country: 'Sweden',
    region: 'Västerbotten',
    city: 'Umeå',
  },
  'bsides-cochabamba': {
    name: 'BSides Cochabamba',
    dates: '2026-06-20',
    website: 'https://bsidescoco.com/',
    country: 'Bolivia',
    region: null,
    city: 'Cochabamba',
  },
  'bsides-vitoria': {
    name: 'BSides Vitória',
    dates: '2026-06-20',
    website: 'https://bsides.vix.br/',
    country: 'Brazil',
    region: 'Espírito Santo',
    city: 'Vitória',
  },
  'bsides-bsides-vitoria': {
    name: 'BSides Vitória',
    dates: '2026-06-20',
    website: 'https://bsides.vix.br/',
    country: 'Brazil',
    region: 'Espírito Santo',
    city: 'Vitória',
  },
  'bsides-joburg': {
    name: 'BSides Johannesburg',
    dates: '2026-07-25',
    website: 'https://www.bsidesjoburg.co.za/',
    country: 'South Africa',
    region: 'Gauteng',
    city: 'Johannesburg',
  },
  'bsides-bsides-joburg-2026': {
    name: 'BSides Johannesburg',
    dates: '2026-07-25',
    website: 'https://www.bsidesjoburg.co.za/',
    country: 'South Africa',
    region: 'Gauteng',
    city: 'Johannesburg',
  },
  'bsides-aarhus': {
    name: 'BSides Aarhus',
    dates: '2026-06-20',
    website: 'https://bsidesaarhus.dk/',
    country: 'Denmark',
    region: null,
    city: 'Aarhus',
  },
  'bsides-hk': {
    name: 'BSides Hong Kong',
    dates: '2026-06-25 - 06-26',
    website: 'https://bsideshk.org/',
    country: 'Hong Kong',
    region: null,
    city: 'Hong Kong',
  },
  'bsides-porto': {
    name: 'BSides Porto',
    dates: '2026-06-26 - 06-27',
    website: 'https://www.bsidesporto.com/',
    country: 'Portugal',
    region: 'Porto',
    city: 'Porto',
  },
  'bsides-vienna': {
    name: 'BSides Vienna',
    dates: '2026-06-27',
    website: 'https://bsidesvienna.at/',
    country: 'Austria',
    region: null,
    city: 'Vienna',
  },
  'bsides-brisbane': {
    name: 'BSides Brisbane',
    dates: '2026-07-04',
    website: 'https://bsidesbrisbane.com/',
    country: 'Australia',
    region: 'Queensland',
    city: 'Brisbane',
  },
  'bsides-pgh': {
    name: 'BSides Pittsburgh',
    dates: '2026-07-10',
    website: 'https://www.bsidespgh.com/',
    country: 'United States',
    region: 'Pennsylvania',
    city: 'Pittsburgh',
  },
  'bsides-joburg': {
    name: 'BSides Johannesburg',
    dates: '2026-07-25',
    website: 'https://www.bsidesjoburg.co.za/',
    country: 'South Africa',
    region: 'Gauteng',
    city: 'Johannesburg',
  },
  'bsides-adelaide': {
    name: 'BSides Adelaide',
    dates: '2026-07-27 - 07-28',
    website: 'https://www.bsidesadelaide.com.au/',
    country: 'Australia',
    region: 'South Australia',
    city: 'Adelaide',
  },
  'bsides-basingstoke': {
    name: 'BSides Basingstoke',
    dates: '2026-07-31',
    website: 'https://www.bsidesbasingstoke.com/',
    country: 'United Kingdom',
    region: 'Hampshire',
    city: 'Basingstoke',
  },
  'bsides-luanda': {
    name: 'BSides Luanda',
    dates: '2026-08-15',
    website: 'https://www.bsidesluanda.com/',
    country: 'Angola',
    region: null,
    city: 'Luanda',
  },
};

// Country code mapping
const COUNTRY_CODES = {
  'United States': 'US',
  'Canada': 'CA',
  'United Kingdom': 'GB',
  'Brazil': 'BR',
  'Norway': 'NO',
  'India': 'IN',
  'Denmark': 'DK',
  'Austria': 'AT',
  'Portugal': 'PT',
  'Hong Kong': 'HK',
  'Australia': 'AU',
  'South Africa': 'ZA',
  'Bolivia': 'BO',
  'Sweden': 'SE',
  'Angola': 'AO',
};

const OUTPUT_FILE = path.join(PROJECT_ROOT, 'data', 'bsides-website-mapping-2026-06-05.json');

function main() {
  console.log('📋 Building BSides Website Mapping\n');

  const mapping = {
    metadata: {
      run_date: '2026-06-05',
      timestamp: new Date().toISOString(),
      source: 'allbsides.com + manual curation',
      total_events: Object.keys(ALLBSIDES_MAPPING).length,
      notes: 'This mapping links BSides event IDs (from events-candidates.json) to official websites',
    },
    events: [],
  };

  for (const [eventId, eventData] of Object.entries(ALLBSIDES_MAPPING)) {
    mapping.events.push({
      event_id: eventId,
      name: eventData.name,
      official_website: eventData.website,
      location: {
        city: eventData.city,
        region: eventData.region,
        country: eventData.country,
        country_code: COUNTRY_CODES[eventData.country] || null,
      },
      event_dates: eventData.dates,
    });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mapping, null, 2));

  console.log(`✅ Mapping created with ${mapping.events.length} events`);
  console.log(`   File: ${path.relative(PROJECT_ROOT, OUTPUT_FILE)}\n`);
}

main();
