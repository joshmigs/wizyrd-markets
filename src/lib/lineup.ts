import { ALLOWED_TICKERS } from "@/lib/assets";

export type LineupPositionInput = {
  ticker: string;
  weight: number;
};

export type LineupValidationResult =
  | { ok: true; normalized: LineupPositionInput[]; weightSum: number }
  | { ok: false; error: string };

const WEIGHT_TOLERANCE = 0.0001;

export function validateLineupPositions(
  positions: LineupPositionInput[],
  expectedCount = 5,
  allowedTickers: Set<string> | null = ALLOWED_TICKERS
): LineupValidationResult {
  if (!Array.isArray(positions) || positions.length !== expectedCount) {
    return {
      ok: false,
      error: `Lineup must include exactly ${expectedCount} assets.`
    };
  }

  const normalized = positions.map((position) => ({
    ticker: position.ticker.trim().toUpperCase(),
    weight: position.weight
  }));

  const allowlist =
    allowedTickers && allowedTickers.size > 0 ? allowedTickers : ALLOWED_TICKERS;
  const sanitizedAllowlist = new Set(allowlist);
  sanitizedAllowlist.delete("SPY");

  const seen = new Set<string>();
  for (const position of normalized) {
    if (!position.ticker) {
      return { ok: false, error: "Ticker is required." };
    }
    if (sanitizedAllowlist.size > 0 && !sanitizedAllowlist.has(position.ticker)) {
      return { ok: false, error: `${position.ticker} is not in the allowed universe.` };
    }
    if (seen.has(position.ticker)) {
      return { ok: false, error: "Duplicate tickers are not allowed." };
    }
    seen.add(position.ticker);

    if (!Number.isFinite(position.weight) || position.weight <= 0) {
      return { ok: false, error: "Weights must be positive numbers." };
    }
  }

  const weightSum = normalized.reduce((sum, position) => sum + position.weight, 0);
  if (Math.abs(weightSum - 1) > WEIGHT_TOLERANCE) {
    return {
      ok: false,
      error: `Weights must sum to 100%. Current sum: ${(weightSum * 100).toFixed(2)}%`
    };
  }

  return { ok: true, normalized, weightSum };
}

export function isLineupLocked(lockTime: string | Date, now = new Date()) {
  const lockDate = typeof lockTime === "string" ? new Date(lockTime) : lockTime;
  return now.getTime() >= lockDate.getTime();
}
