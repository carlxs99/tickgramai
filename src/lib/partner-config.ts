// Partner task pricing constants.
// Kept outside *.functions.ts: server-function files are split at build time and
// runtime module-scope siblings are stripped, which breaks the split module.
export const PARTNER_COST_PER_CLICK = 0.001; // TON
export const PARTNER_MIN_CLICKS = 250;
