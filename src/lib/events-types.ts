export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 30;
export const FOUR_WEEKS_DAYS = 28;

export type DashboardKind = "cfp" | "events";

export type EventRecord = {
  id: string;
  name: string;
  event_url: string;
  start_date: string;
  end_date: string;
  delivery: "in_person" | "online" | "hybrid";
  event_type?: string;
  tags?: string[];
  source: string;
  location: {
    city: string | null;
    region: string | null;
    country: string;
    country_code: string;
    is_online: boolean;
    venue: string | null;
  };
  cfp?: {
    has_cfp: boolean;
    cfp_url: string | null;
    cfp_open_date: string | null;
    cfp_close_date: string | null;
    cfp_timezone: string | null;
    cfp_status: "upcoming" | "open" | "closing_soon" | "closed" | "unknown";
  };
  notes?: string | null;
  status?: string;
};

export type EventListItem = {
  id: string;
  name: string;
  event_url: string;
  start_date: string;
  end_date: string;
  delivery: EventRecord["delivery"];
  location: EventRecord["location"];
  event_type?: string;
  tags?: string[];
  cfp: {
    has_cfp: boolean;
    cfp_url: string | null;
    cfp_close_date: string | null;
  };
};

export type DashboardFeedResponse = {
  kind: DashboardKind;
  items: EventListItem[];
  cursor: number;
  nextCursor: number | null;
  hasMore: boolean;
  total: number;
};
