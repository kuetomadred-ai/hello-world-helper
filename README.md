# Hello World Helper

مرحبا

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/da9e1081-8856-41b2-8b61-dc3067a0b712).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development and CI

Use **Bun 1.4.3** as the canonical package manager; the repository tracks `bun.lock` (and `backend/bun.lock`). Do not run `npm install` because no npm lockfile is maintained. Node.js 22+ is also required by build tools.

```sh
git clone https://github.com/kuetomadred-ai/trade-buddy-evolution.git
cd trade-buddy-evolution
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

The mobile wrapper packages the existing Plutus page from `public/plotos/` as a local web app. The native projects load bundled assets; no remote development server is configured.

The native app ID is `com.plutus.trading`. The existing `/plotos/` web path and legacy local-storage keys remain unchanged for backward compatibility; the app display name, native identifiers, and auth callback use Plutus.

Requirements: Node.js 22 or newer, Android Studio with an Android SDK for Android builds, and macOS with Xcode 26 or newer for iOS builds. iOS projects can be prepared in this repository, but compiling and signing them requires macOS and Xcode.

The Android and iOS native project folders are included in this repository. After cloning, install the dependencies:

```sh
bun install --frozen-lockfile
```

Build the web app, stage the Plutus page in Capacitor's `dist/` directory, and sync both native projects:

```sh
bun run mobile:sync
```

Run `bun run mobile:build` alone only when you want to prepare `dist/` without syncing native projects. Use `bunx cap add android` or `bunx cap add ios` only if the corresponding native folder has been removed and needs to be regenerated. Native icons and launch screens use the existing `public/favicon.ico` mark; regenerate them with `python3 scripts/generate-mobile-brand-assets.py` (requires Pillow).

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
