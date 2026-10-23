<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- Mining income is computed from `profiles.mining_rate_usd` (USD/day, fixed 3.3% of capital) and collected via `atomic_collect_income_usd`; every reward that grants "mining" must go through `atomic_add_mining_rate`. Why: single source of truth for earnings.
- Tables `hashrate_grants`, `payout_entries`, `payout_pool_daily`, `revenue_events`, `deferred_revenue`, `treasury_ledger`, `app_settings` and functions `grant_hashrate`, `add_revenue_event`, `add_deferred_revenue`, `run_daily_payout`, `claim_payouts`, `leaderboard_*`, `*_active_hashrate` are deprecated leftovers of the removed Economy v2; never read or write them from app code. Why: kept only so older deployed builds don't break; safe to drop later.
