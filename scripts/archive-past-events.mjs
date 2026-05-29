// archive-past-events.mjs
// Moves events older than 30 days from events.json to events-archive.json

import fs from 'fs';
import path from 'path';

const EVENTS_PATH = path.join('data', 'events.json');
const ARCHIVE_PATH = path.join('data', 'events-archive.json');
const DAYS_TO_KEEP = 30;

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Accepts YYYY-MM-DD or ISO8601
  const d = new Date(dateStr);
  return isNaN(d) ? null : d;
}

function isPast(dateStr) {
  const date = parseDate(dateStr);
  if (!date) return false;
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAYS_TO_KEEP);
  return date < cutoff;
}

function main() {
  const events = JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8'));
  let archive = [];
  if (fs.existsSync(ARCHIVE_PATH)) {
    archive = JSON.parse(fs.readFileSync(ARCHIVE_PATH, 'utf8'));
  }

  const keep = [];
  const toArchive = [];

  for (const event of events) {
    // Try endDate, fallback to startDate
    const endDate = event.endDate || event.date || event.startDate;
    if (isPast(endDate)) {
      toArchive.push({...event, _archived: new Date().toISOString().slice(0,10)});
    } else {
      keep.push(event);
    }
  }

  if (toArchive.length > 0) {
    fs.writeFileSync(EVENTS_PATH, JSON.stringify(keep, null, 2));
    fs.writeFileSync(ARCHIVE_PATH, JSON.stringify([...archive, ...toArchive], null, 2));
    console.log(`Archived ${toArchive.length} events.`);
  } else {
    console.log('No events to archive.');
  }
}

main();
