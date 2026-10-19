# PLUTUS

Mobile-ready simulated trading platform.

## Development and CI

Use **Bun 1.4.3** as the canonical package manager; the repository tracks `bun.lock` (and `backend/bun.lock`). Do not run `npm install` because no npm lockfile is maintained. Node.js 22+ is also required by build tools.

```sh
git clone https://github.com/kuetomadred-ai/hello-world-helper.git
cd hello-world-helper
bun install --frozen-lockfile
bun run dev
```

CI runs frozen installs, Vitest, lint, the web build, Capacitor Android sync, an Android debug APK build, and backend typecheck/tests. Run the matching local checks with:

```sh
bun run test
bun run lint
bun run build
cd backend && bun install --frozen-lockfile && bun run typecheck && bun run test
```

## Capacitor (Android and iOS)

The mobile wrapper packages the existing PLUTUS page from `public/plotos/` as a local web app. The native projects load bundled assets; no remote development server is configured.

The native app ID is `com.plutus.trading`. The existing `/plotos/` web path and legacy local-storage keys remain unchanged for backward compatibility; the app display name, native identifiers, and auth callback use PLUTUS.

Requirements: Node.js 22 or newer, Android Studio with an Android SDK for Android builds, and macOS with Xcode 26 or newer for iOS builds. iOS projects can be prepared in this repository, but compiling and signing them requires macOS and Xcode.

The Android and iOS native project folders are included in this repository. After cloning, install the dependencies:

```sh
bun install --frozen-lockfile
```

Build the web app, stage the PLUTUS page in Capacitor's `dist/` directory, and sync both native projects:

```sh
bun run mobile:sync
```

Run `bun run mobile:build` alone only when you want to prepare `dist/` without syncing native projects. Use `bunx cap add android` or `bunx cap add ios` only if the corresponding native folder has been removed and needs to be regenerated. Native icons and launch screens use the existing `public/plotos/assets/mt5-app-icon.png` mark; regenerate them with `python3 scripts/generate-mobile-brand-assets.py` (requires Pillow).

Open one platform in its native IDE after syncing:

```sh
bun run mobile:android
bun run mobile:ios
```

`mobile:android` opens Android Studio after syncing. To create a debug APK, run `cd android && ./gradlew assembleDebug`; the APK is written under `android/app/build/outputs/apk/debug/`. On macOS, `mobile:ios` opens the iOS project in Xcode, where you can build/run or archive after selecting a signing team. Android release signing, iOS signing, and store submission still require the owner's developer accounts and credentials.

The debug APK is signed with Android's development key for device testing only; do not publish it to an app store.

Native Supabase sessions use iOS Keychain / Android Keystore via `@aparajita/capacitor-secure-storage`; existing WebView localStorage sessions are migrated once and removed after secure copy. Browser sessions remain on Supabase's web storage path. The plugin's web fallback is not used as a mobile security boundary.

### Mobile email confirmation

The native projects register the `com.plutus.trading://auth/callback` URL scheme, and the mobile build handles Supabase confirmation links sent to that URI. In the Supabase Dashboard, add the exact URI under **Authentication → URL Configuration → Redirect URLs** before testing signup or resend-confirmation on a device. For production, prefer Universal Links/App Links on a domain you own; domain association and release signing must be configured for that domain.


## Server-side trading engine and NOWPayments

The Fastify API and Biquote worker are in `backend/`; the single-process entrypoint is `bun run start`. Trading is simulated only. The engine migration at `supabase/migrations/20261016090000_server_side_paper_engine.sql` is tracked locally and was **not applied** to the live database in this update.

NOWPayments invoice and webhook routes remain under `src/routes/api/public/payments/`. The webhook records payment status but does not auto-approve funding or grant an account. Keep `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `PLOTOS_SERVICE_ROLE_KEY`, and Supabase service-role keys server-side only.

`public/plotos/engine-config.js` currently leaves the engine API URL blank, so trading remains disabled until a backend is deployed and configured. Web invoice calls use the application origin; native builds require `PLUTUS_PAYMENTS_API_URL` to point at the HTTPS application server. Supabase Auth also needs `com.plutus.trading://auth/callback` in its redirect URL allowlist.

Render's free web service is for best-effort testing and sleeps after inactivity; it does not provide reliable 24/7 market monitoring. Do not use periodic pings as a keep-alive workaround.
