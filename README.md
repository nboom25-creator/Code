# TimeFlow ⏳

A personal time-management app for iOS & Android, built with **React Native + Expo**.
All data is stored **locally on your device** — no account, no backend, fully private.

## Features

- **✅ Tasks** — capture to-dos with priorities, **due dates**, and **recurrence**
  (daily / weekdays / weekly). Completing a repeating task automatically spawns the
  next occurrence. Filter active/completed and jump straight into a focus session.
- **🔔 Reminders** — set a due date and get a local notification when a task is due.
- **📅 Calendar** — plan your day by scheduling tasks into time blocks; browse day
  by day and see how many hours you've planned.
- **🍅 Focus** — a customizable Pomodoro timer (focus / short break / long break)
  that automatically logs your focus time.
- **📊 Reports** — see where your time goes: totals, tasks completed, a 7-day
  activity chart, a per-activity breakdown, plus **manual time logging** for work
  you forgot to track.
- **⚙️ Settings** — switch between **light / dark / system** themes, manage
  notification permissions, **export/import a JSON backup**, and erase all data.

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
    index.tsx             # Tasks (due dates, recurrence)
    calendar.tsx          # Calendar / scheduling
    focus.tsx             # Pomodoro focus timer
    reports.tsx           # Time-tracking reports + manual logging
    settings.tsx          # Theme, notifications, backup/restore
src/
  store/AppContext.tsx    # central state, persisted to AsyncStorage
  storage/storage.ts      # AsyncStorage JSON wrapper
  components/ui.tsx        # shared themed UI primitives
  hooks/useNow.ts         # ticking clock hook
  utils/time.ts           # date / duration / recurrence helpers
  utils/notifications.ts  # local notification scheduling
  types.ts                # data models
  theme.tsx               # light/dark palettes + ThemeProvider
```

## Themes

The app ships with light and dark palettes and a `system` option that follows the
OS appearance. Your choice is persisted. Styles are built through a `makeStyles`
hook so they rebuild instantly when you switch themes.

## Notifications

Setting a due date schedules a local notification via `expo-notifications`.
Grant the permission from the **Settings** tab (or when first prompted). Local
notifications work in a development build; in Expo Go support can be limited
depending on platform/SDK, but the rest of the app is unaffected.

## How data is stored

State lives in a single React context (`AppContext`) and is automatically
serialized to `AsyncStorage` whenever it changes, so your tasks, schedule,
tracked time, and timer settings persist between launches. Clearing the app's
storage (or uninstalling) resets everything.
