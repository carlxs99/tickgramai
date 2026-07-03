export function formatGram(n: number | string, decimals = 2) {
  const v = typeof n === "string" ? Number(n) : n;
  if (!isFinite(v)) return "0";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(2) + "K";
  return v.toFixed(decimals);
}
