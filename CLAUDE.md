# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm install       # Install dependencies
zeus dev          # Build and run on connected device / simulator
```

No lint or test infrastructure exists — `npm test` exits with error.

## Project Overview

**Ace Badminton** is a Zepp OS DataWidget (smartwatch app) for Amazfit devices that uses the IMU (accelerometer + gyroscope) to detect and analyze badminton swings in real-time.

- **Platform:** Zepp OS API Level 4.2, subType 92 (badminton)
- **Target devices:** Amazfit Active 2 NFC (round 466×466px) and Active 2 Square (390×450px)
- **Language:** Vanilla JavaScript (CommonJS modules, ES6)
- **App ID:** 1112850

## Architecture

### Entry Points

| File | Role |
|------|------|
| `app.js` | App lifecycle only (onCreate / onDestroy) |
| `page/widget/index.js` | DataWidget — sensors, UI, persistence |
| `utils/badminton-engine.js` | Core swing recognition engine |

### Data Flow

```
Accelerometer + Gyroscope (50Hz, FREQ_MODE_HIGH)
  → ingestMotion() in engine
  → feature extraction over 1400ms sliding buffer
  → swing classification (hand, stroke type, speed, confidence)
  → session metrics aggregation
  → localStorage serialization (key: ace_badminton_session)
  → UI widget update
```

### Screen Variants

Assets and layouts are split by suffix:
- `default.r/` and `index.r.layout.js` — round screen (466×466)
- `default.s/` and `index.s.layout.js` — square screen (390×450)
- `default.b/` — bundle variant

### Engine (`utils/badminton-engine.js`)

The engine is calibrated against the OSF badminton dataset (100 participants, 30 swings each). Key design decisions:

**Swing detection thresholds (accel ± gyro):**
- Normal: ≥3g AND ≥80°/s
- High speed: ≥6g AND ≥150°/s
- Extreme: ≥10g AND ≥150°/s
- Cooldown: 600ms between detections

**Classification uses dual-axis time-series analysis:**
- Hand (forehand/backhand): X-axis positive (external) vs negative (internal) rotation ratio + Y-axis wrist lift timing
- Stroke type (overhead/underhand/drive): Z-axis peak accel + Y-axis rotation
- Speed: IMU peaks converted to km/h (relative comparison, not absolute)
- Confidence: 0–100 score gating each classification output

### Persistence

Session state is JSON-serialized to `localStorage` under key `ace_badminton_session`. Stores: total swings, max speed, rally info, stroke distribution, and the last 10 detected actions.

### UI Metrics and Colors

Eight real-time metrics rendered as a 3×2 grid plus a 5-dimension radar chart (Burst, Offense, Rally, Endurance, Activity).

Color palette: background `#0d0d1a`, duration `#facc15`, speed `#f87171`, frequency `#60a5fa`, swings `#4ade80`, rally `#fb923c`, labels `#999999`.

## Zepp OS Constraints

- No DOM, no browser APIs — use Zepp OS native widget APIs (`hmUI`, `hmSensor`, `hmStorage`, etc.)
- Modules use CommonJS `require()`; no dynamic imports
- All file paths in `app.json` must be explicit; the bundler does not do tree-shaking
- Permissions declared in `app.json` under `permissions`: accelerometer, gyroscope, local storage, heart rate HD, workout data
