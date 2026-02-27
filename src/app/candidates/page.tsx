import { EventsDashboard } from "@/components/events-dashboard";
import { getDashboardFeed } from "@/lib/events-data";

export const revalidate = 86400;

const INITIAL_PAGE_SIZE = 30;

export default async function CandidatesPage() {
  const [initialCfps, initialEvents] = await Promise.all([
    getDashboardFeed({ kind: "cfp", source: "candidates", limit: INITIAL_PAGE_SIZE }),
    getDashboardFeed({ kind: "events", source: "candidates", limit: INITIAL_PAGE_SIZE }),
  ]);

  return (
    <EventsDashboard
      initialCfps={initialCfps}
      initialEvents={initialEvents}
      apiPath="/api/candidates"
      title="Candidate Review Dashboard"
      subtitle="Review candidate CFPs and events, then click through to event and CFP pages."
      showSlackTools={false}
    />
  );
}
