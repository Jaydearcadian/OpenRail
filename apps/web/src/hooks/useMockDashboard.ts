import { useEffect, useMemo, useReducer, useState } from "react";
import { buildLiveDashboardData, type LiveDashboardData } from "../data/showcase";
import { fetchOpenRailsDashboard, OPENRAILS_PAYCARDS } from "../services/openrailsApi";
import type { DashboardAction, DashboardRoute, DashboardState } from "../types/dashboard";

const initialState: DashboardState = {
  route: "overview",
  sidebarCollapsed: false,
  selectedStreamId: OPENRAILS_PAYCARDS[0]?.id ?? "",
  activeModal: null,
  scenario: "normal",
  web3State: "disconnected",
};

function reducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case "set-route":
      return { ...state, route: action.route };
    case "toggle-sidebar":
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case "select-stream":
      return { ...state, selectedStreamId: action.streamId, route: "streams" };
    case "open-modal":
      return { ...state, activeModal: action.modal };
    case "close-modal":
      return { ...state, activeModal: null };
    case "set-scenario":
      return { ...state, scenario: action.scenario };
    case "set-web3-state":
      return { ...state, web3State: action.web3State };
    default:
      return state;
  }
}

const routeTitles: Record<DashboardRoute, { title: string; description: string }> = {
  overview: {
    title: "OpenRails control room",
    description: "Understand what is signed projection data and what is final receipt data.",
  },
  create: {
    title: "Create previews",
    description: "Walk RailsCard and RailsFlow setup without signing or submitting transactions.",
  },
  streams: {
    title: "Payment streams",
    description: "Inspect live Worker rails, projected accrual, metadata state, and receipt status.",
  },
  gateway: {
    title: "Gateway projection",
    description: "Review the off-chain projection boundary before terminal settlement.",
  },
  receipts: {
    title: "Settlement receipts",
    description: "Use terminal receipt records as the authoritative accounting layer.",
  },
  proof: {
    title: "Proof center",
    description: "Follow the testnet evidence and references behind the V1 flow.",
  },
  settings: {
    title: "Demo settings",
    description: "Preview loading, empty, error, and future web3 states without wallet writes.",
  },
};

type LiveStatus =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: LiveDashboardData; error: null }
  | { status: "error"; data: null; error: string };

export function useMockDashboard() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [live, setLive] = useState<LiveStatus>({ status: "loading", data: null, error: null });

  useEffect(() => {
    const controller = new AbortController();

    fetchOpenRailsDashboard(controller.signal)
      .then((data) => {
        setLive({ status: "ready", data: buildLiveDashboardData(data), error: null });
      })
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

  const selectedStream = useMemo(
    () => live.data?.streamDetails.find((stream) => stream.id === state.selectedStreamId) ?? live.data?.streamDetails[0],
    [live.data?.streamDetails, state.selectedStreamId],
  );

  return {
    state,
    dispatch,
    routeTitle: routeTitles[state.route],
    selectedStream,
    live,
  };
}
