# GestureBoard — Hand-Controlled Whiteboard

GestureBoard is a real-time, hand-tracking powered whiteboard that lets you **draw, pan, zoom, erase, and manipulate polygons using only gestures**.

It runs entirely in the browser using **MediaPipe Hands**, an HTML5 `<canvas>` rendering pipeline, and a structured internal architecture optimized for smooth interaction and high performance.

---

## ✨ Features

### 🎨 Polygon-Based Drawing
- Create polygons vertex-by-vertex using finger gestures
- Snap-to-close detection for clean polygon completion
- Fill + stroke rendering with dynamic color palettes
- Undo support
- Clear all with animated erase flash

### ✋ Gesture Controls

| Gesture | Action |
|----------|--------|
| ☝️ **Point** | Add polygon vertices |
| ✌️ **Peace** | Finalize polygon |
| 🖐️ **Open Hand** | Pan canvas |
| 🤌 **Pinch (Two Hands)** | Zoom in / out |
| ✊ **Fist** | Erase all |
| 🤘 **Rock-On** | Undo last |

---

## 🧠 Architecture Overview

GestureBoard is structured into modular managers to isolate responsibilities:

### `PointerSmoother`
- Adaptive velocity-based smoothing
- Resolution-independent movement normalization
- Prevents jitter while remaining responsive

### `TransformMgr`
- Handles world ↔ screen coordinate mapping
- Manages pan and zoom state
- Supports pinch scaling with center anchoring

### `ModeMachine`
- Explicit state machine
- Prevents gesture conflicts
- Valid states:
  - `passive`
  - `drawing`
  - `panning`
  - `zooming`
  - `erasing`

### `DrawingMgr`
- Polygon state management
- Offscreen rendering cache (dirty-flag optimized)
- Infinite world-aligned grid
- Batched vertex rendering (single path optimization)
- Animated erase flash
- Snap-to-close logic
- Save to PNG

### `GestureMgr`
- MediaPipe integration
- Handedness-aware thumb detection
- Peace vs Point disambiguation via finger spread
- Hysteresis-based gesture confirmation
- Watchdog tracking loss recovery

---

## ⚙️ Performance Optimizations

- Offscreen canvas for finalized polygons
- Dirty-flag redraw system
- Batched arc rendering for vertex points
- Line width clamping at extreme zoom
- Velocity-normalized smoothing
- Infinite grid aligned to world transform
- Gesture hysteresis (no flicker mode switching)
- Tracking watchdog for reliability

---

## 🖥 UI Components

- Fullscreen drawing canvas
- Mini live camera preview with overlay
- Real-time HUD:
  - Current gesture
  - Polygon count
  - Zoom level
  - FPS
  - Hand count
  - Confidence
- Animated gesture flash overlay
- Mode badge indicator
- Bottom floating toolbar

---
