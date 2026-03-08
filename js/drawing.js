/**
 * drawing.js — DrawingMgr: owns all canvas rendering and polygon state.
 *
 * Responsibilities:
 *   - Manages the main drawing canvas and an offscreen polygon cache layer.
 *   - Stores finalized polygons and the current in-progress draft.
 *   - Provides an undo stack.
 *   - Renders: background grid → cached polygons → live draft → cursor.
 *   - Exposes a TransformMgr instance so the App can read/write pan & zoom.
 */
'use strict';

class DrawingMgr {
  /**
   * @param {HTMLCanvasElement} canvas  The main full-screen canvas element.
   */
  constructor(canvas) {
    this.canvas    = canvas;
    this.ctx       = canvas.getContext('2d', { alpha: false });
    this.transform = new TransformMgr();

    // ─── State ─────────────────────────────────────────────
    this.polygons  = [];   // finalized polygon list
    this.draft     = [];   // current in-progress vertex list
    this.inDraft   = false;
    this.undoStack = [];

    // ─── Visual effect state ────────────────────────────────
    this._eraseFlash = null;   // { startTime, duration }
    this._snapActive = false;  // true when cursor is near draft origin

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  // ══════════════════════════════════════════════
  //  DRAFT MANAGEMENT
  // ══════════════════════════════════════════════

  /**
   * Add a world-space point to the current draft.
   * Points closer than Config.MIN_MOVE are ignored.
   */
  addDraftPt(wx, wy) {
    if (!this.inDraft) {
      this.inDraft = true;
      this.draft   = [];
    }
    const last = this.draft[this.draft.length - 1];
    if (!last || Math.hypot(wx - last.x, wy - last.y) > Config.MIN_MOVE) {
      this.draft.push({ x: wx, y: wy });
    }
  }

  /** Close the draft into a finalized polygon (if enough vertices). */
  finalizeDraft() {
    if (this.draft.length >= Config.MIN_VERTS) {
      this._saveUndo();
      const p = currentPalette();
      this.polygons.push({
        pts:    [...this.draft],
        stroke: p.stroke,
        fill:   p.fill,
        open:   true,   // never auto-close the path
      });
    }
    this.draft       = [];
    this.inDraft     = false;
    this._snapActive = false;
  }

  /** Discard the current draft without saving. */
  cancelDraft() {
    this.draft       = [];
    this.inDraft     = false;
    this._snapActive = false;
  }

  // ══════════════════════════════════════════════
  //  UNDO / ERASE
  // ══════════════════════════════════════════════

  /** Pop the last undo snapshot. */
  undo() {
    if (this.undoStack.length) {
      this.polygons   = this.undoStack.pop();
    }
    this.cancelDraft();
  }

  /** Clear all polygons (pushes to undo stack first). */
  eraseAll() {
    this._saveUndo();
    this.polygons   = [];
    this.cancelDraft();
  }

  /** Trigger an animated red flash effect over the canvas. */
  flashErase() {
    this._eraseFlash = { startTime: performance.now(), duration: 400 };
  }

  // ══════════════════════════════════════════════
  //  RENDER — called every rAF frame
  // ══════════════════════════════════════════════

  /**
   * @param {{ x, y } | null} cursorSS  Screen-space cursor position (or null).
   * @param {boolean}         drawing   True when the mode is 'drawing'.
   * @param {number}          holdProgress  0–1; drives the hold-confirmation arc on the cursor.
   */
  render(cursorSS, drawing, holdProgress = 0) {
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    const now = performance.now();

    // 1. Background fill
    ctx.resetTransform();
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, W, H);

    // 2. World-aligned infinite grid
    this._drawWorldGrid(ctx, W, H);

    // 3. Apply world transform — everything from here is in world space
    this.transform.apply(ctx);

    // 4. Draw all finalized polygons directly under the world transform
    //    so they zoom and pan correctly with the canvas
    for (const poly of this.polygons) {
      this._renderPoly(ctx, poly.pts, poly.stroke, poly.fill, poly.open ?? false);
    }

    // 5. In-progress draft polygon + preview line
    if (this.draft.length > 0) {
      const pal = currentPalette();
      this._renderPoly(ctx, this.draft, pal.stroke, pal.fill, /* open */ true);

      // Dashed preview line: last draft vertex → cursor
      if (cursorSS) {
        const targetW = this.transform.toWorld(cursorSS.x, cursorSS.y);
        const last    = this.draft[this.draft.length - 1];
        const lw      = Math.max(0.5, Math.min(2.5, 1.5 / this.transform.scale));

        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(targetW.x, targetW.y);
        ctx.strokeStyle = pal.stroke + '55';
        ctx.lineWidth   = lw;
        ctx.setLineDash([5 / this.transform.scale, 5 / this.transform.scale]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 6. Screen-space overlays (no world transform)
    ctx.resetTransform();

    // Animated erase flash
    if (this._eraseFlash) {
      const elapsed = now - this._eraseFlash.startTime;
      const t = Math.max(0, 1 - elapsed / this._eraseFlash.duration);
      if (t > 0) {
        ctx.fillStyle = `rgba(247,37,133,${0.18 * t})`;
        ctx.fillRect(0, 0, W, H);
      } else {
        this._eraseFlash = null;
      }
    }

    // 7. Cursor
    if (cursorSS) {
      this._renderCursor(ctx, cursorSS.x, cursorSS.y, drawing, holdProgress);
    }
  }

  // ══════════════════════════════════════════════
  //  DEMO SEED
  // ══════════════════════════════════════════════

  /**
   * Draw "GESTUREBOARD" in a hand-drawn stroke style as the initial canvas art.
   *
   * Each letter is defined as one or more strokes (arrays of [x,y] in a
   * 0-6 wide x 0-8 tall grid). The helper scales them to fill the viewport
   * and pushes each stroke as an open polygon so nothing auto-closes.
   */
  seedDemoPolygons() {
    const W = window.innerWidth;
    const H = window.innerHeight;

    // Letter definitions on a 0-6 x 0-8 unit grid.
    // Each letter is an array of strokes; each stroke is [[x,y], ...].
    const GLYPHS = {
      G: [[[5,1],[3,0],[1,0],[0,2],[0,6],[1,8],[3,8],[5,8],[5,5],[3,5]]],
      E: [[[5,0],[0,0],[0,8],[5,8]], [[0,4],[4,4]]],
      S: [[[5,0],[1,0],[0,1],[0,3],[1,4],[4,4],[5,5],[5,7],[4,8],[0,8]]],
      T: [[[0,0],[6,0]], [[3,0],[3,8]]],
      U: [[[0,0],[0,7],[1,8],[4,8],[5,7],[5,0]]],
      R: [[[0,0],[0,8]], [[0,0],[4,0],[5,1],[5,3],[4,4],[0,4]], [[3,4],[5,8]]],
      B: [[[0,0],[0,8],[4,8],[5,7],[5,5],[4,4],[0,4]], [[0,0],[4,0],[5,1],[5,3],[4,4]]],
      O: [[[1,0],[0,1],[0,7],[1,8],[4,8],[5,7],[5,1],[4,0],[1,0]]],
      A: [[[0,8],[2,0],[4,0],[6,8]], [[1,5],[5,5]]],
      D: [[[0,0],[0,8],[3,8],[5,6],[5,2],[3,0],[0,0]]],
    };

    const word1 = ['G','E','S','T','U','R','E'];
    const word2 = ['B','O','A','R','D'];

    const GLYPH_W  = 7;   // units per character (6 wide + 1 gap)
    const TOTAL_W1 = word1.length * GLYPH_W;
    const TOTAL_W2 = word2.length * GLYPH_W;
    const TOTAL_W  = Math.max(TOTAL_W1, TOTAL_W2);

    // Scale so the longer word fills ~82% of viewport width
    const scale  = (W * 0.82) / TOTAL_W;
    const lineH  = 8 * scale;
    const gap    = lineH * 0.55;
    const totalH = lineH * 2 + gap;
    const startY = (H - totalH) / 2;

    const palettes = [
      { stroke: '#00f5d4', fill: 'rgba(0,245,212,0.04)'   },
      { stroke: '#7b2fff', fill: 'rgba(123,47,255,0.04)'  },
      { stroke: '#ffd60a', fill: 'rgba(255,214,10,0.04)'  },
      { stroke: '#f72585', fill: 'rgba(247,37,133,0.04)'  },
      { stroke: '#00f5d4', fill: 'rgba(0,245,212,0.04)'   },
      { stroke: '#7b2fff', fill: 'rgba(123,47,255,0.04)'  },
      { stroke: '#ffd60a', fill: 'rgba(255,214,10,0.04)'  },
    ];

    const pushWord = (letters, rowY, offsetX) => {
      letters.forEach((ch, ci) => {
        const strokes = GLYPHS[ch] || [];
        const pal     = palettes[ci % palettes.length];
        const ox      = offsetX + ci * GLYPH_W * scale;
        strokes.forEach(stroke => {
          const pts = stroke.map(([gx, gy]) => ({
            x: ox + gx * scale,
            y: rowY + gy * scale,
          }));
          this.polygons.push({ pts, stroke: pal.stroke, fill: pal.fill, open: true });
        });
      });
    };

    const x1 = (W - TOTAL_W1 * scale) / 2;
    const x2 = (W - TOTAL_W2 * scale) / 2;

    pushWord(word1, startY,               x1);
    pushWord(word2, startY + lineH + gap, x2);
  }

  // ══════════════════════════════════════════════
  //  PRIVATE HELPERS
  // ══════════════════════════════════════════════

  /** Sync canvas size on window resize. */
  _resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /** Push a deep-copy snapshot onto the undo stack. */
  _saveUndo() {
    this.undoStack.push(
      this.polygons.map(p => ({ ...p, pts: [...p.pts] }))
    );
  }

  /**
   * Check whether the cursor is within snap radius of the draft's first vertex.
   * Sets this._snapActive and returns a boolean.
   * @param {{ x, y } | null} cursorSS
   */
  _checkSnap(cursorSS) {
    if (!cursorSS || this.draft.length < 3) {
      this._snapActive = false;
      return false;
    }
    const originSS = this.transform.toScreen(this.draft[0].x, this.draft[0].y);
    const dist     = Math.hypot(cursorSS.x - originSS.x, cursorSS.y - originSS.y);
    this._snapActive = dist < Config.SNAP_RADIUS;
    return this._snapActive;
  }

  // ─── World-aligned grid ──────────────────────────────────

  /** Draw an infinite grid that moves and scales with the world transform. */
  _drawWorldGrid(ctx, W, H) {
    const s    = this.transform.scale;
    const tx   = this.transform.tx;
    const ty   = this.transform.ty;
    const base = 52;       // world-space grid cell size in px
    const step = base * s; // screen-space cell size

    // Skip grid at extreme zoom levels to avoid thousands of lines
    if (step < 6 || step > 800) return;

    const offX = ((tx % step) + step) % step;
    const offY = ((ty % step) + step) % step;

    ctx.resetTransform();
    ctx.strokeStyle = 'rgba(25,25,50,0.7)';
    ctx.lineWidth   = 0.5;

    ctx.beginPath();
    for (let x = offX - step; x < W + step; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, H);
    }
    for (let y = offY - step; y < H + step; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(W, Math.round(y) + 0.5);
    }
    ctx.stroke();

    // Intersection dots — batched into a single path for performance
    ctx.fillStyle = 'rgba(40,40,80,0.6)';
    ctx.beginPath();
    for (let x = offX - step; x < W + step; x += step) {
      for (let y = offY - step; y < H + step; y += step) {
        ctx.moveTo(x + 0.8, y);
        ctx.arc(x, y, 0.8, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  // ─── Polygon renderer ────────────────────────────────────

  /**
   * Draw a polygon (filled + stroked) with vertex dots.
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ x, y }[]}              pts     Vertex array
   * @param {string}                  stroke  CSS color for stroke/dots
   * @param {string}                  fill    CSS color for fill
   * @param {boolean}                 open    If true, don't close the path
   */
  _renderPoly(ctx, pts, stroke, fill, open) {
    if (pts.length < 2) return;

    const s  = this.transform.scale;
    // Clamp line width: always visible regardless of zoom level
    const lw = Math.max(0.5, Math.min(2.5, 1.5 / s));

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (!open) ctx.closePath();

    ctx.fillStyle = fill;
    ctx.fill();

    ctx.strokeStyle = stroke;
    ctx.lineWidth   = lw;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.stroke();

    // Vertex dots — single batched path
    const r = Math.max(1, 2.8 / s);
    ctx.fillStyle = stroke;
    ctx.beginPath();
    for (const p of pts) {
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
    ctx.fill();

    // Dashed closing-indicator ring around the first vertex (draft only)
    if (open && pts.length >= Config.MIN_VERTS) {
      const r2 = 6 / s;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, r2, 0, Math.PI * 2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth   = 1 / s;
      ctx.setLineDash([3 / s, 3 / s]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ─── Cursor renderer ─────────────────────────────────────

  /**
   * Draw the custom cursor with a hold-confirmation progress arc.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number}  sx            Screen X
   * @param {number}  sy            Screen Y
   * @param {boolean} drawing       Colours the cursor yellow when drawing
   * @param {number}  holdProgress  0–1; fills the arc as gesture is confirmed
   */
  _renderCursor(ctx, sx, sy, drawing, holdProgress) {
    const color = drawing ? '#ffd60a' : '#00f5d4';
    const glow  = drawing ? 'rgba(255,214,10,0.3)' : 'rgba(0,245,212,0.3)';
    const R = 11;

    ctx.save();
    ctx.translate(sx, sy);

    // Radial glow ring
    const grad = ctx.createRadialGradient(0, 0, R - 1, 0, 0, R + 8);
    grad.addColorStop(0, glow);
    grad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(0, 0, R + 8, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Hold-progress arc (drawn beneath the main ring)
    if (holdProgress > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, R + 4, -Math.PI / 2, -Math.PI / 2 + holdProgress * Math.PI * 2);
      ctx.strokeStyle  = color;
      ctx.lineWidth    = 2.5;
      ctx.globalAlpha  = 0.7;
      ctx.stroke();
      ctx.globalAlpha  = 1;
    }

    // Main ring
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.9;
    ctx.stroke();

    // Cross-hair lines
    ctx.lineWidth   = 1;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(-R * 1.8, 0); ctx.lineTo(-R * 0.45, 0);
    ctx.moveTo(R * 0.45,  0); ctx.lineTo(R * 1.8,  0);
    ctx.moveTo(0, -R * 1.8); ctx.lineTo(0, -R * 0.45);
    ctx.moveTo(0,  R * 0.45); ctx.lineTo(0,  R * 1.8);
    ctx.stroke();

    // Centre dot
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.restore();
  }
}
