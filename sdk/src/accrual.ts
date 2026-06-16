export interface StreamState {
  paycardId: string;
  poolBalance: bigint;
  initialAllocation: bigint;
  maxFlowRatePerSecond: bigint;
  startTimestamp: number;           // Unix seconds
  durationSeconds: number;
  lastCheckpointTimestamp: number;  // Unix seconds
  status: "active" | "depleted";
}

/**
 * TypeScript mirror of paycard_v1::calculate_accrual_debt.
 * Returns tokens accrued since last checkpoint, capped at pool balance.
 * Pure — no I/O.
 */
export function calculateAccrualDebt(state: StreamState, currentTimeSec: number): bigint {
  if (state.status !== "active") return 0n;
  if (currentTimeSec <= state.lastCheckpointTimestamp) return 0n;

  const endTime = state.startTimestamp + state.durationSeconds;
  const applicableTime = currentTimeSec > endTime ? endTime : currentTimeSec;
  if (applicableTime <= state.lastCheckpointTimestamp) return 0n;

  const deltaTime = BigInt(applicableTime - state.lastCheckpointTimestamp);
  const accrued = deltaTime * state.maxFlowRatePerSecond;
  return accrued > state.poolBalance ? state.poolBalance : accrued;
}

/**
 * Projects the stream state at a given wall-clock time.
 * Returns accrued tokens, projected remaining balance, and exhaustion flag.
 */
export function projectStreamAt(
  state: StreamState,
  currentTimeSec: number
): { accrued: bigint; remaining: bigint; isExhausted: boolean } {
  const accrued = calculateAccrualDebt(state, currentTimeSec);
  const remaining = state.poolBalance - accrued;
  return { accrued, remaining, isExhausted: remaining === 0n };
}
