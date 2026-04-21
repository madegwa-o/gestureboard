/**
 * smoother.js — Exponential moving-average cursor smoother.
 *
 * Velocity-adaptive: blends between a slow alpha (smooth) and
 * a fast alpha (responsive) based on how quickly the pointer moves,
 * normalized by screen diagonal so behaviour is resolution-independent.
 */
'use strict';

class PointerSmoother {
  /**
   * @param {number} alpha  Base smoothing factor (0 = fully lagged, 1 = raw).
   *                        Defaults to Config.SMOOTH_ALPHA.
   */
  constructor(alpha = Config.SMOOTH_ALPHA, alphaFast = Config.SMOOTH_ALPHA_FAST) {
    this._alpha = alpha;
    this._alphaFast = alphaFast;
    this._x = null;
    this._y = null;
  }

  /**
   * Feed a new raw position; returns the smoothed {x, y}.
   * @param {number} nx  Raw screen-space X
   * @param {number} ny  Raw screen-space Y
   * @returns {{ x: number, y: number }}
   */
  update(nx, ny) {
    // First call — seed the filter with the raw position.
    if (this._x === null) {
      this._x = nx;
      this._y = ny;
      return { x: nx, y: ny };
    }

    const dx  = nx - this._x;
    const dy  = ny - this._y;
    const vel = Math.hypot(dx, dy);

    // Normalise velocity to [0, 1] relative to screen diagonal.
    const screenDiag = Math.hypot(window.innerWidth, window.innerHeight);
    const t     = Math.min(1, vel / (screenDiag / Config.VEL_NORM));
    const alpha = this._alpha + t * (this._alphaFast - this._alpha);

    this._x += alpha * dx;
    this._y += alpha * dy;

    return { x: this._x, y: this._y };
  }

  /** Reset the filter (e.g. when a hand disappears). */
  reset() {
    this._x = null;
    this._y = null;
  }

  /**
   * Current smoothed position, or null if never fed.
   * @returns {{ x: number, y: number } | null}
   */
  get pos() {
    return this._x === null ? null : { x: this._x, y: this._y };
  }
}
