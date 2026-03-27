/**
 * hud.js — HudMgr: updates all on-screen UI elements.
 *
 * Manages:
 *   - Mode badge (top-left)
 *   - Stats card (gesture, polygon count, zoom, fps, hands, confidence)
 *   - Gesture flash overlay (centre screen)
 *   - Status bar dot + text (bottom-left)
 */
'use strict';

class HudMgr {
  constructor() {
    // DOM references (grabbed once for performance)
    this._badge  = document.getElementById('modeBadge');
    this._gest   = document.getElementById('hGest');
    this._poly   = document.getElementById('hPoly');
    this._zoom   = document.getElementById('hZoom');
    this._fps    = document.getElementById('hFps');
    this._hands  = document.getElementById('hHands');
    this._conf   = document.getElementById('hConf');
    this._users  = document.getElementById('hUsers');
    this._flash  = document.getElementById('gFlash');
    this._sdot   = document.getElementById('sDot');
    this._stext  = document.getElementById('sText');

    this._flashTimer = null;
    this._lastFlash  = '';
  }

  // ══════════════════════════════════════════════
  //  FRAME UPDATE
  // ══════════════════════════════════════════════

  /**
   * Refresh all HUD values. Called every rAF frame.
   *
   * @param {Object} params
   * @param {string} params.mode        Current mode label (e.g. 'DRAWING')
   * @param {string} params.gesture     Gesture label for display
   * @param {number} params.polyCount   Number of finalized polygons
   * @param {number} params.zoom        Current transform scale (1 = 100%)
   * @param {number} params.fps         Frames per second
   * @param {number} params.hands       Number of hands detected
   * @param {number} params.confidence  Tracking confidence 0–1
   */
  update({ mode, gesture, polyCount, zoom, fps, hands, confidence, users }) {
    // Mode badge — also switches CSS class for colour theming
    this._badge.textContent = mode;
    this._badge.className   = '';
    if      (mode === 'DRAWING') this._badge.className = 'mode-draw';
    else if (mode === 'ERASING') this._badge.className = 'mode-erase';
    else if (mode === 'PAN' || mode === 'ZOOM') this._badge.className = 'mode-pan';

    this._gest.textContent  = gesture;
    this._poly.textContent  = polyCount;
    this._zoom.textContent  = Math.round(zoom * 100) + '%';
    this._fps.textContent   = fps;
    this._hands.textContent = hands;
    this._conf.textContent  = Math.round(confidence * 100) + '%';
    this._users.textContent = users;
  }

  // ══════════════════════════════════════════════
  //  GESTURE FLASH
  // ══════════════════════════════════════════════

  /**
   * Show a large label in the centre of the screen for ~900ms.
   * Duplicate calls with the same label are ignored to prevent re-triggering.
   * @param {string} label  e.g. '✌️ DONE'
   */
  flashGesture(label) {
    if (this._lastFlash === label) return;
    this._lastFlash = label;
    clearTimeout(this._flashTimer);

    this._flash.textContent = label;
    this._flash.classList.add('show');

    this._flashTimer = setTimeout(() => {
      this._flash.classList.remove('show');
      this._lastFlash = '';
    }, 900);
  }

  // ══════════════════════════════════════════════
  //  STATUS BAR
  // ══════════════════════════════════════════════

  /**
   * Update the bottom-left status indicator.
   * @param {string}  text   Status message in all-caps (e.g. 'TRACKING ACTIVE')
   * @param {boolean} ready  If true, shows the live pulsing dot
   */
  setStatus(text, ready = false) {
    this._stext.textContent = text;
    this._sdot.className    = 's-dot' + (ready ? ' on' : '');
  }
}
