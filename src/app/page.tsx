import { EventsDashboard } from "@/components/events-dashboard";
import { getAvailableCostLevels, getAvailableLocations, getDashboardFeed } from "@/lib/events-data";

export const revalidate = 86400;

const INITIAL_PAGE_SIZE = 30;

export default async function Home() {
  const [initialCfps, initialEvents, initialPastEvents, locationOptions, costLevelOptions] = await Promise.all([
    getDashboardFeed({ kind: "cfp", limit: INITIAL_PAGE_SIZE }),
    getDashboardFeed({ kind: "events", limit: INITIAL_PAGE_SIZE }),
    getDashboardFeed({ kind: "events", timeframe: "past", limit: INITIAL_PAGE_SIZE }),
    getAvailableLocations("events"),
    getAvailableCostLevels("events"),
  ]);

  return (
    <EventsDashboard
      initialCfps={initialCfps}
      initialEvents={initialEvents}
      initialPastEvents={initialPastEvents}
      countryOptions={locationOptions}
      costLevelOptions={costLevelOptions}
    />
  );
}
