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
  let s = v.toFixed(decimals);
  // Keep leading zeros (e.g. 0.00000011) but drop trailing zeros and the redundant dot
  s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return s;
}

// Telegram avatar URLs (t.me/i/userpic/...) block cross-origin loads in the
// browser due to CORP/hotlink protection. Route them through our proxy so
// they always render. Non-Telegram URLs pass through untouched.
export function avatarSrc(url: string | null | undefined, telegramId?: string | number | null): string | undefined {
  const id = telegramId === null || telegramId === undefined ? "" : String(telegramId);
  if (!url && id) return `/api/public/avatar?id=${encodeURIComponent(id)}`;
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname === "t.me" && u.pathname.startsWith("/i/userpic/")) {
      const qs = new URLSearchParams({ u: url });
      if (id) qs.set("id", id);
      return `/api/public/avatar?${qs.toString()}`;
    }
  } catch {
    return url;
  }
  return url;
}
