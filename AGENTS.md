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

- The PLOTOS FUND app lives as a self-contained page in public/plotos/ and the home page shows it full-screen; edit that file directly so the existing trading engine and Biquote feed stay untouched.
- Keep chart interaction on Lightweight Charts plus a pointer-event canvas overlay, so live prices, orders, and saved drawings share one coordinate system.
- Use one pointer-event SL/TP drag handler and keep previews separate from saved position state until explicit confirmation, to prevent competing gestures and accidental saves.
- PLOTOS accounts and trading are simulated; never present them as live broker accounts or real-money execution unless a verified broker and payment integration is actually implemented.
- Challenge requests stay pending until approved by ADMIN or FINANCE. Account assignment/approval is not a payment processor; wallet entries are client-synced and must be manually verified. Only ADMIN may change/reset/fund account state.
- Client-side role checks are UX safeguards, not authorization boundaries. Never add client-editable role fields or RLS policies that let a trader change roles, account status, balances, risk rules, or firm settings. Real enforcement requires server-side authorization/RPCs and database policies; do not claim it is secure until deployed and verified.
- Do not add parallel Supabase auth/account tables without reviewing the existing `pf_users_data`/`pf_firm` blob sync and current policies. Never apply a migration to the live project without showing its exact effects and obtaining approval.
- `fetchK` already validates, merges, and stores candle history in a bounded local LRU cache; preserve this behavior and never label cached/closed prices as live. Do not replace it with an unbounded per-symbol cache.
- `public/plotos/admin.html` intentionally redirects to the authenticated staff portal in `index.html?portal=admin`; never replace it with a localStorage-only mock admin dashboard.
- Capacitor config and Android/iOS native projects already exist. Extend the existing setup rather than adding duplicate configs or regenerating platforms blindly.
- Load the Biquote instrument catalogue with `quotedWithinDays=7`, not `liveOnly=true`; the latter hides closed-market instruments. Quote freshness must remain separate from instrument visibility, and cached quotes must never authorize simulated orders.
- Keep chart candles on the Bid/Ask midpoint and spread lines on exact Bid and Ask. Reconcile the final candle only when a timestamped quote belongs to its timeframe period, including calendar months; never rewrite other historical bars, and ignore older or untimed quotes after a reliable newer quote.
- Before changing Supabase tables or RLS, inspect the live schema and policies. The current JSON blob sync is not authoritative for balances or entitlements; do not claim financial/account-state security without server-side enforcement. See `SECURITY_AND_DATABASE.md`.

- Funding programs and broker profiles in the catalog are simulations. New funding requests remain PENDING until authorized staff review; instant mode removes evaluation targets, not the approval gate. Only a wallet-recorded simulated fee may be credited once with the first ADMIN-approved payout; do not imply real cash refunds, broker access, fixed spreads, or live execution.
- Keep program-specific risk rules and commission settings attached to the account/template. Broker simulation templates must never be assignable as Prop accounts, and user-facing copy must disclose simulation and the lack of a live payment/broker connection.
