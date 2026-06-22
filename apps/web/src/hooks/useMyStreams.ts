import { useCallback, useEffect, useState } from "react";
import { useSuiClient, useCurrentAccount } from "@mysten/dapp-kit";
import { fetchMintedChannels, fetchPaycard, type PaycardView } from "../lib/paycard";
import { OPENRAILS_PACKAGE_ID } from "../config";
import { mistToSui, humanRate, clockOf, shortId, humanDuration } from "../lib/format";
import type { Stream } from "../data/mock";
import type { StreamDetail } from "../types/dashboard";

type Role = "payer" | "recipient";

function statusOf(view: PaycardView): Stream["status"] {
  if (view.status === 2 || view.status === 3) return "settled";
  if (Date.now() / 1000 > view.startSec + view.durationSec) return "warning"; // window elapsed
  return "active";
}

function mapToStream(view: PaycardView, role: Role): { stream: Stream; detail: StreamDetail } {
  const initial = BigInt(view.initialAllocation || "0");
  const pool = BigInt(view.poolValue || "0");
  const drawn = initial > pool ? initial - pool : 0n;
  const counterparty = role === "payer" ? view.recipient : view.payer;
  const type: Stream["type"] = role === "recipient" ? "RailsFlow" : "RailsCard";

  const stream: Stream = {
    id: view.id,
    label: `your channel · ${role}`,
    counterparty: shortId(counterparty, 6, 4),
    type,
    status: statusOf(view),
    rate: humanRate(view.ratePerSec),
    accrued: `${mistToSui(drawn)} SUI`,
    remaining: `${mistToSui(pool)} SUI`,
    metadata: "owned channel",
    receipt: view.status === 0 ? "pending receipt" : "settled",
    region: "Sui object",
    asOf: view.startSec ? clockOf(view.startSec) : "at mint",
  };

  const detail: StreamDetail = {
    ...stream,
    terms: `${humanRate(view.ratePerSec)} over ${humanDuration(view.durationSec)}`,
    payer: shortId(view.payer, 8, 6),
    recipient: shortId(view.recipient, 8, 6),
    projectionSource: "Read live from the Sui object (your channel).",
    safetyNote: "Read directly from chain. SettlementReceipt remains the authoritative accounting source.",
    region: "Sui object",
    asOf: view.startSec ? clockOf(view.startSec) : "at mint",
    ratePerSecMist: view.ratePerSec,
    startTimestampSec: view.startSec || undefined,
    endTimestampSec: view.startSec ? view.startSec + view.durationSec : undefined,
    payerFull: view.payer,
    recipientFull: view.recipient,
  };

  return { stream, detail };
}

/**
 * The connected wallet's own channels, read directly from chain (PaycardMinted
 * discovery + live object reads) and shaped for the Rails/Overview surfaces.
 * Global and cross-device — no localStorage, no Worker dependency.
 */
export function useMyStreams(): { streams: Stream[]; details: StreamDetail[] } {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [details, setDetails] = useState<StreamDetail[]>([]);

  const load = useCallback(async () => {
    if (!account) { setStreams([]); setDetails([]); return; }
    try {
      const discovered = await fetchMintedChannels(client, OPENRAILS_PACKAGE_ID, account.address);
      const views = await Promise.all(
        discovered.map((d) => fetchPaycard(client, d.id).then((v) => ({ v, role: d.role })).catch(() => ({ v: null, role: d.role }))),
      );
      const ss: Stream[] = [];
      const dd: StreamDetail[] = [];
      for (const { v, role } of views) {
        if (!v) continue;
        const m = mapToStream(v, role);
        ss.push(m.stream);
        dd.push(m.detail);
      }
      setStreams(ss);
      setDetails(dd);
    } catch {
      /* discovery is best-effort */
    }
  }, [client, account]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  return { streams, details };
}
