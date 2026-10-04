// Hero visual: a toy model of somatic evolution in a tissue.
// Cells turn over constantly: one dies (it shrinks and fades) and a
// neighbour divides into the gap (a daughter buds out and slides in), the
// faster-dividing neighbour more often. Mutations arise and selection acts:
//   driver      divides faster, so its clone out-competes its neighbours
//   protective  survives tissue injury, so its clone refills the damage
//   passenger   neutral; it drifts, or hitchhikes inside an expanding clone
// Concepts from Martincorena et al., Science 2018 (mutant clones colonising
// normal tissue) and Ng et al., Nature 2021 (protective, positively selected
// mutations in diseased liver). The numbers are illustrative, tuned offline
// so the default run reliably shows all three mutation types.
// Colours come from CSS custom properties, so it follows the page theme.
(function () {
  'use strict';

  const canvas = document.getElementById('mosaic');
  if (!canvas || !canvas.getContext) return;
  if (!window.SiteLib) { console.error('mosaic: assets/lib.js must load first'); return; }
  const { seeded, rgb, mix, rgba: css, onWidthChange } = window.SiteLib;

  const ctx = canvas.getContext('2d');
  const stat = document.getElementById('mosaic-stat');
  const replayButton = document.getElementById('mosaic-replay');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const GENERATIONS = 50;          // length of one run
  const STEP_MS = 380;             // time between generations
  const DEATH_MS = 320;            // a dying cell shrinks and fades
  const INJURY_DEATH_MS = 520;
  const DIVIDE_MS = 480;           // a daughter buds out and slides into the gap
  const FADE_MS = 520;             // colour fade when a cell mutates
  const PULSE_MS = 1300;           // ring marking a new driver or protective mutation
  const INJURY_MS = 1700;          // injury overlay
  const TURNOVER = 0.06;           // share of cells replaced each generation
  const REFILL = 0.45;             // chance an empty spot refills each generation
  const PASSENGER_RATE = 0.5;      // chance of a new passenger each generation
  const DRIVER_GAIN = 8;           // division-rate multiplier
  const PROTECTIVE_GAIN = 1.3;     // mild division advantage
  const PROTECTIVE_SURVIVAL = 0.92;
  const REGEN_GAIN = 2.5;          // protective clones lead regeneration of damage
  const INJURY_RADIUS = 0.28;      // fraction of the tissue width
  const MAX_CLONES = 90;
  const EXTRA_AFTER_TAP = 14;      // generations to keep running after a tap

  // The default run tells the story; passengers arrive at random throughout.
  const SCRIPT = {
    1: 'driver',
    5: 'protective',
    8: 'protective',
    10: 'driver',
    14: 'injury',
    24: 'protective',
    30: 'injury',
    38: 'injury',
  };

  const WILD_TYPE = { type: 'wt', family: 'wt', shade: 0, prolif: 1, survival: 0.1, passenger: false, parent: -1 };

  let size = 0;
  let cells = [];
  let clones = [];
  let pulses = [];
  let injuries = [];
  let marker = null;               // newest driver or protective mutation
  let shades = { driver: 0, protective: 0 };
  let injuredAt = -Infinity;
  let generation = 0;
  let endGeneration = GENERATIONS;
  let lastStep = 0;
  let running = false;
  let onScreen = true;
  let palette = null;
  let rand = seeded(20260518);

  // ---------- helpers ----------

  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3); }

  function readPalette() {
    const s = getComputedStyle(document.documentElement);
    const v = function (name) { return rgb(s.getPropertyValue(name)); };
    palette = {
      dark: document.documentElement.dataset.theme === 'dark',
      cell: v('--cell'),
      edge: v('--cell-edge'),
      nucleus: v('--nucleus'),
      marker: v('--accent-2'),
      injury: v('--injury'),
      passenger: v('--passenger'),
      passengerEdge: v('--passenger-edge'),
      driver: [v('--driver-1'), v('--driver-2'), v('--driver-3')],
      protective: [v('--protect-1'), v('--protect-2'), v('--protect-3')],
    };
  }

  // Bridson's Poisson-disc sampling: evenly spaced but irregular cell centres.
  function poisson(w, h, r) {
    const cellSize = r / Math.SQRT2;
    const gw = Math.ceil(w / cellSize);
    const gh = Math.ceil(h / cellSize);
    const grid = new Int32Array(gw * gh).fill(-1);
    const points = [];
    const active = [];

    function add(x, y) {
      points.push([x, y]);
      active.push(points.length - 1);
      grid[Math.floor(y / cellSize) * gw + Math.floor(x / cellSize)] = points.length - 1;
    }

    function fits(x, y) {
      if (x < r * 0.3 || y < r * 0.3 || x > w - r * 0.3 || y > h - r * 0.3) return false;
      const gx = Math.floor(x / cellSize);
      const gy = Math.floor(y / cellSize);
      for (let j = Math.max(0, gy - 2); j <= Math.min(gh - 1, gy + 2); j++) {
        for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
          const k = grid[j * gw + i];
          if (k >= 0) {
            const dx = points[k][0] - x;
            const dy = points[k][1] - y;
            if (dx * dx + dy * dy < r * r) return false;
          }
        }
      }
      return true;
    }

    add(w * (0.4 + 0.2 * rand()), h * (0.4 + 0.2 * rand()));
    while (active.length) {
      const a = Math.floor(rand() * active.length);
      const p = points[active[a]];
      let placed = false;
      for (let n = 0; n < 24; n++) {
        const angle = rand() * Math.PI * 2;
        const dist = r * (1 + rand());
        const x = p[0] + Math.cos(angle) * dist;
        const y = p[1] + Math.sin(angle) * dist;
        if (fits(x, y)) { add(x, y); placed = true; break; }
      }
      if (!placed) active.splice(a, 1);
    }
    return points;
  }

  // A smooth, slightly irregular closed outline around (x, y).
  function blobPath(x, y, radius, wobble, rotation) {
    const n = wobble.length;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = rotation + (i / n) * Math.PI * 2;
      pts.push([x + Math.cos(a) * radius * wobble[i], y + Math.sin(a) * radius * wobble[i]]);
    }
    const path = new Path2D();
    let mx = (pts[n - 1][0] + pts[0][0]) / 2;
    let my = (pts[n - 1][1] + pts[0][1]) / 2;
    path.moveTo(mx, my);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      mx = (p[0] + q[0]) / 2;
      my = (p[1] + q[1]) / 2;
      path.quadraticCurveTo(p[0], p[1], mx, my);
    }
    path.closePath();
    return path;
  }

  function wobble(n, spread) {
    const w = [];
    for (let i = 0; i < n; i++) w.push(1 - spread / 2 + spread * rand());
    return w;
  }

  // ---------- tissue ----------

  function build() {
    const width = Math.round(canvas.getBoundingClientRect().width);
    if (!width) return false;
    size = width;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    rand = seeded(20260518);
    const spacing = size / 15;
    cells = poisson(size, size, spacing).map(function (p) {
      const radius = spacing * (0.44 + 0.06 * rand());
      const nucleusRadius = spacing * (0.15 + 0.04 * rand());
      const nx = p[0] + (rand() - 0.5) * spacing * 0.16;
      const ny = p[1] + (rand() - 0.5) * spacing * 0.16;
      const dotAngle = rand() * Math.PI * 2;
      return {
        x: p[0],
        y: p[1],
        radius: radius,
        body: blobPath(p[0], p[1], radius, wobble(7, 0.22), rand() * Math.PI * 2),
        nucleus: blobPath(nx, ny, nucleusRadius, wobble(5, 0.18), rand() * Math.PI * 2),
        halo: blobPath(nx, ny, nucleusRadius * 1.9, wobble(5, 0.1), 0),
        dotX: nx + Math.cos(dotAngle) * nucleusRadius * 1.3,
        dotY: ny + Math.sin(dotAngle) * nucleusRadius * 1.3,
        dotRadius: nucleusRadius * 0.52,
        neighbours: [],
        clone: -1,
        previous: -1,
        alive: true,
        since: -1e9,
        event: null,
      };
    });

    const reach = (spacing * 1.75) * (spacing * 1.75);
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const dx = cells[i].x - cells[j].x;
        const dy = cells[i].y - cells[j].y;
        if (dx * dx + dy * dy < reach) {
          cells[i].neighbours.push(j);
          cells[j].neighbours.push(i);
        }
      }
    }
    return true;
  }

  function reset() {
    rand = seeded(Date.now() & 0xffffffff);
    for (const c of cells) {
      c.clone = -1;
      c.previous = -1;
      c.alive = true;
      c.since = -1e9;
      c.event = null;
    }
    clones = [];
    pulses = [];
    injuries = [];
    marker = null;
    shades = { driver: 0, protective: 0 };
    injuredAt = -Infinity;
    generation = 0;
    endGeneration = GENERATIONS;
  }

  function props(k) { return k < 0 ? WILD_TYPE : clones[k]; }

  function randomAlive() {
    const alive = [];
    for (let i = 0; i < cells.length; i++) if (cells[i].alive) alive.push(i);
    return alive.length ? alive[Math.floor(rand() * alive.length)] : -1;
  }

  // A living neighbour divides into this cell's place, weighted by how fast
  // it divides. When the tissue is regenerating, protective clones lead.
  function pickParent(cell, regenerating) {
    let total = 0;
    for (const j of cell.neighbours) {
      if (cells[j].alive) total += weight(cells[j].clone, regenerating);
    }
    if (!total) return -1;
    let r = rand() * total;
    for (const j of cell.neighbours) {
      if (!cells[j].alive) continue;
      r -= weight(cells[j].clone, regenerating);
      if (r <= 0) return j;
    }
    return -1;
  }

  function weight(k, regenerating) {
    const p = props(k);
    return p.prolif * (regenerating && p.family === 'protective' ? REGEN_GAIN : 1);
  }

  // Cell `index` is replaced by a daughter of `parent`. The model state
  // changes now; the animation (death, then division) plays from `start`.
  function replace(index, parent, start) {
    const cell = cells[index];
    const k = cells[parent].clone;
    cell.event = {
      start: start,
      death: cell.alive ? DEATH_MS : 0,
      parent: parent,
      from: cell.alive ? cell.clone : null,
      to: k,
    };
    cell.alive = true;
    cell.clone = k;
    cell.previous = k;
    cell.since = -1e9;
  }

  function kill(cell, now) {
    cell.event = { start: now, death: INJURY_DEATH_MS, parent: -1, from: cell.clone, to: null };
    cell.alive = false;
  }

  function mutate(index, type, now) {
    if (index < 0 || clones.length >= MAX_CLONES) return false;
    const cell = cells[index];
    const parent = props(cell.clone);
    const functional = type !== 'passenger';
    clones.push({
      type: type,
      parent: cell.clone,
      family: functional ? type : parent.family,
      shade: functional ? shades[type]++ % 3 : parent.shade,
      prolif: parent.prolif * (type === 'driver' ? DRIVER_GAIN : type === 'protective' ? PROTECTIVE_GAIN : 1),
      survival: type === 'protective' ? PROTECTIVE_SURVIVAL : parent.survival,
      passenger: type === 'passenger' || parent.passenger,
    });
    const k = clones.length - 1;
    cell.previous = cell.clone;
    cell.clone = k;
    cell.since = now;

    if (functional) {
      // The founder cell divides straight away (drivers twice), so a new
      // clone is not lost to the very next round of turnover.
      const living = cell.neighbours.filter(function (j) { return cells[j].alive; });
      const divisions = type === 'driver' ? 2 : 1;
      for (let d = 0; d < divisions && living.length; d++) {
        replace(living.splice(Math.floor(rand() * living.length), 1)[0], index, now + 300 + d * 260);
      }
      pulses.push({ x: cell.x, y: cell.y, start: now, clone: k });
      marker = { cell: index, until: generation + 6 };
    }
    return true;
  }

  // Scripted injuries land near a protective clone so its advantage shows.
  function injurySite() {
    const protectedCells = cells.filter(function (c) {
      return c.alive && props(c.clone).family === 'protective';
    });
    if (protectedCells.length) {
      const c = protectedCells[Math.floor(rand() * protectedCells.length)];
      return [c.x + (rand() - 0.5) * size * 0.08, c.y + (rand() - 0.5) * size * 0.08];
    }
    return [size * (0.25 + 0.5 * rand()), size * (0.25 + 0.5 * rand())];
  }

  function injure(x, y, now) {
    const radius = size * INJURY_RADIUS;
    for (const c of cells) {
      if (!c.alive) continue;
      const dx = c.x - x;
      const dy = c.y - y;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (rand() < props(c.clone).survival) continue;
      kill(c, now);
    }
    injuries.push({ x: x, y: y, radius: radius, start: now });
    injuredAt = generation;
  }

  function step(now) {
    generation++;

    const event = SCRIPT[generation];
    if (event === 'driver' || event === 'protective') {
      mutate(randomAlive(), event, now);
    } else if (event === 'injury') {
      const site = injurySite();
      injure(site[0], site[1], now);
    }
    if (rand() < PASSENGER_RATE) mutate(randomAlive(), 'passenger', now);

    // Turnover: a cell dies and a neighbour divides into its place. Events
    // are spread across the generation so the tissue moves continuously.
    const alive = [];
    for (let i = 0; i < cells.length; i++) if (cells[i].alive) alive.push(i);
    const deaths = Math.round(alive.length * TURNOVER);
    for (let n = 0; n < deaths; n++) {
      const j = alive[Math.floor(rand() * alive.length)];
      const p = pickParent(cells[j], false);
      if (p !== -1) replace(j, p, now + rand() * STEP_MS);
    }

    // Regeneration: empty spots fill from living neighbours.
    const refills = [];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].alive || rand() > REFILL) continue;
      const p = pickParent(cells[i], true);
      if (p !== -1) refills.push([i, p]);
    }
    for (const r of refills) replace(r[0], r[1], now + rand() * STEP_MS);

    updateStat();
  }

  function updateStat() {
    if (!stat) return;
    const present = new Set();
    let alive = 0;
    let mutated = 0;
    for (const c of cells) {
      if (!c.alive) continue;
      alive++;
      if (c.clone >= 0) mutated++;
      for (let k = c.clone; k >= 0; k = clones[k].parent) present.add(k);
    }
    const count = { driver: 0, protective: 0, passenger: 0 };
    present.forEach(function (k) { count[clones[k].type]++; });
    const share = alive ? Math.round((100 * mutated) / alive) : 0;
    let text = 'Generation ' + generation +
      ' · ' + count.driver + (count.driver === 1 ? ' driver' : ' drivers') +
      ' · ' + count.protective + ' protective' +
      ' · ' + count.passenger + (count.passenger === 1 ? ' passenger' : ' passengers') +
      ' · ' + share + '% mutated';
    if (generation - injuredAt < 3) text += ' · tissue injury';
    stat.textContent = text;
  }

  // ---------- drawing ----------

  function tintOf(k) {
    const p = props(k);
    if (p.family === 'driver') return palette.driver[p.shade];
    if (p.family === 'protective') return palette.protective[p.shade];
    return null;
  }

  function eventEnd(e) {
    return e.start + e.death + (e.to === null ? 0 : DIVIDE_MS);
  }

  // Draw cell c's shape showing clone `k` (fading in from `from` over t),
  // centred at (x, y) and scaled by s.
  function drawCell(c, k, from, t, x, y, s, alpha) {
    const to = tintOf(k);
    const was = tintOf(from);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x - s * c.x, y - s * c.y);
    ctx.scale(s, s);

    if (palette.dark) {
      // Fluorescence: dim cytoplasm; reporter colour glows in mutant cells.
      ctx.fillStyle = css(palette.cell, 1);
      ctx.fill(c.body);
      ctx.globalCompositeOperation = 'lighter';
      if (was && t < 1) { ctx.fillStyle = css(was, 0.42 * (1 - t)); ctx.fill(c.body); }
      if (to) { ctx.fillStyle = css(to, 0.42 * t); ctx.fill(c.body); }
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = css(mix(was || palette.edge, to || palette.edge, t), 0.9);
      ctx.lineWidth = 1.2;
      ctx.stroke(c.body);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = css(palette.nucleus, 0.12);
      ctx.fill(c.halo);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = css(palette.nucleus, 0.9);
      ctx.fill(c.nucleus);
    } else {
      // Brightfield: eosin cytoplasm, hematoxylin nuclei, clones as a lineage overlay.
      const wasFill = was ? mix(palette.cell, was, 0.72) : palette.cell;
      const toFill = to ? mix(palette.cell, to, 0.72) : palette.cell;
      ctx.fillStyle = css(mix(wasFill, toFill, t), 0.9);
      ctx.fill(c.body);
      ctx.strokeStyle = css(mix(was || palette.edge, to || palette.edge, t), 1);
      ctx.lineWidth = 1.2;
      ctx.stroke(c.body);
      ctx.fillStyle = css(palette.nucleus, 0.82);
      ctx.fill(c.nucleus);
    }

    if (props(k).passenger) {
      const dotAlpha = 0.95 * (props(from).passenger ? 1 : t);
      ctx.fillStyle = css(palette.passenger, dotAlpha);
      ctx.strokeStyle = css(palette.passengerEdge, dotAlpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c.dotX, c.dotY, c.dotRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEmpty(c) {
    ctx.strokeStyle = css(palette.edge, 0.4);
    ctx.lineWidth = 1;
    ctx.stroke(c.body);
  }

  // Returns true if the cell is mid-animation and was drawn here.
  function drawEvent(c, now) {
    const e = c.event;
    if (!e || now >= eventEnd(e)) return false;

    if (now < e.start) {
      // Not started yet: show what was there before.
      if (e.from === null) drawEmpty(c);
      else drawCell(c, e.from, e.from, 1, c.x, c.y, 1, 1);
      return true;
    }

    drawEmpty(c);
    if (now < e.start + e.death) {
      // Death: shrink and fade.
      const k = ease((now - e.start) / e.death);
      drawCell(c, e.from, e.from, 1, c.x, c.y, 1 - 0.55 * k, 1 - k);
      return true;
    }

    // Division: a daughter buds out of the parent and slides into the gap.
    const parent = cells[e.parent];
    const k = ease((now - e.start - e.death) / DIVIDE_MS);
    const x = parent.x + (c.x - parent.x) * k;
    const y = parent.y + (c.y - parent.y) * k;
    drawCell(c, e.to, e.to, 1, x, y, 0.4 + 0.6 * k, 0.55 + 0.45 * k);
    return true;
  }

  function draw(now) {
    ctx.clearRect(0, 0, size, size);

    // Settled cells first, then cells mid-event on top so daughters can
    // slide over their neighbours.
    const busy = [];
    for (const c of cells) {
      if (c.event && now < eventEnd(c.event)) { busy.push(c); continue; }
      if (!c.alive) { drawEmpty(c); continue; }
      drawCell(c, c.clone, c.previous, ease((now - c.since) / FADE_MS), c.x, c.y, 1, 1);
    }
    for (const c of busy) drawEvent(c, now);

    injuries = injuries.filter(function (j) { return now - j.start < INJURY_MS; });
    for (const j of injuries) {
      const k = (now - j.start) / INJURY_MS;
      const glow = ctx.createRadialGradient(j.x, j.y, 0, j.x, j.y, j.radius * 1.1);
      glow.addColorStop(0, css(palette.injury, 0.24 * (1 - k)));
      glow.addColorStop(1, css(palette.injury, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(j.x - j.radius * 1.2, j.y - j.radius * 1.2, j.radius * 2.4, j.radius * 2.4);
      ctx.strokeStyle = css(palette.injury, 0.6 * (1 - k));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(j.x, j.y, j.radius * (0.92 + 0.12 * k), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Marker on the newest driver or protective mutation.
    if (marker && generation <= marker.until && cells[marker.cell].alive) {
      const m = cells[marker.cell];
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = css(palette.marker, 0.95);
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius * 1.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    pulses = pulses.filter(function (p) { return now - p.start < PULSE_MS; });
    for (const p of pulses) {
      const k = (now - p.start) / PULSE_MS;
      ctx.strokeStyle = css(tintOf(p.clone), (1 - k) * 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size / 30 + (k * size) / 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---------- animation loop ----------

  function settling(now) {
    if (pulses.length || injuries.length) return true;
    for (const c of cells) {
      if (now - c.since < FADE_MS) return true;
      if (c.event && now < eventEnd(c.event)) return true;
    }
    return false;
  }

  function frame(now) {
    if (!running) return;
    if (generation < endGeneration && now - lastStep >= STEP_MS) {
      lastStep = now;
      step(now);
    }
    draw(now);
    if (generation >= endGeneration && !settling(now)) {
      running = false;
      return;
    }
    requestAnimationFrame(frame);
  }

  function start() {
    if (running || !onScreen || document.hidden) return;
    if (generation >= endGeneration && !settling(performance.now())) return;
    running = true;
    lastStep = performance.now() - STEP_MS;
    requestAnimationFrame(frame);
  }

  function runInstantly() {
    while (generation < endGeneration) step(-1e9);
    pulses = [];
    injuries = [];
    draw(0);
  }

  function replay() {
    reset();
    updateStat();
    if (reducedMotion.matches) { runInstantly(); return; }
    start();
  }

  // ---------- events ----------

  // Tapping the tissue injures it there.
  canvas.addEventListener('click', function (event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (size / rect.width);
    const y = (event.clientY - rect.top) * (size / rect.height);
    const now = reducedMotion.matches ? -1e9 : performance.now();
    injure(x, y, now);
    endGeneration = Math.max(endGeneration, generation + EXTRA_AFTER_TAP);
    updateStat();
    if (reducedMotion.matches) runInstantly(); else start();
  });

  if (replayButton) replayButton.addEventListener('click', replay);

  window.addEventListener('themechange', function () {
    readPalette();
    if (!running) draw(reducedMotion.matches ? 0 : performance.now());
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
      if (onScreen) start(); else running = false;
    }).observe(canvas);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) running = false; else start();
  });

  onWidthChange(canvas, function () {
    running = false;
    build();
    replay();
  });

  // ---------- go ----------

  readPalette();
  if (build()) replay();
})();
