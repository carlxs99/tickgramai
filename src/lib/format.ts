export function formatGram(n: number | string, decimals = 2) {
  const v = typeof n === "string" ? Number(n) : n;
  if (!isFinite(v)) return "0";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(2) + "K";
  return v.toFixed(decimals);
}

// Formats amounts (like task rewards) with enough decimals to always show a
// non-zero value. e.g. 0.1 → "0.1", 0.05 → "0.05", 0.001 → "0.001".
// Never displays "0.00" for a positive amount.
export function formatReward(n: number | string) {
  const v = typeof n === "string" ? Number(n) : n;
  if (!isFinite(v) || v === 0) return "0";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(2) + "K";
  const decimals = Math.min(8, Math.max(2, -Math.floor(Math.log10(Math.abs(v))) + 1));
  return Number(v.toFixed(decimals)).toString();
}
