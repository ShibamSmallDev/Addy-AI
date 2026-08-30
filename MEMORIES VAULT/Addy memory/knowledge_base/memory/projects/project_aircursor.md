---
type: project
id: project_aircursor
name: AirCursor
status: active (v0.9.14-beta as of May 2026)
---

# AirCursor

**What it is:** An Android app that turns the phone's own front camera into a
hand-gesture cursor controller — track the hand with MediaPipe's HandLandmarker,
map the landmarks to a system-wide cursor, and drive clicks/drags through an
Android Accessibility Service plus an overlay window. Built solo by
[[self|Shibam]].

## Tech stack
Kotlin · Jetpack Compose (Material 3) · CameraX · MVVM (Flow/state) ·
MediaPipe Tasks Vision HandLandmarker · Coroutines · Android Accessibility Service ·
`SYSTEM_ALERT_WINDOW` overlay. Package id `com.aircursor.app`.

## Timeline
- **2026-05-06** — First floated the idea ("I want to make an app which can use the
  mobile camera to control a virtual cursor by recognizing the hand gesture of the
  user") and wrote a PRD. *Android App Development 101*.
- **2026-05** — Active build phase; cycled through several AI coding copilots as
  each hit rate limits or went down: Google Antigravity → Cursor AI → Claude Code,
  with DeepSeek used for code review. *Air Cursor Main chat*, *Using me instead of
  Antigravity*, *App Dev Progress Update*.
- **2026-05-23** — Reached **v0.9.14-beta**: custom app icon (glowing cyan orb with
  targeting reticle on a navy background), changelog, debug HUD, a
  `BuildMetadata` singleton as the single source of truth for version info.
- **2026-05-23** — Researched app copy-protection and Play Store monetization
  options. *App Protection and Monetization*.
- **2026-05-24 / 05-29** — Designed a companion marketing website for the app.
  *WebPage for Aircursor*, *AirCursor Website Design*.

## Philosophy
"First 100 users are more valuable than the first ₹100" — deliberately
distribution-first (website + APK downloads + community feedback + user growth)
rather than chasing monetization immediately.

## What it means to him
Built mainly for his own satisfaction and skill growth, not for social credit —
only a few friends know it exists, and most of them aren't especially interested.
See his own reflection on this in [[self]].

See also: [[project_adj_ai]], [[self]]
