"use client";

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

type FeedState = DashboardFeedResponse & {
  loading: boolean;
  error: string | null;
};

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
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{item.delivery.replace("_", " ")}</Badge>
        {kind === "cfp" && item.cfp.cfp_close_date ? (
          <Badge variant="outline">CFP closes {formatDate(item.cfp.cfp_close_date)}</Badge>
        ) : null}
      </div>
      <h3 className="mt-3 text-base font-semibold">{item.name}</h3>
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
          <p className="text-muted-foreground text-sm">No matching items in the next 4 weeks.</p>
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
  subtitle = "Initial view shows the next 4 weeks. Load more shows later dates.",
  showSlackTools = true,
}: {
  initialCfps: DashboardFeedResponse;
  initialEvents: DashboardFeedResponse;
  apiPath?: string;
  title?: string;
  subtitle?: string;
  showSlackTools?: boolean;
}) {
  const [slackPost, setSlackPost] = useState<string>("");
  const [slackLoading, setSlackLoading] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [slackCopied, setSlackCopied] = useState(false);
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

  const handleGenerateSlackPost = async () => {
    setSlackLoading(true);
    setSlackError(null);
    setSlackCopied(false);

    try {
      const response = await fetch("/api/slack-announcement", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Unable to generate Slack announcement.");
      }

      const payload = (await response.json()) as { message: string };
      setSlackPost(payload.message);
    } catch (error) {
      setSlackError(error instanceof Error ? error.message : "Unable to generate Slack announcement.");
    } finally {
      setSlackLoading(false);
    }
  };

  const handleCopySlackPost = async () => {
    if (!slackPost) {
      return;
    }

    try {
      await navigator.clipboard.writeText(slackPost);
      setSlackCopied(true);
    } catch {
      setSlackError("Could not copy to clipboard. Please copy manually from the text box.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {showSlackTools ? (
            <Button onClick={handleGenerateSlackPost} disabled={slackLoading} className="w-full sm:w-auto">
              {slackLoading ? "Generating..." : "Generate Slack Post"}
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground mt-2 text-sm sm:text-base">{subtitle}</p>
      </header>

      {showSlackTools && slackPost ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Slack announcement draft</CardTitle>
            <CardDescription>Generated for the next 4 weeks of CFPs and events.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="bg-background min-h-56 w-full rounded-md border p-3 text-sm"
              readOnly
              value={slackPost}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={handleCopySlackPost}>Copy text</Button>
              {slackCopied ? <p className="text-sm text-muted-foreground">Copied.</p> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {showSlackTools && slackError ? <p className="mb-4 text-sm text-destructive">{slackError}</p> : null}

      <div className="space-y-6">
        <FeedSection
          title="CFPs"
          description="Showing CFPs closing in the next 4 weeks first"
          kind="cfp"
          state={cfpState}
          onLoadMore={handleLoadMore}
        />
        <FeedSection
          title="Upcoming Events"
          description="Showing upcoming events in the next 4 weeks first"
          kind="events"
          state={eventState}
          onLoadMore={handleLoadMore}
        />
      </div>
    </div>
  );
}
