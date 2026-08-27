import DashboardDataLoader from "./components/DashboardDataLoader";
import { getReports } from "./lib/reports";

export default function Home() {
  const reports = getReports();

  return (
    <main className="dashboard">
      <DashboardDataLoader reports={reports} />
    </main>
  );
}
