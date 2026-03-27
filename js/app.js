/**
 * app.js — App: main orchestrator.
 *
 * Wires together DrawingMgr, GestureMgr, HudMgr and ModeMachine.
 * Runs the rAF animation loop and translates confirmed gestures into
 * drawing/pan/zoom/undo/erase actions.
 *
 * Also exposes a small public API used by toolbar buttons in index.html:
 *   App.eraseAll()
 *   App.undo()
 *   App.resetView()
 *   App.save()
 *
 * Depends on (loaded before this file):
 *   config.js, palette.js, smoother.js, transform.js,
 *   mode-machine.js, drawing.js, gesture.js, hud.js
 */
'use strict';

const App = (() => {

  // ─── Module instances ────────────────────────────────────
  const drawing = new DrawingMgr(document.getElementById('mainCanvas'));
  const hud     = new HudMgr();
  const mode    = new ModeMachine();
  const collab  = new CollabMgr();

  // ─── Runtime state ───────────────────────────────────────
  let lastHandData = { hands: [], count: 0, confidence: 0 };
  let cursorSS     = null;   // screen-space cursor position (or null)
  let pinchActive  = false;
  let panActive    = false;
  let smartShapesEnabled = false;
  let architectModeEnabled = false;
  let applyingRemoteState = false;

  // Per-gesture one-shot debounce flags (prevent repeated triggers
  // while a confirmed gesture is held).
  let lastConfirmedErase = false;
  let lastConfirmedRock  = false;

  // FPS counter
  let fps = 0, fpsFrames = 0, fpsLast = performance.now();

  // Seed the canvas with sample shapes on first load
  drawing.seedDemoPolygons();
  drawing.setSmartShapesEnabled(false);
  drawing.setArchitectModeEnabled(false);

  // ══════════════════════════════════════════════
  //  ANIMATION LOOP
  // ══════════════════════════════════════════════

  function loop(ts) {
    // FPS calculation (sampled every 500 ms)
    fpsFrames++;
    const elapsed = ts - fpsLast;
    if (elapsed >= 500) {
      fps       = Math.round(fpsFrames / elapsed * 1000);
      fpsFrames = 0;
      fpsLast   = ts;
    }

    processGestures(lastHandData);

    // Pass hold progress from the primary hand to the cursor arc renderer
    const holdProgress = lastHandData.hands[0]?.holdProgress ?? 0;
    drawing.render(cursorSS, mode.is('drawing'), holdProgress);

    hud.update({
      mode:       mode.label,
      gesture:    _gestureLabel(),
      polyCount:  drawing.polygons.length,
      zoom:       drawing.transform.scale,
      fps,
      hands:      lastHandData.count,
      confidence: lastHandData.confidence || 0,
    });

    requestAnimationFrame(loop);
  }

  /** Build a human-readable gesture label for the HUD stats card. */
  function _gestureLabel() {
    const { hands } = lastHandData;
    if (!hands.length) return '—';
    return hands.map(h => h.gesture.toUpperCase()).join(' + ');
  }

  // ══════════════════════════════════════════════
  //  GESTURE → ACTION PROCESSOR
  // ══════════════════════════════════════════════

  /**
   * Translate the latest hand data into drawing/view actions.
   * Called once per rAF frame, before rendering.
   * @param {{ hands: Object[], count: number }} param0
   */
  function processGestures({ hands, count }) {
    const tr = drawing.transform;
    cursorSS = count > 0 ? { ...hands[0].smoothed } : null;

    // ── Two-hand operations ──────────────────────────────
    if (count === 2) {
      const g0 = hands[0].gesture;
      const g1 = hands[1].gesture;

      const canPinch = g => g === 'pinch' || g === 'open';
      const isOpen   = g => g === 'open';

      // Pinch-zoom: either hand in pinch or open
      if (canPinch(g0) && canPinch(g1)) {
        const p1 = hands[0].smoothed;
        const p2 = hands[1].smoothed;
        if (!pinchActive) { tr.startPinch(p1, p2); pinchActive = true; }
        else tr.updatePinch(p1, p2);

        mode.to('zooming');
        drawing.cancelDraft();
        panActive = false;
        hud.flashGesture('⊕ ZOOM');
        return;
      } else {
        if (pinchActive) { tr.endPinch(); pinchActive = false; }
      }

      // Two-hand pan: both hands open
      if (isOpen(g0) && isOpen(g1)) {
        const cx = (hands[0].smoothed.x + hands[1].smoothed.x) / 2;
        const cy = (hands[0].smoothed.y + hands[1].smoothed.y) / 2;
        if (!panActive) { tr.startPan(cx, cy); panActive = true; }
        else tr.updatePan(cx, cy);

        mode.to('panning');
        drawing.cancelDraft();
        return;
      } else {
        if (panActive) { tr.endPan(); panActive = false; }
      }

    } else {
      // Clean up two-hand gestures if we dropped below 2 hands
      if (pinchActive) { tr.endPinch(); pinchActive = false; }
      // Don't reset panActive here — single-hand open-grab may continue panning
    }

    // ── No hands detected ───────────────────────────────
    if (count === 0) {
      if (mode.is('drawing')) drawing.finalizeDraft({ source: 'auto', confidence: lastHandData.confidence || 0 });
      mode.to('passive');
      lastConfirmedErase = false;
      lastConfirmedRock  = false;
      return;
    }

    // ── Single-hand operations ───────────────────────────
    const h  = hands[0];
    const g  = h.gesture;    // raw (immediate) gesture
    const gc = h.confirmed;  // hysteresis-debounced gesture
    const sp = h.smoothed;   // smoothed screen-space position

    // ERASE — fist (confirmed, one-shot)
    if (gc === 'fist') {
      if (!lastConfirmedErase) {
        lastConfirmedErase = true;
        drawing.eraseAll();
        drawing.flashErase();
        mode.to('erasing');
        hud.flashGesture('✊ ERASE');
      }
      return;
    } else {
      lastConfirmedErase = false;
    }

    // UNDO — rock-on (confirmed, one-shot)
    if (gc === 'rockon') {
      if (!lastConfirmedRock) {
        lastConfirmedRock = true;
        drawing.undo();
        mode.to('passive');
        hud.flashGesture('🤘 UNDO');
      }
      return;
    } else {
      lastConfirmedRock = false;
    }

    // FINALIZE — peace sign
    if (g === 'peace') {
      const conf = lastHandData.confidence || 0;
      const canUseSmartShape = smartShapesEnabled && conf >= Config.SHAPE_CONFIDENCE_MIN;
      const minFinalizePts = canUseSmartShape ? 2 : 3;
      if (mode.is('drawing') && drawing.draft.length >= minFinalizePts) {
        drawing.finalizeDraft({ source: 'peace', confidence: lastHandData.confidence || 0 });
        hud.flashGesture('✌️ DONE');
      }
      mode.to('passive');
      return;
    }

    // DRAW — pointing finger
    // Enter drawing with the confirmed gesture to reduce accidental starts,
    // then keep drawing while either raw or confirmed stays on point.
    const drawActive = mode.is('drawing')
      ? (g === 'point' || gc === 'point')
      : (gc === 'point');
    if (drawActive) {
      const w = tr.toWorld(sp.x, sp.y);
      drawing.addDraftPt(w.x, w.y);
      mode.to('drawing');
      return;
    }

    // GRAB / PAN — open hand
    // Use the wrist landmark as the anchor point: it's the most stable
    // part of the hand and doesn't jump around like fingertips do.
    if (g === 'open') {
      if (mode.is('drawing')) {
        drawing.finalizeDraft({ source: 'auto', confidence: lastHandData.confidence || 0 });
        hud.flashGesture('🖐️ SAVED');
      }
      const wx = h.wrist.x;
      const wy = h.wrist.y;
      if (!panActive) {
        tr.startPan(wx, wy);
        panActive = true;
        hud.flashGesture('🖐️ GRAB');
      } else {
        tr.updatePan(wx, wy);
      }
      mode.to('panning');
      return;
    }

    // Gesture left 'open' — release the pan anchor
    if (panActive) { tr.endPan(); panActive = false; }

    // Unknown / transitional gesture — finalize any open draft and go passive
    if (mode.is('drawing')) {
      drawing.finalizeDraft({ source: 'auto', confidence: lastHandData.confidence || 0 });
      hud.flashGesture('✅ SAVED');
    }
    mode.to('passive');
  }

  // ══════════════════════════════════════════════
  //  STARTUP
  // ══════════════════════════════════════════════

  async function start() {
    const fill = document.getElementById('ldFill');
    const msg  = document.getElementById('ldMsg');

    const onProgress = (text, pct) => {
      fill.style.width = pct + '%';
      msg.textContent  = text;
    };

    onProgress('Loading gesture model…', 10);

    const gestureMgr = new GestureMgr(
      document.getElementById('webcam'),
      document.getElementById('camCanvas'),
      data => { lastHandData = data; }
    );

    try {
      await gestureMgr.init(onProgress);
      hud.setStatus('TRACKING ACTIVE', true);

      drawing.onStateChange(state => {
        if (applyingRemoteState) return;
        collab.publishState(state);
      });

      collab.onState = state => {
        applyingRemoteState = true;
        drawing.importState(state);
        smartShapesEnabled = drawing.smartShapesEnabled;
        architectModeEnabled = drawing.architectModeEnabled;
        syncToolbarState();
        applyingRemoteState = false;
      };

      collab.onStatus = ({ connected, message }) => {
        hud.setStatus(message, connected);
      };

      collab.connect();

    } catch (err) {
      console.error(err);
      hud.setStatus('CAMERA ERROR', false);
      msg.textContent = '⚠ ' + err.message;
      return;
    }

    // Fade out loading screen
    const ld = document.getElementById('loading');
    ld.style.transition = 'opacity 0.65s ease';
    ld.style.opacity    = '0';
    setTimeout(() => { ld.style.display = 'none'; }, 750);

    requestAnimationFrame(loop);
  }


  function syncToolbarState() {
    const shapeBtn = document.getElementById('shapeBtn');
    if (shapeBtn) {
      shapeBtn.classList.toggle('active', smartShapesEnabled);
      shapeBtn.textContent = smartShapesEnabled ? '🧠 SHAPES ON' : '🧠 SHAPES OFF';
    }

    const archBtn = document.getElementById('archBtn');
    if (archBtn) {
      archBtn.disabled = !smartShapesEnabled;
      archBtn.classList.toggle('active', smartShapesEnabled && architectModeEnabled);
      archBtn.textContent = architectModeEnabled ? '📐 ARCH 15° ON' : '📐 ARCH 15° OFF';
    }
  }

  // ══════════════════════════════════════════════
  //  PUBLIC API (used by toolbar buttons)
  // ══════════════════════════════════════════════

  return {
    start,

    eraseAll() {
      drawing.eraseAll();
      drawing.flashErase();
      hud.flashGesture('✊ ERASE');
    },

    undo() {
      drawing.undo();
      hud.flashGesture('🤘 UNDO');
    },

    resetView() {
      drawing.transform.reset();
    },

    toggleShapeIntelligence() {
      smartShapesEnabled = !smartShapesEnabled;
      drawing.setSmartShapesEnabled(smartShapesEnabled);
      if (!smartShapesEnabled && architectModeEnabled) {
        architectModeEnabled = false;
        drawing.setArchitectModeEnabled(false);
      }
      syncToolbarState();
      collab.publishState(drawing.exportState());
      hud.flashGesture(smartShapesEnabled ? '🧠 SMART SHAPES' : '🧠 RAW SHAPES');
    },

    toggleArchitectMode() {
      if (!smartShapesEnabled) return;
      architectModeEnabled = !architectModeEnabled;
      drawing.setArchitectModeEnabled(architectModeEnabled);
      syncToolbarState();
      collab.publishState(drawing.exportState());
      hud.flashGesture(architectModeEnabled ? '📐 ARCH MODE' : '📐 FREE ANGLES');
    },

    /**
     * Export the current canvas state as a PNG download.
     * Composites the rendered main canvas onto a clean export canvas.
     */
    save() {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width  = drawing.canvas.width;
      exportCanvas.height = drawing.canvas.height;

      const ectx = exportCanvas.getContext('2d');
      ectx.fillStyle = '#05050a';
      ectx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      ectx.drawImage(drawing.canvas, 0, 0);

      const link      = document.createElement('a');
      link.download   = `gestureboard-${Date.now()}.png`;
      link.href       = exportCanvas.toDataURL('image/png');
      link.click();
    },
  };

})();

// Kick everything off
App.start().catch(console.error);
