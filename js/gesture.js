/**
 * gesture.js — GestureMgr: wraps MediaPipe Hands and classifies gestures.
 *
 * Key behaviours:
 *   - Handedness-aware thumb classification (FIX #1)
 *   - Peace vs Point requires visible finger spread (FIX #2)
 *   - Hysteresis debounce: holdCnt decays rather than instantly resetting (FIX #3)
 *   - Rock-on checks MCP (knuckle) position, not just PIP (FIX #4)
 *   - Watchdog timer warns when MediaPipe results stop arriving (FIX #16)
 *
 * Calls onResults({ hands, count, confidence }) every frame after processing.
 */
'use strict';

class GestureMgr {
  /**
   * @param {HTMLVideoElement}   videoEl       Webcam feed element
   * @param {HTMLCanvasElement}  overlayCanvas Small canvas drawn over the camera preview
   * @param {Function}           onResults     Callback receiving processed hand data
   */
  constructor(videoEl, overlayCanvas, onResults) {
    this.videoEl   = videoEl;
    this.overlay   = overlayCanvas;
    this.octx      = overlayCanvas.getContext('2d');
    this.onResults = onResults;

    // One smoother per possible hand slot
    this._smoothers  = Array.from({ length: 2 }, () => new PointerSmoother());
    this._lastG      = ['none', 'none'];
    this._holdCnt    = [0, 0];
    this._confirmed  = ['none', 'none'];

    this.hands  = null;
    this.camera = null;

    // Watchdog state
    this._lastResultTime = null;
    this._watchdogEl     = document.getElementById('watchdogWarn');
    this._watchdogTimer  = null;
  }

  // ══════════════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════════════

