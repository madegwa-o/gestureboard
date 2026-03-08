/**
 * transform.js — Canvas pan & zoom state manager.
 *
 * Maintains a 2-D affine transform (uniform scale + translation).
 * Provides helpers for:
 *   - applying the transform to a CanvasRenderingContext2D
 *   - converting between screen-space and world-space coordinates
 *   - gesture-driven two-finger pinch-zoom
 *   - single-finger / two-finger pan
 */
'use strict';

class TransformMgr {
  constructor() {
    this.scale = 1;
    this.tx    = 0;
    this.ty    = 0;

    this._pinch0 = null;  // pinch gesture start snapshot
    this._pan0   = null;  // pan gesture start snapshot
  }

  // ─── Context helpers ───────────────────────────────────────

  /** Apply transform to a 2-D canvas context. */
  apply(ctx) {
    ctx.setTransform(this.scale, 0, 0, this.scale, this.tx, this.ty);
  }

  /** Convert screen-space → world-space. */
  toWorld(sx, sy) {
    return {
      x: (sx - this.tx) / this.scale,
      y: (sy - this.ty) / this.scale,
    };
  }

  /** Convert world-space → screen-space. */
  toScreen(wx, wy) {
    return {
      x: wx * this.scale + this.tx,
      y: wy * this.scale + this.ty,
    };
  }

  // ─── Pinch zoom ────────────────────────────────────────────

  /**
   * Call once when two fingers first come together.
   * @param {{ x, y }} p1  Screen-space position of hand 1
   * @param {{ x, y }} p2  Screen-space position of hand 2
   */
  startPinch(p1, p2) {
    this._pinch0 = {
      cx: (p1.x + p2.x) / 2,
      cy: (p1.y + p2.y) / 2,
      d:  Math.hypot(p2.x - p1.x, p2.y - p1.y),
      scale: this.scale,
      tx: this.tx,
      ty: this.ty,
    };
  }

  /**
   * Call every frame while the pinch is active.
   * Zoom is anchored to the midpoint between the two fingers.
   */
  updatePinch(p1, p2) {
    if (!this._pinch0) return;
    const s0 = this._pinch0;

    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    const d  = Math.hypot(p2.x - p1.x, p2.y - p1.y);

    const newScale = Math.max(
      Config.ZOOM_MIN,
      Math.min(Config.ZOOM_MAX, s0.scale * (d / s0.d))
    );
    const ratio = newScale / s0.scale;

    this.tx    = cx - (s0.cx - s0.tx) * ratio;
    this.ty    = cy - (s0.cy - s0.ty) * ratio;
    this.scale = newScale;
  }

  /** Call when the pinch gesture ends. */
  endPinch() {
    this._pinch0 = null;
  }

  // ─── Pan ───────────────────────────────────────────────────

  /**
   * Call once when panning begins.
   * @param {number} cx  Screen-space X of the pan anchor
   * @param {number} cy  Screen-space Y of the pan anchor
   */
  startPan(cx, cy) {
    this._pan0 = { cx, cy, tx: this.tx, ty: this.ty };
  }

  /** Call every frame while panning. */
  updatePan(cx, cy) {
    if (!this._pan0) return;
    this.tx = this._pan0.tx + (cx - this._pan0.cx);
    this.ty = this._pan0.ty + (cy - this._pan0.cy);
  }

  /** Call when the pan gesture ends. */
  endPan() {
    this._pan0 = null;
  }

  // ─── Reset ─────────────────────────────────────────────────

  /** Return to identity transform (1:1 zoom, no offset). */
  reset() {
    this.scale   = 1;
    this.tx      = 0;
    this.ty      = 0;
    this._pinch0 = null;
    this._pan0   = null;
  }
}
