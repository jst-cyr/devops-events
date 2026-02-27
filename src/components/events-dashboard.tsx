"use client";

import * as Flags from "country-flag-icons/react/3x2";
import { Globe } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DEFAULT_PAGE_SIZE,
  type DashboardFeedResponse,
  type DashboardKind,
  type EventListItem,
} from "@/lib/events-types";
import { ThemeToggle } from "@/components/theme-toggle";

type FeedState = DashboardFeedResponse & {
  loading: boolean;
  error: string | null;
};

function getFlagComponent(countryCode: string) {
  const normalizedCountryCode = countryCode.trim().toUpperCase();

  if (!normalizedCountryCode || !(normalizedCountryCode in Flags)) {
    return null;
  }

  return Flags[normalizedCountryCode as keyof typeof Flags];
}

function DeliveryIcon({ item }: { item: EventListItem }) {
  const normalizedCountryCode = item.location.country_code.trim().toUpperCase();
  const countryLabel = item.location.country || normalizedCountryCode;
  const FlagIcon = getFlagComponent(normalizedCountryCode);

  if (item.delivery === "online") {
    return (
      <span className="inline-flex items-center" role="img" aria-label="Online event">
        <Globe className="h-4 w-4" aria-hidden="true" />
      </span>
    );
  }

  if (item.delivery === "in_person") {
    if (FlagIcon) {
      return (
        <span className="inline-flex items-center" role="img" aria-label={`In-person event in ${countryLabel}`}>
          <FlagIcon className="h-4 w-6 rounded-[2px]" aria-hidden="true" />
        </span>
      );
    }

    return (
      <span className="inline-flex items-center" role="img" aria-label="In-person event">
        <Globe className="h-4 w-4" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`Hybrid event in ${countryLabel}`}>
      {FlagIcon ? <FlagIcon className="h-4 w-6 rounded-[2px]" aria-hidden="true" /> : <Globe className="h-4 w-4" aria-hidden="true" />}
      <Globe className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatLocation(item: EventListItem): string {
  if (item.location.is_online) {
    return "Online";
  }

  const locationParts = [item.location.city, item.location.region, item.location.country].filter(Boolean);
  return locationParts.join(", ");
}

function EventItem({ item, kind }: { item: EventListItem; kind: DashboardKind }) {
  return (
    <li className="h-full rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <DeliveryIcon item={item} />
        <h3 className="text-base font-semibold">{item.name}</h3>
      </div>
      {kind === "cfp" && item.cfp.cfp_close_date ? (
        <div className="mt-2">
          <Badge variant="outline">CFP closes {formatDate(item.cfp.cfp_close_date)}</Badge>
        </div>
      ) : null}
      <p className="text-muted-foreground mt-1 text-sm">
        {formatDate(item.start_date)}
        {item.end_date !== item.start_date ? ` - ${formatDate(item.end_date)}` : ""}
      </p>
      <p className="text-muted-foreground text-sm">{formatLocation(item)}</p>
      <div className="mt-3 flex flex-wrap gap-4">
        <Link
          href={item.event_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-block text-sm font-medium hover:underline"
        >
          Open event
        </Link>
        {kind === "cfp" && item.cfp.cfp_url ? (
          <Link
            href={item.cfp.cfp_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-block text-sm font-medium hover:underline"
          >
            Open CFP
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function FeedSection({
  title,
  description,
  kind,
  state,
  onLoadMore,
}: {
  title: string;
  description: string;
  kind: DashboardKind;
  state: FeedState;
  onLoadMore: (kind: DashboardKind) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">No matching upcoming items.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {state.items.map((item) => (
              <EventItem key={item.id} item={item} kind={kind} />
            ))}
          </ul>
        )}

        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

        {state.hasMore ? (
          <Button onClick={() => onLoadMore(kind)} disabled={state.loading} className="w-full sm:w-auto">
            {state.loading ? "Loading..." : "Load more"}
          </Button>
        ) : state.items.length > 0 ? (
          <p className="text-muted-foreground text-xs">All {state.total} items loaded.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

async function loadMoreFeed(kind: DashboardKind, cursor: number, apiPath: string) {
  const response = await fetch(`${apiPath}?kind=${kind}&cursor=${cursor}&limit=${DEFAULT_PAGE_SIZE}`);

  if (!response.ok) {
    throw new Error(response.status === 429 ? "Rate limit reached. Please wait and retry." : "Unable to load more events.");
  }

  const data = (await response.json()) as DashboardFeedResponse;
  return data;
}

export function EventsDashboard({
  initialCfps,
  initialEvents,
  apiPath = "/api/events",
  title = "DevOps Events Dashboard",
  subtitle = "Showing upcoming CFPs and events. Load more to view the next page.",
}: {
  initialCfps: DashboardFeedResponse;
  initialEvents: DashboardFeedResponse;
  apiPath?: string;
  title?: string;
  subtitle?: string;
}) {
  const [cfpState, setCfpState] = useState<FeedState>({
    ...initialCfps,
    loading: false,
    error: null,
  });
  const [eventState, setEventState] = useState<FeedState>({
    ...initialEvents,
    loading: false,
    error: null,
  });

  const handleLoadMore = async (kind: DashboardKind) => {
    const updateState = kind === "cfp" ? setCfpState : setEventState;
    const currentState = kind === "cfp" ? cfpState : eventState;

    if (!currentState.hasMore || currentState.nextCursor === null || currentState.loading) {
      return;
    }

    updateState((previous) => ({ ...previous, loading: true, error: null }));

    try {
      const next = await loadMoreFeed(kind, currentState.nextCursor, apiPath);
      updateState((previous) => ({
        ...previous,
        items: [...previous.items, ...next.items],
        nextCursor: next.nextCursor,
        hasMore: next.hasMore,
        total: next.total,
        loading: false,
        error: null,
      }));
    } catch (error) {
      updateState((previous) => ({
        ...previous,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load more events.",
      }));
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          <ThemeToggle />
        </div>
        <p className="text-muted-foreground mt-2 text-sm sm:text-base">{subtitle}</p>
      </header>

      <div className="space-y-6">
        <FeedSection
          title="CFPs"
          description="Showing upcoming CFP deadlines"
          kind="cfp"
          state={cfpState}
          onLoadMore={handleLoadMore}
        />
        <FeedSection
          title="Upcoming Events"
          description="Showing upcoming events"
          kind="events"
          state={eventState}
          onLoadMore={handleLoadMore}
        />
      </div>
    </div>
  );
}
