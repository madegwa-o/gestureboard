/**
 * mode-machine.js — Simple finite-state machine for the app's interaction mode.
 *
 * Valid states:
 *   passive | drawing | panning | zooming | erasing
 *
 * Replaces scattered string comparisons with explicit, readable transitions
 * that make it easy to extend or debug mode changes.
 */
'use strict';

class ModeMachine {
  constructor() {
    this._state = 'passive';
    this._prev  = 'passive';
  }

  // ─── Accessors ────────────────────────────────────────────

  /** Current state string. */
  get state() { return this._state; }

  /** Previous state string. */
  get prev()  { return this._prev; }

  /** Human-readable label used by the HUD badge. */
  get label() {
    return {
      passive:  'PASSIVE',
      drawing:  'DRAWING',
      panning:  'PAN',
      zooming:  'ZOOM',
      erasing:  'ERASING',
    }[this._state] || 'PASSIVE';
  }

  // ─── Transitions ─────────────────────────────────────────

  /**
   * Transition to a new state (no-op if already in that state).
   * @param {string} next  Target state name
   */
  to(next) {
    if (this._state !== next) {
      this._prev  = this._state;
      this._state = next;
    }
  }

  /**
   * Returns true if the current state matches any of the provided names.
   * Useful for guard conditions: `mode.is('drawing', 'panning')`.
   * @param {...string} states
   */
  is(...states) {
    return states.includes(this._state);
  }
}
