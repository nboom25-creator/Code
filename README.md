# TimeFlow ⏳

A personal time-management app for iOS & Android, built with **React Native + Expo**.
All data is stored **locally on your device** — no account, no backend, fully private.

## Features

- **✅ Tasks** — capture to-dos with priorities, filter active/completed, and jump
  straight into a focus session for any task.
- **📅 Calendar** — plan your day by scheduling tasks into time blocks; browse day
  by day and see how many hours you've planned.
- **🍅 Focus** — a customizable Pomodoro timer (focus / short break / long break)
  that automatically logs your focus time.
- **📊 Reports** — see where your time goes: totals, tasks completed, a 7-day
  activity chart, and a per-activity breakdown.

## Running the app

You'll need [Node.js](https://nodejs.org) (18+). Then:

```bash
npm install
npm start
```

This starts the Expo dev server and shows a QR code.

- **On your phone:** install the **Expo Go** app (App Store / Google Play) and scan
  the QR code. The app loads instantly.
- **iOS Simulator:** press `i` in the terminal (requires Xcode on macOS).
- **Android Emulator:** press `a` (requires Android Studio).
- **Web preview:** press `w` (handy for a quick look).

> If `npm install` reports Expo version mismatches, run `npx expo install` once to
> align native package versions with the installed Expo SDK.

## Project structure

```
app/                      # expo-router screens (file-based routing)
  _layout.tsx             # root providers (state, gestures, safe area)
  (tabs)/
    _layout.tsx           # bottom tab bar
    index.tsx             # Tasks
    calendar.tsx          # Calendar / scheduling
    focus.tsx             # Pomodoro focus timer
    reports.tsx           # Time-tracking reports
src/
  store/AppContext.tsx    # central state, persisted to AsyncStorage
  storage/storage.ts      # AsyncStorage JSON wrapper
  components/ui.tsx        # shared UI primitives
  hooks/useNow.ts         # ticking clock hook
  utils/time.ts           # date / duration helpers
  types.ts                # data models
  theme.ts                # colors, spacing, radius
```

## How data is stored

State lives in a single React context (`AppContext`) and is automatically
serialized to `AsyncStorage` whenever it changes, so your tasks, schedule,
tracked time, and timer settings persist between launches. Clearing the app's
storage (or uninstalling) resets everything.
