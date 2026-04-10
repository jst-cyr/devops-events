export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 30;
export const TWO_WEEKS_DAYS = 14;
export const THREE_WEEKS_DAYS = 21;
export const FOUR_WEEKS_DAYS = 28;

export type DashboardKind = "cfp" | "events";
export type DashboardTimeframe = "upcoming" | "past";
export type CostLevel = "free" | "budget" | "standard" | "premium";

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
  cost?: {
    is_free: boolean;
    lowest_price?: number | null;
    price_currency?: string;
    cost_level?: CostLevel;
    notes?: string | null;
  };
  notes?: string | null;
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
  cost?: EventRecord["cost"];
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
