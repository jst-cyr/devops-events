import { TWO_WEEKS_DAYS, type EventListItem } from "@/lib/events-types";

const EVENT_WINDOW_WEEKS = Math.floor(TWO_WEEKS_DAYS / 7);

function dayOrdinal(day: number): string {
  if (day >= 11 && day <= 13) {
    return `${day}th`;
  }

  const remainder = day % 10;
  if (remainder === 1) {
    return `${day}st`;
  }
  if (remainder === 2) {
    return `${day}nd`;
  }
  if (remainder === 3) {
    return `${day}rd`;
  }
  return `${day}th`;
}

function formatEditionDate(now: Date): string {
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(now);
  const day = now.getUTCDate();

  return `${month} ${dayOrdinal(day)}`;
}

function emojiForCountry(countryCode: string, isOnline: boolean): string {
  if (isOnline || countryCode.toUpperCase() === "XX") {
    return ":earth_americas:";
  }

  const normalized = countryCode.toLowerCase();
  if (["us", "de", "jp", "gb"].includes(normalized)) {
    return `:${normalized}:`;
  }

  return `:flag-${normalized}:`;
}

function formatLocation(item: EventListItem): string {
  if (item.location.is_online) {
    return "Online";
  }

  const parts = [item.location.city, item.location.region, item.location.country].filter(Boolean);
  return parts.join(", ");
}

function formatEventDateRange(item: EventListItem): string {
  if (item.start_date === item.end_date) {
    return item.start_date;
  }

  return `${item.start_date} to ${item.end_date}`;
}

function formatCfpLine(item: EventListItem): string {
  const emoji = emojiForCountry(item.location.country_code, item.location.is_online);
  const location = formatLocation(item);
  const due = item.cfp.cfp_close_date ?? "Unknown";
  const cfpUrl = item.cfp.cfp_url ?? item.event_url;

  return `${emoji} ${item.name} (${location}). CFP due ${due}: ${cfpUrl}`;
}

function formatEventLine(item: EventListItem): string {
  const emoji = emojiForCountry(item.location.country_code, item.location.is_online);
  const location = formatLocation(item);
  const when = formatEventDateRange(item);

  return `${emoji} ${item.name} (${location}). ${when}: ${item.event_url}`;
}

export function buildSlackAnnouncement(options: {
  now: Date;
  cfps: EventListItem[];
  events: EventListItem[];
  cfpWindowDays?: number;
}): string {
  const cfpWeeks = Math.floor((options.cfpWindowDays ?? TWO_WEEKS_DAYS) / 7);
  const heading = `:people_hugging: *Tech Events Around the World (${formatEditionDate(options.now)} edition)*`;
  const intro = `This week's update highlights CFP deadlines closing in the next ${cfpWeeks} weeks and events in the next ${EVENT_WINDOW_WEEKS} weeks where Puppet/DevOps/DevSecOps might be in the conversation. For upcoming events, only free events are shown. Looking for more, including bigger events that have a ticket price? Check out the new: https://devops-events.vercel.app/.`;

  const cfpLines = options.cfps.length
    ? options.cfps.map(formatCfpLine)
    : [`_No CFP opportunities closing in the next ${cfpWeeks} weeks._`];

  const eventLines = options.events.length
    ? options.events.map(formatEventLine)
    : [`_No events happening in the next ${EVENT_WINDOW_WEEKS} weeks._`];

  return [
    heading,
    intro,
    "",
    "*CFP opportunities closing soon:*",
    ...cfpLines,
    "",
    "*Events happening soon:*",
    ...eventLines,
  ].join("\n");
}
