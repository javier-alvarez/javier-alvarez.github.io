// Illustrative figures in the work sections: a grounded chest X-ray report,
// CT contouring, a pathology attention map, an agent loop and an event
// stream. Everything is drawn here; nothing comes from patient data.
// Animations run only while a figure is on screen and the tab is visible,
// and hold a static state for visitors who prefer reduced motion.
(function () {
  'use strict';

  if (!window.SiteLib) { console.error('figures: assets/lib.js must load first'); return; }
  const { rgb, rgba, mix, seeded, cssVar, onWidthChange } = window.SiteLib;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return motion.matches; }

  // Re-run every figure's start/stop when the motion preference changes.
  const refreshers = [];
  if (motion.addEventListener) {
    motion.addEventListener('change', function () { refreshers.forEach(function (fn) { fn(); }); });
  }

  // Run `start` while `el` is on screen and the tab is visible, `stop`
  // otherwise. Returns a function that says whether it is on screen now.
  function track(el, start, stop) {
    let visible = false;
    function update() {
      if (visible && !document.hidden) start(); else stop();
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[entries.length - 1].isIntersecting;  // the latest entry is the current state
        update();
      }, { threshold: 0.15 }).observe(el);
    } else {
      visible = true;
      setTimeout(update, 0);
    }
    document.addEventListener('visibilitychange', update);
    refreshers.push(function () { stop(); update(); });
    return function () { return visible && !document.hidden; };
  }

  function sizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h, dpr: dpr };
  }

  function offscreen(view) {
    const layer = document.createElement('canvas');
    layer.width = Math.round(view.w * view.dpr);
    layer.height = Math.round(view.h * view.dpr);
    const ctx = layer.getContext('2d');
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    return { canvas: layer, ctx: ctx };
  }

  // ---------- 1. Grounded chest X-ray report ----------
  (function report() {
    const fig = document.getElementById('fig-report');
    if (!fig) return;
    const items = fig.querySelectorAll('.fig__item[data-finding]');
    const boxes = fig.querySelectorAll('.xr-box');
    let current = 0;
    let timer = 0;
    // Clicking a sentence pins it; hovering or focusing one previews it.
    let pinned = null;
    let hovered = null;
    let focused = null;

    function held() {
      if (hovered !== null) return hovered;
      if (focused !== null) return focused;
      return pinned;
    }
    function show(n) {
      current = n;
      items.forEach(function (el) {
        el.classList.toggle('is-active', el.dataset.finding === String(n));
        el.setAttribute('aria-pressed', String(el.dataset.finding === String(pinned)));
      });
      boxes.forEach(function (el) { el.classList.toggle('is-active', el.dataset.finding === String(n)); });
    }
    function next() { show((current % 3) + 1); }
    function start() {
      if (held() !== null) { show(held()); return; }
      if (reduced()) { show(current || 1); return; }
      if (!timer) { next(); timer = setInterval(next, 2400); }
    }
    function stop() { clearInterval(timer); timer = 0; }
    function refresh() {
      if (held() !== null) { stop(); show(held()); }
      else if (visible()) start();
      else show(current);
    }

    items.forEach(function (el) {
      const n = Number(el.dataset.finding);
      el.addEventListener('mouseenter', function () { hovered = n; refresh(); });
      el.addEventListener('mouseleave', function () { hovered = null; refresh(); });
      el.addEventListener('focus', function () { focused = n; refresh(); });
      el.addEventListener('blur', function () { focused = null; refresh(); });
      el.addEventListener('click', function () { pinned = pinned === n ? null : n; refresh(); });
    });

    const visible = track(fig, start, stop);
  })();

  // ---------- 2. CT organ contouring ----------
  (function contours() {
    const fig = document.getElementById('fig-contours');
    if (!fig) return;
    const organs = ['bladder', 'prostate', 'rectum', 'femur'];
    const shapes = fig.querySelectorAll('.ct-contour');
    const items = fig.querySelectorAll('.fig__item[data-organ]');
    let step = 0;
    let timer = 0;

    function render() {
      const drawn = organs.slice(0, step);
      shapes.forEach(function (el) { el.classList.toggle('is-drawn', drawn.indexOf(el.dataset.organ) !== -1); });
      items.forEach(function (el) { el.classList.toggle('is-active', el.dataset.organ === organs[step - 1]); });
    }
    // Draw the four structures one by one, hold, then clear and repeat.
    function tick() {
      step = step >= organs.length + 2 ? 0 : step + 1;
      render();
    }
    function start() {
      if (reduced()) { step = organs.length; render(); return; }
      if (!timer) { tick(); timer = setInterval(tick, 1300); }
    }
    function stop() { clearInterval(timer); timer = 0; }

    track(fig, start, stop);
  })();

  // ---------- 3. Pathology attention map ----------
  (function attention() {
    const fig = document.getElementById('fig-attention');
    if (!fig) return;
    const canvas = fig.querySelector('canvas');
    const toggle = fig.querySelector('.fig__toggle');
    let view = null;
    let tissue = null;
    let heat = null;
    let dirty = true;
    let raf = 0;
    let t0 = 0;
    let held = null;  // null until the visitor uses the toggle

    // With reduced motion the map is shown by default, as a still.
    function holding() { return held === null ? reduced() : held; }

    function build() {
      view = sizeCanvas(canvas);
      const w = view.w;
      const h = view.h;
      const dark = document.documentElement.dataset.theme === 'dark';
      const rand = seeded(1840);
      const colours = dark
        ? { stroma: '#05070a', fibre: 'rgba(77,141,255,0.07)', cyto: 'rgba(255,95,166,0.22)', lumen: '#020304', nucleus: '#4d8dff' }
        : { stroma: '#f4d6e1', fibre: 'rgba(196,110,150,0.22)', cyto: 'rgba(214,120,165,0.55)', lumen: '#fdf6f8', nucleus: 'rgba(75,44,122,0.85)' };

      tissue = offscreen(view);
      const t = tissue.ctx;
      t.fillStyle = colours.stroma;
      t.fillRect(0, 0, w, h);

      t.strokeStyle = colours.fibre;
      t.lineWidth = 1;
      for (let i = 0; i < 260; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const a = rand() * Math.PI;
        const l = 8 + rand() * 18;
        t.beginPath();
        t.moveTo(x, y);
        t.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 3, y + Math.sin(a) * l * 0.5 - 3, x + Math.cos(a) * l, y + Math.sin(a) * l);
        t.stroke();
      }

      // Glands: a lumen ringed by cytoplasm and a row of nuclei.
      const size = Math.min(w, h);
      const glands = [];
      for (let tries = 0; tries < 200 && glands.length < 7; tries++) {
        const r = size * (0.075 + rand() * 0.045);
        const x = r * 1.4 + rand() * (w - r * 2.8);
        const y = r * 1.4 + rand() * (h - r * 2.8);
        if (glands.every(function (g) { return Math.hypot(g.x - x, g.y - y) > (g.r + r) * 1.5; })) {
          glands.push({ x: x, y: y, r: r, squash: 0.7 + rand() * 0.3, angle: rand() * Math.PI });
        }
      }
      glands.forEach(function (g) {
        t.save();
        t.translate(g.x, g.y);
        t.rotate(g.angle);
        t.fillStyle = colours.cyto;
        t.beginPath();
        t.ellipse(0, 0, g.r * 1.25, g.r * 1.25 * g.squash, 0, 0, Math.PI * 2);
        t.fill();
        t.fillStyle = colours.lumen;
        t.beginPath();
        t.ellipse(0, 0, g.r * 0.6, g.r * 0.6 * g.squash, 0, 0, Math.PI * 2);
        t.fill();
        t.fillStyle = colours.nucleus;
        const n = Math.round((Math.PI * 2 * g.r) / 6.5);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          t.save();
          t.translate(Math.cos(a) * g.r * 1.02, Math.sin(a) * g.r * 1.02 * g.squash);
          t.rotate(a);
          t.beginPath();
          t.ellipse(0, 0, 3.4, 2.1, 0, 0, Math.PI * 2);
          t.fill();
          t.restore();
        }
        t.restore();
      });

      // Scattered stromal nuclei, outside the glands.
      t.fillStyle = colours.nucleus;
      for (let i = 0; i < 170; i++) {
        const x = rand() * w;
        const y = rand() * h;
        if (glands.some(function (g) { return Math.hypot(g.x - x, g.y - y) < g.r * 1.4; })) continue;
        t.beginPath();
        t.ellipse(x, y, 2.6, 1.4, rand() * Math.PI, 0, Math.PI * 2);
        t.fill();
      }

      // The heat layer is computed once here; frames only change its opacity.
      // The model attends to two glands strongly and one weakly. Amber to
      // orange stands out against both the pink stain and the dark field.
      const hotspots = glands.slice(0, 3).map(function (g, i) {
        return { x: g.x, y: g.y, sigma: g.r * 1.7, weight: i < 2 ? 1 : 0.55 };
      });
      const low = rgb('#ffcf4a');
      const high = rgb('#ff6a1a');
      heat = offscreen(view);
      const hc = heat.ctx;
      const tile = Math.max(14, size / 11);
      for (let y = 0; y < h; y += tile) {
        for (let x = 0; x < w; x += tile) {
          const cx = x + tile / 2;
          const cy = y + tile / 2;
          let a = 0;
          hotspots.forEach(function (s) {
            const d2 = (s.x - cx) * (s.x - cx) + (s.y - cy) * (s.y - cy);
            a = Math.max(a, s.weight * Math.exp(-d2 / (2 * s.sigma * s.sigma)));
          });
          if (a < 0.08) continue;
          hc.fillStyle = rgba(mix(low, high, a), a * 0.62);
          hc.fillRect(x, y, tile, tile);
        }
      }
      hc.strokeStyle = rgba(rgb(cssVar('--ink')), 0.12);
      hc.lineWidth = 1;
      hc.beginPath();
      for (let x = tile; x < w; x += tile) { hc.moveTo(Math.round(x) + 0.5, 0); hc.lineTo(Math.round(x) + 0.5, h); }
      for (let y = tile; y < h; y += tile) { hc.moveTo(0, Math.round(y) + 0.5); hc.lineTo(w, Math.round(y) + 0.5); }
      hc.stroke();
      dirty = false;
    }

    function draw(alpha) {
      const ctx = view.ctx;
      ctx.clearRect(0, 0, view.w, view.h);
      ctx.drawImage(tissue.canvas, 0, 0, view.w, view.h);
      if (alpha <= 0.01) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(heat.canvas, 0, 0, view.w, view.h);
      ctx.globalAlpha = 1;
    }

    // Attention fades in and out over seven seconds unless it is held on.
    function frame(now) {
      if (!t0) t0 = now;
      draw(0.5 - 0.5 * Math.cos(((now - t0) / 7000) * Math.PI * 2));
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (dirty) build();
      toggle.setAttribute('aria-pressed', String(holding()));
      if (holding() || reduced()) { draw(holding() ? 1 : 0); return; }
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }
    function restart() { stop(); if (visible()) start(); }

    toggle.setAttribute('aria-pressed', String(holding()));
    toggle.addEventListener('click', function () {
      held = !holding();
      toggle.setAttribute('aria-pressed', String(held));
      restart();
    });
    // Off screen, just mark the drawing stale; it is rebuilt when next shown.
    window.addEventListener('themechange', function () { dirty = true; restart(); });
    onWidthChange(canvas, function () { dirty = true; restart(); });
    const visible = track(fig, start, stop);
  })();

  // ---------- 4. Agent loop ----------
  (function agent() {
    const fig = document.getElementById('fig-agent');
    if (!fig) return;
    const svg = fig.querySelector('svg');
    const dot = svg.querySelector('.ag-dot');
    const nodes = Array.prototype.slice.call(svg.querySelectorAll('g[data-step] .ag-node'));
    const items = fig.querySelectorAll('.fig__item[data-step]');
    const num = function (el, name) { return Number(el.getAttribute(name)); };

    // Geometry comes from the drawing, so the two cannot drift apart.
    const ring = svg.querySelector('.ag-ring');
    const centre = { x: num(ring, 'cx'), y: num(ring, 'cy') };
    const radius = num(ring, 'r');
    const check = { x: num(nodes[2], 'cx'), y: num(nodes[2], 'cy') };
    const exits = {};
    ['answer', 'human'].forEach(function (name) {
      const rect = svg.querySelector('g[data-exit="' + name + '"] .ag-exit');
      // The dot stops on the pill's top edge, clear of its label.
      const target = { x: num(rect, 'x') + num(rect, 'width') / 2, y: num(rect, 'y') };
      svg.querySelector('.ag-path[data-exit="' + name + '"]')
        .setAttribute('d', 'M' + check.x + ' ' + check.y + ' L' + target.x + ' ' + target.y);
      exits[name] = { rect: rect, target: target };
    });

    const LAP_MS = 3200;
    const EXIT_MS = 900;
    const HOLD_MS = 1400;
    const rand = seeded(7);
    let run = null;
    let raf = 0;

    function newRun(now) {
      const laps = rand() < 0.5 ? 1 : 2;
      // From Plan (top), go round `laps` times and stop at Check (bottom).
      return { start: now, loopMs: LAP_MS * (laps + 0.5), exit: rand() < 0.3 ? 'human' : 'answer' };
    }

    function highlight(step, exit) {
      nodes.forEach(function (el, i) { el.classList.toggle('is-active', i === step); });
      Object.keys(exits).forEach(function (k) { exits[k].rect.classList.toggle('is-active', k === exit); });
      // Refine (node 3) belongs to the "check and refine" step in the list.
      const item = exit ? 'exit' : step === -1 ? null : String(step === 3 ? 2 : step);
      items.forEach(function (el) { el.classList.toggle('is-active', el.dataset.step === item); });
    }

    function place(p) { dot.setAttribute('cx', p.x.toFixed(1)); dot.setAttribute('cy', p.y.toFixed(1)); }

    function frame(now) {
      if (!run) run = newRun(now);
      const t = now - run.start;
      if (t < run.loopMs) {
        const angle = -Math.PI / 2 + (t / LAP_MS) * Math.PI * 2;
        place({ x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius });
        const quarter = ((angle + Math.PI / 2) / (Math.PI / 2)) % 4;
        const near = Math.abs(quarter - Math.round(quarter)) < 0.22 ? Math.round(quarter) % 4 : -1;
        highlight(near, null);
      } else if (t < run.loopMs + EXIT_MS) {
        const k = (t - run.loopMs) / EXIT_MS;
        const to = exits[run.exit].target;
        place({ x: check.x + (to.x - check.x) * k, y: check.y + (to.y - check.y) * k });
        highlight(-1, null);
      } else if (t < run.loopMs + EXIT_MS + HOLD_MS) {
        highlight(-1, run.exit);
      } else {
        run = newRun(now);
      }
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (reduced()) { place(exits.answer.target); highlight(-1, 'answer'); return; }
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }

    track(fig, start, stop);
  })();

  // ---------- 5. Event stream ----------
  (function stream() {
    const fig = document.getElementById('fig-stream');
    if (!fig) return;
    const canvas = fig.querySelector('canvas');
    const sources = ['Skype', 'Xbox', 'Bing', 'Office'];
    const stages = [{ x: 0.32, label: 'INGEST' }, { x: 0.57, label: 'PROCESS' }, { x: 0.8, label: 'LEARN' }];
    const BUCKET_MS = 500;
    const rand = seeded(42);
    let view = null;
    let colours = null;
    let particles = [];
    let bars = [];
    let bucket = 0;
    let bucketStart = 0;
    let last = 0;
    let spawnDebt = 0;
    let raf = 0;

    function build() {
      view = sizeCanvas(canvas);
      colours = {
        raw: rgb(cssVar('--faint')),
        parsed: rgb(cssVar('--accent')),
        learned: rgb(cssVar('--accent-2')),
        line: rgb(cssVar('--line')),
        text: rgb(cssVar('--muted')),
      };
      if (!bars.length) for (let i = 0; i < 14; i++) bars.push(0.3 + rand() * 0.4);
    }

    function laneY(i) { return view.h * (0.26 + i * 0.16); }

    function update(dt) {
      const w = view.w;
      const h = view.h;
      spawnDebt += dt * 0.075 * w;
      while (spawnDebt >= 1) {
        spawnDebt -= 1;
        const lane = Math.floor(rand() * sources.length);
        particles.push({ x: Math.max(w * 0.13, 56), y: laneY(lane) + (rand() - 0.5) * 6, lane: lane, speed: w * (0.16 + rand() * 0.1) });
      }
      const band = h * 0.55;
      particles.forEach(function (p) {
        p.x += p.speed * dt;
        if (p.x > w * stages[0].x) {
          const target = band + (p.lane - 1.5) * h * 0.035;
          p.y += (target - p.y) * Math.min(1, dt * 3);
        }
      });
      const before = particles.length;
      particles = particles.filter(function (p) { return p.x < w * stages[2].x + 4; });
      bucket += before - particles.length;
    }

    // A still frame for reduced motion: run the stream briefly, off screen.
    function warmUp() {
      particles = [];
      for (let i = 0; i < 180; i++) update(1 / 60);
    }

    function draw() {
      const ctx = view.ctx;
      const w = view.w;
      const h = view.h;
      ctx.clearRect(0, 0, w, h);
      ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = rgba(colours.text, 0.9);
      sources.forEach(function (name, i) { ctx.fillText(name, 10, laneY(i)); });

      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = rgba(colours.line, 1);
      ctx.lineWidth = 1;
      stages.forEach(function (s) {
        const x = Math.round(w * s.x) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 34);
        ctx.lineTo(x, h - 18);
        ctx.stroke();
        ctx.fillText(s.label, x - ctx.measureText(s.label).width / 2, 20);
      });
      ctx.setLineDash([]);

      particles.forEach(function (p) {
        const c = p.x < w * stages[0].x ? colours.raw : p.x < w * stages[1].x ? colours.parsed : colours.learned;
        ctx.fillStyle = rgba(c, 0.85);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
        ctx.fill();
      });

      // Live chart of events reaching the models.
      const left = w * stages[2].x + 12;
      const right = w - 12;
      const top = h * 0.3;
      const bottom = h * 0.8;
      const bw = (right - left) / bars.length;
      bars.forEach(function (v, i) {
        const bh = (bottom - top) * v;
        ctx.fillStyle = rgba(colours.learned, 0.35 + 0.5 * (i / bars.length));
        ctx.fillRect(left + i * bw + 1, bottom - bh, Math.max(1, bw - 2), bh);
      });
    }

    function step(now) {
      if (!last) { last = now; bucketStart = now; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt);
      if (now - bucketStart > BUCKET_MS) {
        const expected = 0.075 * view.w * (BUCKET_MS / 1000);
        bars.push(Math.max(0.15, Math.min(1, (bucket / expected) * (0.55 + rand() * 0.35))));
        bars.shift();
        bucket = 0;
        bucketStart = now;
      }
      draw();
      raf = requestAnimationFrame(step);
    }
    function start() {
      if (!view) build();
      if (reduced()) {
        if (!particles.length) warmUp();
        draw();
        return;
      }
      if (!raf) { last = 0; raf = requestAnimationFrame(step); }
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }

    window.addEventListener('themechange', function () { if (view) { build(); draw(); } });
    onWidthChange(canvas, function () {
      if (!view) return;
      build();
      if (reduced()) warmUp(); else particles = [];
      draw();
    });
    track(fig, start, stop);
  })();
})();
