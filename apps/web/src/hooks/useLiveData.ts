import { useEffect, useState } from "react";
import { buildLiveDashboardData, type LiveDashboardData } from "../data/showcase";
import { fetchOpenRailsDashboard } from "../services/openrailsApi";

export type LiveStatus =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: LiveDashboardData; error: null }
  | { status: "error"; data: null; error: string };

/** Fetches the public Worker dashboard data once. Decoupled from any UI reducer. */
export function useLiveData(): LiveStatus {
  const [live, setLive] = useState<LiveStatus>({ status: "loading", data: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    fetchOpenRailsDashboard(controller.signal)
      .then((data) => setLive({ status: "ready", data: buildLiveDashboardData(data), error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLive({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : "OpenRails Worker request failed",
        });
      });
    return () => controller.abort();
  }, []);

  return live;
}
