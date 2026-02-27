import { EventsDashboard } from "@/components/events-dashboard";
import { getDashboardFeed } from "@/lib/events-data";

export const revalidate = 3600;

export default async function Home() {
  const [initialCfps, initialEvents] = await Promise.all([
    getDashboardFeed({ kind: "cfp" }),
    getDashboardFeed({ kind: "events" }),
  ]);

  return <EventsDashboard initialCfps={initialCfps} initialEvents={initialEvents} />;
}
