/**
 * config.js — Global constants (single source of truth).
 * All tunable values live here; never scatter magic numbers elsewhere.
 */
'use strict';

const Config = Object.freeze({
  // ─── Pointer smoothing ───────────────────────────────────
  SMOOTH_ALPHA:      0.16,   // base lag factor (lower = smoother, higher = snappier)
  SMOOTH_ALPHA_FAST: 0.38,   // lag factor when cursor moves fast

  // ─── Gesture confirmation ────────────────────────────────
  HOLD_FRAMES:  5,   // consecutive frames needed to confirm a gesture
  HOLD_DECAY:   3,   // frames subtracted from holdCnt when gesture changes (hysteresis)

  // ─── Drawing ─────────────────────────────────────────────
  MIN_VERTS:  3,    // minimum vertices to close a polygon
  MIN_MOVE:   6,    // minimum world-space px between draft points

  // ─── Shape assist (enhanced polygon detection) ───────────
  SHAPE_CIRCLE_MIN_PTS:     12,
  SHAPE_CIRCLE_MAX_CV:      0.27, // radius std/mean threshold for circle-fit
  SHAPE_CIRCLE_CLOSE_RATIO: 0.75, // max endpoint gap ratio vs avg radius
  SHAPE_ARROW_MIN_PTS:      7,
  SHAPE_ARROW_MIN_LEN:      70,

  // ─── Viewport ────────────────────────────────────────────
  ZOOM_MIN: 0.15,
  ZOOM_MAX: 12,

  // ─── MediaPipe confidence ────────────────────────────────
  DETECT_CONF: 0.72,
  TRACK_CONF:  0.78,

  // ─── Gesture thresholds ──────────────────────────────────
  PINCH_DIST:  0.065,  // normalized distance for pinch detection
  SNAP_RADIUS: 22,     // screen-px snap-to-close radius when drawing

  // ─── Reliability ─────────────────────────────────────────
  WATCHDOG_MS: 3000,   // ms before "TRACKING LOST" warning is shown

  // ─── Velocity normalization ───────────────────────────────
  // Divides screen diagonal to get a resolution-independent velocity scale.
  VEL_NORM: 1000,
});