  /**
   * Load MediaPipe Hands, request camera access, and start tracking.
   * @param {Function} onProgress  (message: string, pct: number) => void
   */
  async init(onProgress) {
    this.hands = new Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
    });

    this.hands.setOptions({
      maxNumHands:             2,
      modelComplexity:         1,
      minDetectionConfidence:  Config.DETECT_CONF,
      minTrackingConfidence:   Config.TRACK_CONF,
    });

    this.hands.onResults(r => this._process(r));

    onProgress('Loading hand detection model…', 25);
    await this.hands.initialize();
    onProgress('Starting webcam…', 65);

    this.camera = new Camera(this.videoEl, {
      onFrame: async () => {
        this.overlay.width  = this.videoEl.videoWidth  || 640;
        this.overlay.height = this.videoEl.videoHeight || 480;
        await this.hands.send({ image: this.videoEl });
      },
      width: 1280, height: 720,
    });

    await this.camera.start();
    onProgress('Ready!', 100);

    // Start watchdog after a successful init
    this._lastResultTime = performance.now();
    this._startWatchdog();
  }

  // ══════════════════════════════════════════════
  //  PRIVATE — WATCHDOG
  // ══════════════════════════════════════════════

  /** Poll every second; show warning if no results in WATCHDOG_MS. */
  _startWatchdog() {
    this._watchdogTimer = setInterval(() => {
      const stale = performance.now() - this._lastResultTime > Config.WATCHDOG_MS;
      this._watchdogEl.classList.toggle('visible', stale);
    }, 1000);
  }

  // ══════════════════════════════════════════════
  //  PRIVATE — GESTURE CLASSIFIER
  // ══════════════════════════════════════════════

  /**
   * Classify a single hand's landmark array into a gesture name.
   *
   * Landmark indices used:
   *   Tip IDs  : [4, 8, 12, 16, 20]  (thumb, index, middle, ring, pinky)
   *   PIP IDs  : [2, 6, 10, 14, 18]  (proximal interphalangeal joints)
   *   MCP IDs  : [1, 5,  9, 13, 17]  (metacarpophalangeal knuckles)
   *
   * @param {Object[]} lm          21-point landmark array (normalized 0–1)
   * @param {string}   handedness  'Left' | 'Right' (from MediaPipe, mirrored)
   * @returns {string} Gesture name
   */
  _classify(lm, handedness) {
    const tipIds = [4,  8, 12, 16, 20];
    const pipIds = [2,  6, 10, 14, 18];
    const mcpIds = [1,  5,  9, 13, 17];

    // Determine which fingers are "up"
    const up = tipIds.map((tip, i) => {
      if (i === 0) {
        // Thumb: compare X axis (mirrored feed means Left/Right swap)
        return handedness === 'Right'
          ? lm[tip].x < lm[pipIds[i]].x   // real-world left hand
          : lm[tip].x > lm[pipIds[i]].x;  // real-world right hand
      }
      // Other fingers: tip above (smaller Y) than PIP
      return lm[tip].y < lm[pipIds[i]].y;
    });

    const [thumb, index, middle, ring, pinky] = up;

    // ─── Simple shapes ──────────────────────────────────────
    if (!thumb && !index && !middle && !ring && !pinky) return 'fist';
    if (!thumb &&  index && !middle && !ring && !pinky) return 'point';

    // Peace: index + middle up, AND spread apart horizontally
    if (!thumb && index && middle && !ring && !pinky) {
      const spread = Math.abs(lm[8].x - lm[12].x);
      return spread > 0.04 ? 'peace' : 'point';  // tight fingers → treat as point
    }

    // Rock-on: index + pinky up; middle & ring MUST be below their MCP knuckle
    if (!thumb && index && !middle && !ring && pinky) {
      const ringBelowMCP   = lm[16].y > lm[mcpIds[3]].y;
      const middleBelowMCP = lm[12].y > lm[mcpIds[2]].y;
      return (ringBelowMCP && middleBelowMCP) ? 'rockon' : 'unknown';
    }

    // Open hand: all five fingers up
    if (thumb && index && middle && ring && pinky) return 'open';

    // Pinch: thumb tip close to index tip
    const pd = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
    if (pd < Config.PINCH_DIST) return 'pinch';

    return 'unknown';
  }

  // ══════════════════════════════════════════════
  //  PRIVATE — RESULTS PROCESSOR
  // ══════════════════════════════════════════════

  /** Called by MediaPipe on every camera frame with tracking results. */
  _process(results) {
    this._lastResultTime = performance.now(); // reset watchdog

    const ctx = this.octx;
    const W   = this.overlay.width;
    const H   = this.overlay.height;
    ctx.clearRect(0, 0, W, H);

    const landmarks    = results.multiHandLandmarks || [];
    const handednesses = results.multiHandedness    || [];
    const count        = landmarks.length;

    // Process each detected hand
    const handData = landmarks.map((lm, i) => {
      // Draw skeleton overlay on camera preview
      drawConnectors(ctx, lm, HAND_CONNECTIONS, {
        color: 'rgba(0,245,212,0.3)', lineWidth: 1.2,
      });
      drawLandmarks(ctx, lm, {
        color: 'rgba(0,245,212,0.75)', lineWidth: 1, radius: 2.5,
      });

      // Map index-finger tip to screen coordinates (flip X for mirror effect)
      const tip = lm[8];
      const raw = {
        x: (1 - tip.x) * window.innerWidth,
        y: tip.y * window.innerHeight,
      };
      const smoothed = this._smoothers[i].update(raw.x, raw.y);

      // Classify gesture with handedness awareness
      const handLabel = handednesses[i]?.label || 'Right';
      const gesture   = this._classify(lm, handLabel);

      // ─── Hysteresis debounce ──────────────────────────────
      if (gesture === this._lastG[i]) {
        // Same gesture: increment hold counter (capped at HOLD_FRAMES)
        this._holdCnt[i] = Math.min(Config.HOLD_FRAMES, this._holdCnt[i] + 1);
      } else {
        // Different gesture: decay rather than instantly reset
        this._holdCnt[i] = Math.max(0, this._holdCnt[i] - Config.HOLD_DECAY);
        // Only commit the new gesture once the count fully decays
        if (this._holdCnt[i] === 0) this._lastG[i] = gesture;
      }

      // Confirm gesture once hold threshold is reached
      if (this._holdCnt[i] >= Config.HOLD_FRAMES) {
        this._confirmed[i] = gesture;
      }

      // Wrist position (used for two-hand pan midpoint etc.)
      const wrist = {
        x: (1 - lm[0].x) * window.innerWidth,
        y: lm[0].y * window.innerHeight,
      };

      return {
        smoothed,
        raw,
        gesture,
        confirmed:    this._confirmed[i],
        lm,
        wrist,
        holdProgress: this._holdCnt[i] / Config.HOLD_FRAMES, // 0–1 for cursor arc
      };
    });

    // Reset slots for hands that disappeared this frame
    for (let i = count; i < 2; i++) {
      this._smoothers[i].reset();
      this._lastG[i]     = 'none';
      this._holdCnt[i]   = 0;
      this._confirmed[i] = 'none';
    }

    // Aggregate confidence (hold progress of active hands, normalised)
    const avgConf = count === 0
      ? 0
      : this._holdCnt.slice(0, count).reduce((a, b) => a + b, 0) / count;

    this.onResults({
      hands:      handData,
      count,
      confidence: avgConf / Config.HOLD_FRAMES,
    });
  }
}
