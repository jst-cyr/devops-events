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
  type DashboardTimeframe,
  type EventListItem,
} from "@/lib/events-types";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

function EventItem({
  item,
  kind,
  showCfpCloseDate,
}: {
  item: EventListItem;
  kind: DashboardKind;
  showCfpCloseDate?: boolean;
}) {
  return (
    <li className="h-full rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <DeliveryIcon item={item} />
        <h3 className="text-base font-semibold">{item.name}</h3>
      </div>
      {(kind === "cfp" || showCfpCloseDate) && item.cfp.cfp_close_date ? (
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
  showCfpCloseDate,
  onLoadMore,
}: {
  title: string;
  description: string;
  kind: DashboardKind;
  state: FeedState;
  showCfpCloseDate?: boolean;
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
          <p className="text-muted-foreground text-sm">No matching items.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {state.items.map((item) => (
              <EventItem key={item.id} item={item} kind={kind} showCfpCloseDate={showCfpCloseDate} />
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

async function fetchFeedPage(options: {
  kind: DashboardKind;
  cursor: number;
  apiPath: string;
  timeframe?: DashboardTimeframe;
  country?: string;
}) {
  const params = new URLSearchParams({
    kind: options.kind,
    timeframe: options.timeframe ?? "upcoming",
    cursor: String(options.cursor),
    limit: String(DEFAULT_PAGE_SIZE),
  });

  if (options.country) {
    params.set("country", options.country);
  }

  const response = await fetch(`${options.apiPath}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(response.status === 429 ? "Rate limit reached. Please wait and retry." : "Unable to load more events.");
  }

  const data = (await response.json()) as DashboardFeedResponse;
  return data;
}

export function EventsDashboard({
  initialCfps,
  initialEvents,
  initialPastEvents,
  apiPath = "/api/events",
  title = "DevOps Events Dashboard",
  subtitle = "Showing upcoming CFPs and events. Load more to view the next page.",
  countryOptions,
}: {
  initialCfps: DashboardFeedResponse;
  initialEvents: DashboardFeedResponse;
  initialPastEvents?: DashboardFeedResponse;
  apiPath?: string;
  title?: string;
  subtitle?: string;
  countryOptions?: string[];
}) {
  const [selectedCountry, setSelectedCountry] = useState<string>("");
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
  const [pastEventState, setPastEventState] = useState<FeedState | null>(
    initialPastEvents
      ? {
          ...initialPastEvents,
          loading: false,
          error: null,
        }
      : null,
  );

  const resetToInitialFeeds = () => {
    setCfpState({ ...initialCfps, loading: false, error: null });
    setEventState({ ...initialEvents, loading: false, error: null });
    setPastEventState(
      initialPastEvents
        ? {
            ...initialPastEvents,
            loading: false,
            error: null,
          }
        : null,
    );
  };

  const loadFilteredFeeds = async (country: string) => {
    setCfpState((previous) => ({ ...previous, loading: true, error: null }));
    setEventState((previous) => ({ ...previous, loading: true, error: null }));
    setPastEventState((previous) => (previous ? { ...previous, loading: true, error: null } : previous));

    try {
      const [cfpFeed, eventFeed, pastFeed] = await Promise.all([
        fetchFeedPage({ kind: "cfp", cursor: 0, apiPath, timeframe: "upcoming", country }),
        fetchFeedPage({ kind: "events", cursor: 0, apiPath, timeframe: "upcoming", country }),
        pastEventState
          ? fetchFeedPage({ kind: "events", cursor: 0, apiPath, timeframe: "past", country })
          : Promise.resolve<DashboardFeedResponse | null>(null),
      ]);

      setCfpState({ ...cfpFeed, loading: false, error: null });
      setEventState({ ...eventFeed, loading: false, error: null });

      if (pastEventState && pastFeed) {
        setPastEventState({ ...pastFeed, loading: false, error: null });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to apply country filter.";
      setCfpState((previous) => ({ ...previous, loading: false, error: message }));
      setEventState((previous) => ({ ...previous, loading: false, error: message }));
      setPastEventState((previous) => (previous ? { ...previous, loading: false, error: message } : previous));
    }
  };

  const handleCountryChange = async (country: string) => {
    setSelectedCountry(country);

    if (!country) {
      resetToInitialFeeds();
      return;
    }

    await loadFilteredFeeds(country);
  };

  const handleLoadMore = async (kind: DashboardKind, timeframe: DashboardTimeframe = "upcoming") => {
    const currentState =
      kind === "cfp"
        ? cfpState
        : timeframe === "past"
          ? pastEventState
          : eventState;

    if (!currentState) {
      return;
    }

    if (!currentState.hasMore || currentState.nextCursor === null || currentState.loading) {
      return;
    }

    if (kind === "cfp") {
      setCfpState((previous) => ({ ...previous, loading: true, error: null }));
    } else if (timeframe === "past") {
      setPastEventState((previous) => (previous ? { ...previous, loading: true, error: null } : previous));
    } else {
      setEventState((previous) => ({ ...previous, loading: true, error: null }));
    }

    try {
      const next = await fetchFeedPage({
        kind,
        cursor: currentState.nextCursor,
        apiPath,
        timeframe,
        country: selectedCountry || undefined,
      });

      if (kind === "cfp") {
        setCfpState((previous) => ({
          ...previous,
          items: [...previous.items, ...next.items],
          nextCursor: next.nextCursor,
          hasMore: next.hasMore,
          total: next.total,
          loading: false,
          error: null,
        }));
      } else if (timeframe === "past") {
        setPastEventState((previous) =>
          previous
            ? {
                ...previous,
                items: [...previous.items, ...next.items],
                nextCursor: next.nextCursor,
                hasMore: next.hasMore,
                total: next.total,
                loading: false,
                error: null,
              }
            : previous,
        );
      } else {
        setEventState((previous) => ({
          ...previous,
          items: [...previous.items, ...next.items],
          nextCursor: next.nextCursor,
          hasMore: next.hasMore,
          total: next.total,
          loading: false,
          error: null,
        }));
      }
    } catch (error) {
      if (kind === "cfp") {
        setCfpState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load more events.",
        }));
      } else if (timeframe === "past") {
        setPastEventState((previous) =>
          previous
            ? {
                ...previous,
                loading: false,
                error: error instanceof Error ? error.message : "Unable to load more events.",
              }
            : previous,
        );
      } else {
        setEventState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load more events.",
        }));
      }
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

        {countryOptions && countryOptions.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="country-filter" className="text-sm font-medium">
              Filter by country
            </label>
            <Select
              value={selectedCountry || "all"}
              onValueChange={(value) => void handleCountryChange(value === "all" ? "" : value)}
            >
              <SelectTrigger id="country-filter" className="sm:w-72">
                <SelectValue placeholder="All countries" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All countries</SelectItem>
                {(countryOptions ?? []).map((country) => (
                  <SelectItem key={country} value={country}>
                    {country}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </header>

      <div className="space-y-6">
        <FeedSection
          title="CFPs"
          description="Showing upcoming CFP deadlines"
          kind="cfp"
          state={cfpState}
          onLoadMore={(kind) => handleLoadMore(kind, "upcoming")}
        />
        <FeedSection
          title="Upcoming Events"
          description="Showing upcoming events"
          kind="events"
          state={eventState}
          onLoadMore={(kind) => handleLoadMore(kind, "upcoming")}
        />
        {pastEventState ? (
          <FeedSection
            title="Past Events"
            description="Showing past events for review"
            kind="events"
            state={pastEventState}
            showCfpCloseDate
            onLoadMore={(kind) => handleLoadMore(kind, "past")}
          />
        ) : null}
      </div>
    </div>
  );
}
