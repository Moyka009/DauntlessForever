// Dauntless Forever - launcher
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
// fh-banner.js - DF-FH-LIGHT (Oct 23): moving light on the Forever Hunts banner (Play page). Sun shafts come down
// from the top right and slowly drift and brighten, and specks of dust and pollen float down through them, lighting
// up when they pass through a shaft. One small canvas over the picture, about 30 frames a second.
// Like the sky behind the pages (sky.js): stops when the window is hidden or the Play page is not shown, while a
// game is running, and when the moving background is turned off in Settings; stays still if Windows asks for less motion.
'use strict';
const FHLight = (() => {
  const canvas = document.getElementById('fh-rays');
  if (!canvas || !canvas.getContext) return { pause() {} };
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, raf = 0, last = 0, paused = false;

  // Shafts: where they start along the top (share of the width), how wide, how bright, and how fast they breathe
  const SHAFTS = [
    { x: 0.30, wd: 34, a: 0.20, sp: 0.21, ph: 0.0 },
    { x: 0.46, wd: 58, a: 0.26, sp: 0.15, ph: 1.7 },
    { x: 0.60, wd: 26, a: 0.20, sp: 0.27, ph: 3.1 },
    { x: 0.73, wd: 70, a: 0.30, sp: 0.12, ph: 4.4 },
    { x: 0.88, wd: 40, a: 0.24, sp: 0.19, ph: 2.2 },
    { x: 1.02, wd: 84, a: 0.28, sp: 0.10, ph: 5.3 },
  ];
  const ANGLE = 0.58;   // radians from straight down, leaning toward the bottom left (the sun is at the top right)
  const dir = { x: -Math.sin(ANGLE), y: Math.cos(ANGLE) };

  // one soft shaft, drawn once: bright in the middle across its width, fading toward the ground
  let sprite = null;
  function makeSprite() {
    sprite = document.createElement('canvas'); sprite.width = 64; sprite.height = 256;
    const c = sprite.getContext('2d');
    const across = c.createLinearGradient(0, 0, 64, 0);
    across.addColorStop(0, 'rgba(255,236,190,0)'); across.addColorStop(0.5, 'rgba(255,238,198,1)'); across.addColorStop(1, 'rgba(255,236,190,0)');
    c.fillStyle = across; c.fillRect(0, 0, 64, 256);
    c.globalCompositeOperation = 'destination-in';
    const down = c.createLinearGradient(0, 0, 0, 256);
    down.addColorStop(0, 'rgba(0,0,0,1)'); down.addColorStop(0.55, 'rgba(0,0,0,0.55)'); down.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = down; c.fillRect(0, 0, 64, 256);
  }

  const motes = [];
  function newMote(anywhere) {
    const z = Math.random();   // depth: near motes are bigger, faster and brighter
    return { x: Math.random() * (w + 60) - 20, y: anywhere ? Math.random() * h : -4 - Math.random() * 20, z,
      r: 0.7 + z * 1.7, vy: 4 + z * 10, sway: 4 + Math.random() * 10, ph: Math.random() * 6.28, tw: 0.6 + Math.random() * 1.6 };
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nw = canvas.clientWidth, nh = canvas.clientHeight;
    if (!nw || !nh || (nw === w && nh === h)) return;
    w = nw; h = nh;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    motes.length = 0;
    const n = Math.round(w * h / 2000);   // about 60 on a normal window
    for (let i = 0; i < n; i++) motes.push(newMote(true));
  }
  // where a shaft is at this moment (it drifts a little sideways)
  function shaftAt(s, t) { return { x: s.x * w + Math.sin(t * s.sp * 0.6 + s.ph) * 10, glow: 0.55 + 0.45 * Math.sin(t * s.sp + s.ph) }; }
  // how much light falls on a point: 0 outside every shaft, up to 1 in the middle of a bright one
  function lightAt(px, py, now) {
    let best = 0;
    for (const s of now) {
      // distance from the point to the shaft's centre line (which starts at (s.x, 0) and runs along dir)
      const dx = px - s.x, dy = py;
      const along = dx * dir.x + dy * dir.y;
      const off = Math.abs(dx * dir.y - dy * dir.x);
      if (along < 0) continue;
      const v = Math.max(0, 1 - off / (s.wd * 0.6)) * s.glow * Math.max(0, 1 - along / (h * 1.6));
      if (v > best) best = v;
    }
    return best;
  }
  function draw(time) {
    const t = time / 1000;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    // a warm glow where the sun is
    const g = ctx.createRadialGradient(w * 1.02, -h * 0.15, 0, w * 1.02, -h * 0.15, h * 1.5);
    g.addColorStop(0, `rgba(255,232,180,${0.20 + 0.05 * Math.sin(t * 0.3)})`); g.addColorStop(1, 'rgba(255,232,180,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // the shafts
    const now = SHAFTS.map((s) => ({ ...s, ...shaftAt(s, t) }));
    const len = h / Math.cos(ANGLE) + 40;
    for (const s of now) {
      ctx.save();
      ctx.globalAlpha = s.a * s.glow;
      ctx.translate(s.x, -10); ctx.rotate(ANGLE);
      ctx.drawImage(sprite, -s.wd / 2, 0, s.wd, len);
      ctx.restore();
    }
    // the dust, brighter where the light catches it
    for (const m of motes) {
      const lit = lightAt(m.x, m.y, now);
      const twinkle = 0.75 + 0.25 * Math.sin(t * m.tw * 3 + m.ph);
      const a = Math.min(1, (0.16 + m.z * 0.20 + lit * (0.70 + m.z * 0.30)) * twinkle);
      const r = m.r * (1 + lit * 0.5);
      if (m.z > 0.55 || lit > 0.3) {   // near or lit motes get a soft halo
        ctx.fillStyle = `rgba(255,236,190,${(a * 0.18).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(m.x, m.y, r * 3, 0, 6.283); ctx.fill();
      }
      ctx.fillStyle = `rgba(255,242,214,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, 6.283); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function step(dt, time) {
    const t = time / 1000;
    for (const m of motes) {
      m.y += m.vy * dt;
      m.x += (Math.sin(t * 0.5 + m.ph) * m.sway * 0.35 - 2.5) * dt;   // a slight breeze to the left, like the light
      if (m.y > h + 6 || m.x < -24) Object.assign(m, newMote(false));
    }
  }
  const showing = () => !document.hidden && !paused && canvas.offsetParent !== null && (typeof Sky === 'undefined' || Sky.enabled());
  function frame(time) {
    raf = 0;
    if (!showing()) return;
    resize();
    if (time - last >= 33) {   // about 30 frames a second is plenty for drifting dust
      const dt = Math.min((time - last) / 1000, 0.1); last = time;
      step(dt, time); draw(time);
    }
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (raf) return;
    resize();
    if (reduced) { if (w && h) draw(4000); return; }   // one still picture
    last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  makeSprite();
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  window.addEventListener('resize', () => { resize(); if (reduced && w && h) draw(4000); });
  // the Play page coming back into view (pages are shown and hidden by app.js): look again a few times a second
  setInterval(() => { if (!raf && showing()) start(); }, 500);
  // a running game pauses the sky; the banner follows it
  if (typeof Sky !== 'undefined' && Sky.pause) { const orig = Sky.pause; Sky.pause = (p) => { orig(p); paused = !!p; if (paused) stop(); else start(); }; }
  start();
  return { pause(p) { paused = !!p; if (paused) stop(); else start(); } };
})();
