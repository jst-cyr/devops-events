import { NextRequest, NextResponse } from "next/server";

import { getDashboardFeed } from "@/lib/events-data";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type DashboardKind,
  type DashboardTimeframe,
} from "@/lib/events-types";

type RateLimitState = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

const rateLimitStore = new Map<string, RateLimitState>();

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

function checkRateLimit(clientIp: string): boolean {
  const now = Date.now();
  const current = rateLimitStore.get(clientIp);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(clientIp, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  current.count += 1;
  rateLimitStore.set(clientIp, current);
  return true;
}

function parseKind(kind: string | null): DashboardKind {
  return kind === "cfp" ? "cfp" : "events";
}

function parseCursor(cursor: string | null): number {
  const parsed = Number.parseInt(cursor ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseLimit(limit: string | null): number {
  const parsed = Number.parseInt(limit ?? `${DEFAULT_PAGE_SIZE}`, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(parsed, MAX_PAGE_SIZE);
}

function parseTimeframe(timeframe: string | null): DashboardTimeframe {
  return timeframe === "past" ? "past" : "upcoming";
}

function parseCountry(country: string | null): string | undefined {
  if (!country) {
    return undefined;
  }

  const normalized = country.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const isAllowed = checkRateLimit(clientIp);

  if (!isAllowed) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
      },
      {
        status: 429,
      },
    );
  }

  const url = new URL(request.url);
  const kind = parseKind(url.searchParams.get("kind"));
  const timeframe = parseTimeframe(url.searchParams.get("timeframe"));
  const cursor = parseCursor(url.searchParams.get("cursor"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const country = parseCountry(url.searchParams.get("country"));

  const feed = await getDashboardFeed({
    kind,
    source: "events",
    timeframe,
    cursor,
    limit,
    country,
  });

  return NextResponse.json(feed, {
    headers: {
      "Cache-Control": "public, s-maxage=86400",
    },
  });
}

function methodNotAllowed() {
  return NextResponse.json(
    {
      error: "Method not allowed",
    },
    {
      status: 405,
    },
  );
}

export async function POST() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
