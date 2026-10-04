// Illustrative figures in the work sections: a grounded chest X-ray report,
// CT contouring, a pathology attention map, an agent loop and an event
// stream. Everything is drawn here; nothing comes from patient data.
// Animations run only while a figure is on screen and stay still for
// visitors who prefer reduced motion.
(function () {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function whileVisible(el, start, stop) {
    if (!('IntersectionObserver' in window)) { start(); return; }
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) start(); else stop();
    }, { threshold: 0.15 }).observe(el);
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function rgb(hex) {
    let h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    const n = parseInt(h, 16);
    return Number.isNaN(n) ? [128, 128, 128] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }

  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function seeded(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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

  // Call `fn` when the element's width changes (not on mobile scroll resizes).
  function onWidthChange(el, fn) {
    let width = Math.round(el.getBoundingClientRect().width);
    let timer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        const next = Math.round(el.getBoundingClientRect().width);
        if (next && next !== width) { width = next; fn(); }
      }, 150);
    });
  }

  // ---------- 1. Grounded chest X-ray report ----------
  (function report() {
    const fig = document.getElementById('fig-report');
    if (!fig) return;
    const items = fig.querySelectorAll('.fig__item[data-finding]');
    const boxes = fig.querySelectorAll('.xr-box');
    let current = 0;
    let timer = 0;
    let held = false;

    function show(n) {
      current = n;
      items.forEach(function (el) { el.classList.toggle('is-active', el.dataset.finding === String(n)); });
      boxes.forEach(function (el) { el.classList.toggle('is-active', el.dataset.finding === String(n)); });
    }
    function next() { show((current % 3) + 1); }
    function start() {
      if (reducedMotion || held || timer) return;
      next();
      timer = setInterval(next, 2400);
    }
    function stop() { clearInterval(timer); timer = 0; }

    items.forEach(function (el) {
      const n = Number(el.dataset.finding);
      const hold = function () { held = true; stop(); show(n); };
      const release = function () { held = false; start(); };
      el.addEventListener('mouseenter', hold);
      el.addEventListener('focus', hold);
      el.addEventListener('click', hold);
      el.addEventListener('mouseleave', release);
      el.addEventListener('blur', release);
    });

    if (reducedMotion) show(1);
    whileVisible(fig, start, stop);
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
      if (reducedMotion || timer) return;
      tick();
      timer = setInterval(tick, 1300);
    }
    function stop() { clearInterval(timer); timer = 0; }

    if (reducedMotion) { step = organs.length; render(); }
    whileVisible(fig, start, stop);
  })();

  // ---------- 3. Pathology attention map ----------
  (function attention() {
    const fig = document.getElementById('fig-attention');
    if (!fig) return;
    const canvas = fig.querySelector('canvas');
    const toggle = fig.querySelector('.fig__toggle');
    let view = null;
    let tissue = null;
    let hotspots = [];
    let heat = null;
    let grid = null;
    let raf = 0;
    let t0 = 0;
    let held = reducedMotion;
    toggle.setAttribute('aria-pressed', String(held));

    function build() {
      view = sizeCanvas(canvas);
      const w = view.w;
      const h = view.h;
      const dark = document.documentElement.dataset.theme === 'dark';
      const rand = seeded(1840);
      const colours = dark
        ? { stroma: '#05070a', fibre: 'rgba(77,141,255,0.07)', cyto: 'rgba(255,95,166,0.22)', lumen: '#020304', nucleus: '#4d8dff' }
        : { stroma: '#f4d6e1', fibre: 'rgba(196,110,150,0.22)', cyto: 'rgba(214,120,165,0.55)', lumen: '#fdf6f8', nucleus: 'rgba(75,44,122,0.85)' };
      // Amber to orange stands out against both the pink stain and the dark field.
      heat = [rgb('#ffcf4a'), rgb('#ff6a1a')];
      grid = rgb(cssVar('--ink'));

      tissue = document.createElement('canvas');
      tissue.width = canvas.width;
      tissue.height = canvas.height;
      const t = tissue.getContext('2d');
      t.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
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

      // The model attends to two glands strongly and one weakly.
      hotspots = glands.slice(0, 3).map(function (g, i) {
        return { x: g.x, y: g.y, sigma: g.r * 1.7, weight: i < 2 ? 1 : 0.55 };
      });
    }

    function attentionAt(x, y) {
      let best = 0;
      hotspots.forEach(function (s) {
        const d2 = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
        best = Math.max(best, s.weight * Math.exp(-d2 / (2 * s.sigma * s.sigma)));
      });
      return best;
    }

    function draw(alpha) {
      const ctx = view.ctx;
      const w = view.w;
      const h = view.h;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(tissue, 0, 0, w, h);
      if (alpha <= 0.01) return;
      const tile = Math.max(14, Math.min(w, h) / 11);
      for (let y = 0; y < h; y += tile) {
        for (let x = 0; x < w; x += tile) {
          const a = attentionAt(x + tile / 2, y + tile / 2);
          if (a < 0.08) continue;
          ctx.fillStyle = rgba(mix(heat[0], heat[1], a), a * 0.62 * alpha);
          ctx.fillRect(x, y, tile, tile);
        }
      }
      ctx.strokeStyle = rgba(grid, 0.12 * alpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = tile; x < w; x += tile) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
      for (let y = tile; y < h; y += tile) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
      ctx.stroke();
    }

    // Attention fades in and out over seven seconds unless it is held on.
    function frame(now) {
      if (!t0) t0 = now;
      draw(0.5 - 0.5 * Math.cos(((now - t0) / 7000) * Math.PI * 2));
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (!view) build();
      if (held || reducedMotion) { draw(held ? 1 : 0); return; }
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }

    toggle.addEventListener('click', function () {
      held = !held;
      toggle.setAttribute('aria-pressed', String(held));
      stop();
      start();
    });
    window.addEventListener('themechange', function () { if (view) { build(); stop(); start(); } });
    onWidthChange(canvas, function () { build(); stop(); start(); });
    whileVisible(fig, start, stop);
  })();

  // ---------- 4. Agent loop ----------
  (function agent() {
    const fig = document.getElementById('fig-agent');
    if (!fig) return;
    const svg = fig.querySelector('svg');
    const dot = svg.querySelector('.ag-dot');
    const nodes = Array.prototype.slice.call(svg.querySelectorAll('g[data-step] .ag-node'));
    const exits = {
      answer: svg.querySelector('g[data-exit="answer"] .ag-exit'),
      human: svg.querySelector('g[data-exit="human"] .ag-exit'),
    };
    const items = fig.querySelectorAll('.fig__item[data-step]');
    const centre = { x: 150, y: 140 };
    const radius = 86;
    const check = { x: 150, y: 226 };
    const pill = { answer: { x: 235, y: 273 }, human: { x: 68, y: 273 } };
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
      Object.keys(exits).forEach(function (k) { exits[k].classList.toggle('is-active', k === exit); });
      const item = exit ? 'exit' : String(step === 3 ? 2 : step);
      items.forEach(function (el) { el.classList.toggle('is-active', step !== -1 || exit ? el.dataset.step === item : false); });
    }

    function place(x, y) { dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1)); }

    function frame(now) {
      if (!run) run = newRun(now);
      const t = now - run.start;
      if (t < run.loopMs) {
        const angle = -Math.PI / 2 + (t / LAP_MS) * Math.PI * 2;
        place(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius);
        const quarter = ((angle + Math.PI / 2) / (Math.PI / 2)) % 4;
        const near = Math.abs(quarter - Math.round(quarter)) < 0.22 ? Math.round(quarter) % 4 : -1;
        highlight(near, null);
      } else if (t < run.loopMs + EXIT_MS) {
        const k = (t - run.loopMs) / EXIT_MS;
        const to = pill[run.exit];
        place(check.x + (to.x - check.x) * k, check.y + (to.y - check.y) * k);
        highlight(-1, null);
      } else if (t < run.loopMs + EXIT_MS + HOLD_MS) {
        highlight(-1, run.exit);
      } else {
        run = newRun(now);
      }
      raf = requestAnimationFrame(frame);
    }
    function start() { if (!reducedMotion && !raf) raf = requestAnimationFrame(frame); }
    function stop() { cancelAnimationFrame(raf); raf = 0; }

    if (reducedMotion) { place(pill.answer.x, pill.answer.y); highlight(-1, 'answer'); }
    whileVisible(fig, start, stop);
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
      if (reducedMotion) {
        for (let i = 0; i < 180; i++) update(1 / 60);
        draw();
        return;
      }
      if (!raf) { last = 0; raf = requestAnimationFrame(step); }
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }

    window.addEventListener('themechange', function () { if (view) { build(); draw(); } });
    onWidthChange(canvas, function () { particles = []; build(); draw(); });
    whileVisible(fig, start, stop);
  })();
})();
