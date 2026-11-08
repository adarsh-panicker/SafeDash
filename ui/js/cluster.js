// SafeDash UI/UX Intuitive Extensions
window.__speedUnit = 'kmh'; // 'kmh' or 'mph'
window.showToast = function(icon, text) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'cockpit-toast';
  toast.innerHTML = `<span style="font-size:1.1rem;">${icon}</span><span>${text}</span>`;
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3100);
};
/**
 * SafeDash — cluster.js
 * Main gauge rendering engine & WebSocket telemetry handler
 * QNX Global Hackathon  |  Pure Vanilla JS / HTML5 Canvas
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   Utility helpers
   ═══════════════════════════════════════════════════════════════ */
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const toRad = deg => (deg * Math.PI) / 180;
const formatNum = (v, dec = 1) => (typeof v === 'number' ? v.toFixed(dec) : '---');

/* ═══════════════════════════════════════════════════════════════
   Telemetry State
   ═══════════════════════════════════════════════════════════════ */
const state = {
  /* Powertrain */
  speed_kmh:    0,
  rpm:          0,
  gear:         'N',
  throttle_pct: 0,
  brake_pct:    0,
  engine_temp_c: 80,

  /* Battery */
  soc_pct:   85,
  voltage_v: 400,
  regen_kw:  0,
  batt_temp_c: 25,

  /* ADAS */
  abs_active:        false,
  collision:         false,
  lane_dep_L:        false,
  lane_dep_R:        false,
  bspot_L:           false,
  bspot_R:           false,
  speed_limit_kmh:   100,
  acc_distance_m:    50,
  airbag_fault:      false,
  all_seatbelts_ok:  true,

  /* Comfort */
  odometer_km:      0,
  trip_distance_km: 0,

  /* EV Dynamic Performance */
  power_kw: 0,
  g_lat: 0,
  g_long: 0,

  /* TPMS (FMVSS 138) */
  tpms: { fl: 36.1, fr: 36.0, rl: 35.6, rr: 35.7 },

  /* Navigation */
  nav: {
    dist_m: 450,
    heading: 315,
    maneuver: 'SLIGHT_RIGHT',
    street: 'QNX Innovation Expressway'
  },

  /* EV Dynamic Performance */
  power_kw: 0,
  g_lat: 0,
  g_long: 0,

  /* TPMS (FMVSS 138) */
  tpms: { fl: 36.1, fr: 36.0, rl: 35.6, rr: 35.7 },

  /* Navigation */
  nav: {
    dist_m: 450,
    heading: 315,
    maneuver: 'SLIGHT_RIGHT',
    street: 'QNX Innovation Expressway'
  },

  /* Stats */
  frame_count: 0,
  error_count: 0,
};

window.__rightGaugeMode = 'rpm'; // 'rpm' or 'power'


window.__rightGaugeMode = 'rpm'; // 'rpm' or 'power'


/* Smooth display values (interpolated) */
const disp = { ...state };

/* ═══════════════════════════════════════════════════════════════
   Colour constants (mirror CSS vars for Canvas use)
   ═══════════════════════════════════════════════════════════════ */
const C = {
  bg:        '#0a0e1a',
  bgPanel:   '#111827',
  track:     '#1a2340',
  green:     '#00ff88',
  cyan:      '#00e5ff',
  amber:     '#ffaa00',
  red:       '#ff2244',
  purple:    '#bb44ff',
  white:     '#e8f0fe',
  textMuted: '#3d4f6e',
};

/* ═══════════════════════════════════════════════════════════════
   ClusterRenderer — 60 fps animation loop
   ═══════════════════════════════════════════════════════════════ */
class ClusterRenderer {
  constructor () {
    this.spdCanvas    = document.getElementById('speedometer-canvas');
    this.rpmCanvas    = document.getElementById('rpm-canvas');
    this.tempCanvas   = document.getElementById('temp-canvas');
    this.gforceCanvas = document.getElementById('gforce-canvas');
    this.spdCtx       = this.spdCanvas.getContext('2d');
    this.rpmCtx       = this.rpmCanvas.getContext('2d');
    this.tempCtx      = this.tempCanvas.getContext('2d');
    this.gforceCtx    = this.gforceCanvas ? this.gforceCanvas.getContext('2d') : null;

    this._dpr  = window.devicePixelRatio || 1;
    this._raf  = null;
    this._last = performance.now();
    this._fps  = 0;
    this._fpsAccum = 0;
    this._fpsCt    = 0;

    this._setupCanvases();
    window.addEventListener('resize', () => this._setupCanvases());
  }

  _setupCanvases () {
    const dpr = this._dpr;
    const spdWrap = document.getElementById('speedometer-wrap');
    const rpmWrap = document.getElementById('rpm-wrap');

    const spdRect = spdWrap ? spdWrap.getBoundingClientRect() : null;
    const rpmRect = rpmWrap ? rpmWrap.getBoundingClientRect() : null;

    const spdSize = spdRect ? Math.min(spdRect.width * 0.98, spdRect.height * 0.98, 480) : 400;
    const rpmSize = rpmRect ? Math.min(rpmRect.width * 0.98, rpmRect.height * 0.98, 480) : 400;

    this._setCanvas(this.spdCanvas, Math.max(300, spdSize), Math.max(300, spdSize));
    this._setCanvas(this.rpmCanvas, Math.max(300, rpmSize), Math.max(300, rpmSize));
    this._setCanvas(this.tempCanvas, 140, 100);
    if (this.gforceCanvas) this._setCanvas(this.gforceCanvas, 60, 60);
  }

  _setCanvas (canvas, w, h) {
    const dpr = this._dpr;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    canvas.getContext('2d').scale(dpr, dpr);
  }

  start () {
    const loop = (now) => {
      const dt = now - this._last;
      this._last = now;
      this._interpolate(dt);
      this._render();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop () {
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _interpolate (dt) {
    const t = clamp(dt / 1000 * 10, 0, 0.3);  // ~10% per frame @ 60fps
    const lerpc = (key) => { disp[key] = lerp(disp[key] ?? 0, state[key] ?? 0, t); };
    ['speed_kmh','rpm','throttle_pct','brake_pct','soc_pct','regen_kw',
     'engine_temp_c','acc_distance_m','voltage_v','batt_temp_c','power_kw','g_lat','g_long'].forEach(lerpc);
    disp.tpms = state.tpms;
    disp.nav  = state.nav;
    // Booleans — instant
    ['abs_active','collision','lane_dep_L','lane_dep_R',
     'bspot_L','bspot_R','airbag_fault'].forEach(k => { disp[k] = state[k]; });
    disp.gear = state.gear;
    disp.speed_limit_kmh = state.speed_limit_kmh;
  }

  _render () {
    const W_spd  = this.spdCanvas.width  / this._dpr;
    const H_spd  = this.spdCanvas.height / this._dpr;
    const W_rpm  = this.rpmCanvas.width  / this._dpr;
    const H_rpm  = this.rpmCanvas.height / this._dpr;
    const W_tmp  = this.tempCanvas.width  / this._dpr;
    const H_tmp  = this.tempCanvas.height / this._dpr;

    this.spdCtx.clearRect(0, 0, W_spd, H_spd);
    this.rpmCtx.clearRect(0, 0, W_rpm, H_rpm);
    this.tempCtx.clearRect(0, 0, W_tmp, H_tmp);

    this.drawSpeedometer(this.spdCtx, disp.speed_kmh, 240, W_spd, H_spd);
    if (window.__rightGaugeMode === 'power') {
      this.drawPowerGauge(this.rpmCtx, disp.power_kw, W_rpm, H_rpm);
    } else {
      this.drawRPMGauge(this.rpmCtx, disp.rpm, 8000, W_rpm, H_rpm);
    }
    this.drawTempGauge(this.tempCtx, disp.engine_temp_c, 40, 130, W_tmp, H_tmp);
    if (this.gforceCtx) {
      this.drawGForceMeter(this.gforceCtx, disp.g_lat, disp.g_long);
    }
    this.drawTPMS(disp.tpms);
    this.drawNavCard(disp.nav);

    this.drawGearIndicator(disp.gear);
    this.drawBatteryBar(disp.soc_pct, disp.regen_kw);
    this.drawPedalBars(disp.throttle_pct, disp.brake_pct);
    this.drawADAS();
    this.drawTelltales();
    this.updateFrameInfo();

    if (window.__roadVision) {
      window.__roadVision.render(disp);
    }
    if (window.__audioEngine && !window.__manualDrive?.isManualMode) {
      window.__audioEngine.updateMotorSound(disp.speed_kmh, disp.rpm, disp.throttle_pct);
    }
  }

  drawSpeedometer (ctx, speed, maxSpeed, W, H) {
    const cx = W / 2, cy = H / 2 + H * 0.02;
    const R  = Math.min(W, H) * 0.44;
    const startAngle = toRad(140);
    const endAngle   = toRad(400);
    const arcRange   = endAngle - startAngle;

    // Unit toggle support (KM/H vs MPH)
    const isMph = window.__speedUnit === 'mph';
    const displaySpeed = isMph ? (speed * 0.621371) : speed;
    const effMax = isMph ? 160 : maxSpeed;
    const unitLabel = isMph ? 'MPH' : 'KM / H';

    // 1. Outer Metallic Bezel Ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R + 14, 0, Math.PI * 2);
    const bezelGrad = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    bezelGrad.addColorStop(0,   'rgba(80, 100, 140, 0.45)');
    bezelGrad.addColorStop(0.5, 'rgba(20, 30, 50, 0.2)');
    bezelGrad.addColorStop(1,   'rgba(80, 100, 140, 0.45)');
    ctx.strokeStyle = bezelGrad;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Dial face radial gradient
    const dialGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, R);
    dialGrad.addColorStop(0,   'rgba(18, 26, 48, 0.55)');
    dialGrad.addColorStop(0.7, 'rgba(10, 15, 30, 0.85)');
    dialGrad.addColorStop(1,   'rgba(6, 10, 20, 0.95)');
    ctx.fillStyle = dialGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Track background arc
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(26, 38, 70, 0.65)';
    ctx.lineWidth   = 16;
    ctx.lineCap     = 'round';
    ctx.stroke();

    // 3. Value arc & Needle light trail
    const speedFrac = clamp(displaySpeed / effMax, 0, 1);
    const fillEnd   = startAngle + arcRange * speedFrac;

    if (speedFrac > 0.01) {
      // Translucent light sweep cone
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R - 8, startAngle, fillEnd);
      ctx.closePath();
      const sweepGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, R);
      sweepGrad.addColorStop(0, 'rgba(0, 229, 255, 0.01)');
      sweepGrad.addColorStop(1, speed > 180 ? 'rgba(255, 34, 68, 0.12)' : 'rgba(0, 229, 255, 0.12)');
      ctx.fillStyle = sweepGrad;
      ctx.fill();
      ctx.restore();

      // Glowing Value Arc
      const grad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
      grad.addColorStop(0,   C.green);
      grad.addColorStop(0.6, C.cyan);
      grad.addColorStop(1,   speed > 180 ? C.red : C.cyan);

      ctx.save();
      ctx.shadowColor = speed > 180 ? C.red : C.cyan;
      ctx.shadowBlur  = 16;
      ctx.beginPath();
      ctx.arc(cx, cy, R, startAngle, fillEnd);
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 16;
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 4. Precision Ticks & Numbers
    const tickStep = isMph ? 10 : 20;
    for (let v = 0; v <= effMax; v += tickStep) {
      const frac  = v / effMax;
      const angle = startAngle + arcRange * frac;
      const isMajor = isMph ? (v % 20 === 0) : (v % 40 === 0);
      const inner = R - (isMajor ? 20 : 12);
      const outer = R - 6;

      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.85)' : 'rgba(100, 130, 175, 0.45)';
      ctx.lineWidth   = isMajor ? 2.5 : 1.2;
      ctx.stroke();

      if (isMajor && v <= effMax) {
        const lR = R - 34;
        ctx.font = Math.round(W * 0.045) + 'px sans-serif';
        ctx.fillStyle   = v <= displaySpeed ? 'rgba(255, 255, 255, 0.95)' : 'rgba(120, 145, 185, 0.5)';
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), cx + Math.cos(angle) * lR, cy + Math.sin(angle) * lR);
      }
    }

    // 5. Needle with Light Glow
    const needleAngle = startAngle + arcRange * speedFrac;
    const nLen = R - 16;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAngle);
    ctx.shadowColor = speed > 180 ? C.red : C.cyan;
    ctx.shadowBlur  = 14;

    const needleGrad = ctx.createLinearGradient(0, 0, nLen, 0);
    needleGrad.addColorStop(0,   'rgba(255, 255, 255, 0.2)');
    needleGrad.addColorStop(0.7, '#ffffff');
    needleGrad.addColorStop(1,   speed > 180 ? '#ff2244' : '#00e5ff');

    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(nLen, 0);
    ctx.strokeStyle = needleGrad;
    ctx.lineWidth   = 3.5;
    ctx.lineCap     = 'round';
    ctx.stroke();
    ctx.restore();

    // 6. Chrome Needle Hub / Pivot
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = speed > 180 ? C.red : C.cyan;
    ctx.shadowColor = speed > 180 ? C.red : C.cyan;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;

    // 7. Large Digital Readout with Glow
    const speedInt = Math.round(clamp(displaySpeed, 0, 999));
    ctx.save();
    ctx.font = '800 ' + Math.round(W * 0.22) + 'px sans-serif';
    ctx.fillStyle = speed > 180 ? '#ff3355' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = speed > 180 ? 'rgba(255, 34, 68, 0.6)' : 'rgba(0, 229, 255, 0.5)';
    ctx.shadowBlur = 20;
    ctx.fillText(String(speedInt), cx, cy - R * 0.16);
    ctx.restore();

    ctx.font = Math.round(W * 0.045) + 'px sans-serif';
    ctx.fillStyle = 'rgba(140, 170, 210, 0.8)';
    ctx.textAlign = 'center';
    ctx.fillText(unitLabel, cx, cy - R * 0.16 + W * 0.14);
  }

  drawRPMGauge (ctx, rpm, maxRPM, W, H) {
    const cx = W / 2, cy = H / 2 + H * 0.02;
    const R  = Math.min(W, H) * 0.44;
    const startAngle = toRad(140);
    const endAngle   = toRad(400);
    const arcRange   = endAngle - startAngle;
    const redlineFrac = 6500 / maxRPM;

    // 1. Outer Metallic Bezel Ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R + 14, 0, Math.PI * 2);
    const bezelGrad = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    bezelGrad.addColorStop(0,   'rgba(80, 100, 140, 0.45)');
    bezelGrad.addColorStop(0.5, 'rgba(20, 30, 50, 0.2)');
    bezelGrad.addColorStop(1,   'rgba(80, 100, 140, 0.45)');
    ctx.strokeStyle = bezelGrad;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Dial face radial gradient
    const dialGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, R);
    dialGrad.addColorStop(0,   'rgba(18, 26, 48, 0.55)');
    dialGrad.addColorStop(0.7, 'rgba(10, 15, 30, 0.85)');
    dialGrad.addColorStop(1,   'rgba(6, 10, 20, 0.95)');
    ctx.fillStyle = dialGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Track
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(26, 38, 70, 0.65)';
    ctx.lineWidth   = 16;
    ctx.lineCap     = 'round';
    ctx.stroke();

    // Redline arc
    const redStart = startAngle + arcRange * redlineFrac;
    ctx.beginPath();
    ctx.arc(cx, cy, R, redStart, endAngle);
    ctx.strokeStyle = 'rgba(255, 34, 68, 0.4)';
    ctx.lineWidth   = 16;
    ctx.lineCap     = 'round';
    ctx.stroke();

    // 3. Value arc & Needle light trail
    const rpmFrac = clamp(rpm / maxRPM, 0, 1);
    const fillEnd = startAngle + arcRange * rpmFrac;
    const isRed = rpm >= 6500;

    if (rpmFrac > 0.01) {
      // Translucent light sweep cone
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R - 8, startAngle, fillEnd);
      ctx.closePath();
      const sweepGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, R);
      sweepGrad.addColorStop(0, 'rgba(255, 170, 0, 0.01)');
      sweepGrad.addColorStop(1, isRed ? 'rgba(255, 34, 68, 0.15)' : 'rgba(255, 170, 0, 0.12)');
      ctx.fillStyle = sweepGrad;
      ctx.fill();
      ctx.restore();

      // Value arc
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, startAngle, fillEnd);
      ctx.strokeStyle = isRed ? '#ff2244' : '#ffaa00';
      ctx.lineWidth   = 16;
      ctx.lineCap     = 'round';
      ctx.shadowColor = isRed ? '#ff2244' : '#ffaa00';
      ctx.shadowBlur  = 16;
      ctx.stroke();
      ctx.restore();
    }

    // 4. Ticks
    for (let v = 0; v <= maxRPM; v += 500) {
      const frac  = v / maxRPM;
      const angle = startAngle + arcRange * frac;
      const isMajor = (v % 1000 === 0);
      const inner = R - (isMajor ? 20 : 12);
      const outer = R - 6;

      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.strokeStyle = v >= 6500 ? 'rgba(255, 34, 68, 0.85)' : (isMajor ? 'rgba(255, 255, 255, 0.85)' : 'rgba(100, 130, 175, 0.45)');
      ctx.lineWidth   = isMajor ? 2.5 : 1.2;
      ctx.stroke();

      if (isMajor) {
        const lR = R - 34;
        ctx.font = Math.round(W * 0.045) + 'px sans-serif';
        ctx.fillStyle   = v >= 6500 ? '#ff4466' : (v <= rpm ? 'rgba(255, 255, 255, 0.95)' : 'rgba(120, 145, 185, 0.5)');
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v / 1000), cx + Math.cos(angle) * lR, cy + Math.sin(angle) * lR);
      }
    }

    // 5. Needle
    const needleAngle = startAngle + arcRange * rpmFrac;
    const nLen = R - 16;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAngle);
    ctx.shadowColor = isRed ? '#ff2244' : '#ffaa00';
    ctx.shadowBlur  = 14;

    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(nLen, 0);
    ctx.strokeStyle = isRed ? '#ff2244' : '#ffaa00';
    ctx.lineWidth   = 3.5;
    ctx.lineCap     = 'round';
    ctx.stroke();
    ctx.restore();

    // 6. Chrome Pivot
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = isRed ? '#ff2244' : '#ffaa00';
    ctx.shadowColor = isRed ? '#ff2244' : '#ffaa00';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;

    // 7. Large Digital RPM Readout
    const rpmK = (rpm / 1000).toFixed(1);
    ctx.save();
    ctx.font = '800 ' + Math.round(W * 0.22) + 'px sans-serif';
    ctx.fillStyle = isRed ? '#ff2244' : '#ffaa00';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = isRed ? 'rgba(255, 34, 68, 0.6)' : 'rgba(255, 170, 0, 0.5)';
    ctx.shadowBlur   = 16;
    ctx.fillText(rpmK, cx, cy - R * 0.16);
    ctx.restore();

    ctx.font = Math.round(W * 0.045) + 'px sans-serif';
    ctx.fillStyle = 'rgba(140, 170, 210, 0.8)';
    ctx.textAlign = 'center';
    ctx.fillText('RPM x 1000', cx, cy - R * 0.16 + W * 0.14);
  }

  /* ── Modern EV Power kW & Regen Delivery Gauge (Taycan / Audi e-tron GT) ── */
  drawPowerGauge (ctx, powerKw, W, H) {
    const cx = W / 2, cy = H / 2 + H * 0.02;
    const R  = Math.min(W, H) * 0.44;
    const startAngle = toRad(140);
    const endAngle   = toRad(400);
    const zeroAngle  = toRad(205); // Zero power coasting point
    const arcRange   = endAngle - startAngle;

    // 1. Outer Bezel & Dark Dial Face
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R + 14, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(80, 100, 140, 0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();

    const dialGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, R);
    dialGrad.addColorStop(0,   'rgba(18, 26, 48, 0.55)');
    dialGrad.addColorStop(0.7, 'rgba(10, 15, 30, 0.85)');
    dialGrad.addColorStop(1,   'rgba(6, 10, 20, 0.95)');
    ctx.fillStyle = dialGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Track background
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(26, 38, 70, 0.65)';
    ctx.lineWidth   = 16;
    ctx.lineCap     = 'round';
    ctx.stroke();

    // 3. Regen Zone (-100 to 0 kW) and Power Zone (0 to 400 kW)
    // Clamp power between -100 and +400 kW
    const pwrClamped = clamp(powerKw, -100, 400);
    let pwrAngle;
    if (pwrClamped < 0) {
      // Regen sweep from zeroAngle back to startAngle
      const frac = Math.abs(pwrClamped) / 100;
      pwrAngle = zeroAngle - (zeroAngle - startAngle) * frac;
      ctx.save();
      ctx.shadowColor = C.green;
      ctx.shadowBlur  = 16;
      ctx.beginPath();
      ctx.arc(cx, cy, R, pwrAngle, zeroAngle);
      ctx.strokeStyle = C.green;
      ctx.lineWidth   = 16;
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.restore();
    } else {
      // Power delivery sweep from zeroAngle to endAngle
      const frac = pwrClamped / 400;
      pwrAngle = zeroAngle + (endAngle - zeroAngle) * frac;
      const grad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
      grad.addColorStop(0,   C.cyan);
      grad.addColorStop(0.8, C.cyan);
      grad.addColorStop(1,   C.red);
      ctx.save();
      ctx.shadowColor = pwrClamped > 250 ? C.red : C.cyan;
      ctx.shadowBlur  = 16;
      ctx.beginPath();
      ctx.arc(cx, cy, R, zeroAngle, pwrAngle);
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 16;
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 4. Dial Scale Ticks
    const majorTicks = [
      { val: -100, angle: startAngle, label: '-100' },
      { val: 0,    angle: zeroAngle,  label: '0' },
      { val: 100,  angle: zeroAngle + (endAngle - zeroAngle) * 0.25, label: '100' },
      { val: 200,  angle: zeroAngle + (endAngle - zeroAngle) * 0.50, label: '200' },
      { val: 300,  angle: zeroAngle + (endAngle - zeroAngle) * 0.75, label: '300' },
      { val: 400,  angle: endAngle,   label: '400' }
    ];

    majorTicks.forEach(t => {
      const inner = R - 18;
      const outer = R - 6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(t.angle) * inner, cy + Math.sin(t.angle) * inner);
      ctx.lineTo(cx + Math.cos(t.angle) * outer, cy + Math.sin(t.angle) * outer);
      ctx.strokeStyle = t.val < 0 ? C.green : 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth   = 2.2;
      ctx.stroke();

      const lR = R - 32;
      ctx.font = Math.round(W * 0.042) + 'px sans-serif';
      ctx.fillStyle   = t.val < 0 ? C.green : 'rgba(140, 170, 210, 0.85)';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.label, cx + Math.cos(t.angle) * lR, cy + Math.sin(t.angle) * lR);
    });

    // 5. Needle
    const nLen = R - 16;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(pwrAngle);
    ctx.shadowColor = pwrClamped < 0 ? C.green : (pwrClamped > 250 ? C.red : C.cyan);
    ctx.shadowBlur  = 14;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(nLen, 0);
    ctx.strokeStyle = pwrClamped < 0 ? C.green : (pwrClamped > 250 ? C.red : C.cyan);
    ctx.lineWidth   = 3.5;
    ctx.lineCap     = 'round';
    ctx.stroke();
    ctx.restore();

    // 6. Pivot
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = pwrClamped < 0 ? C.green : C.cyan;
    ctx.fill();

    // 7. Digital Readout
    ctx.save();
    ctx.font = '800 ' + Math.round(W * 0.20) + 'px sans-serif';
    ctx.fillStyle = pwrClamped < 0 ? C.green : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = pwrClamped < 0 ? C.green : C.cyan;
    ctx.shadowBlur   = 16;
    const sign = pwrClamped > 0 ? '+' : '';
    ctx.fillText(`${sign}${Math.round(pwrClamped)}`, cx, cy - R * 0.16);
    ctx.restore();

    ctx.font = Math.round(W * 0.045) + 'px sans-serif';
    ctx.fillStyle = pwrClamped < 0 ? C.green : 'rgba(140, 170, 210, 0.8)';
    ctx.textAlign = 'center';
    ctx.fillText(pwrClamped < 0 ? 'REGEN kW' : 'POWER kW', cx, cy - R * 0.16 + W * 0.14);
  }

  /* ── 2D G-Force Friction Circle Meter ──────────────────────────────────── */
  drawGForceMeter (ctx, gLat, gLong) {
    const W = 60, H = 60;
    const cx = W / 2, cy = H / 2;
    const R  = 24;

    ctx.clearRect(0, 0, W, H);

    // Outer circle (1.0 G)
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Inner circle (0.5 G)
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
    ctx.stroke();

    // Crosshairs
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();

    // Dynamic G-Dot
    const dotX = clamp(cx + (gLat / 1.2) * R, cx - R + 2, cx + R - 2);
    const dotY = clamp(cy - (gLong / 1.2) * R, cy - R + 2, cy + R - 2);

    ctx.save();
    ctx.shadowColor = C.cyan;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fillStyle = C.cyan;
    ctx.fill();
    ctx.restore();

    const gValEl = document.getElementById('gforce-val');
    if (gValEl) {
      const mag = Math.sqrt(gLat * gLat + gLong * gLong);
      gValEl.textContent = `${mag.toFixed(2)} G`;
    }
  }

  /* ── Tire Pressure Monitoring System (TPMS) ───────────────────────────── */
  drawTPMS (tpms) {
    if (!tpms) return;
    const flEl = document.getElementById('tpms-fl-psi');
    const frEl = document.getElementById('tpms-fr-psi');
    const rlEl = document.getElementById('tpms-rl-psi');
    const rrEl = document.getElementById('tpms-rr-psi');

    if (flEl && tpms.fl !== undefined) flEl.textContent = Number(tpms.fl).toFixed(1);
    if (frEl && tpms.fr !== undefined) frEl.textContent = Number(tpms.fr).toFixed(1);
    if (rlEl && tpms.rl !== undefined) rlEl.textContent = Number(tpms.rl).toFixed(1);
    if (rrEl && tpms.rr !== undefined) rrEl.textContent = Number(tpms.rr).toFixed(1);
  }

  /* ── Turn-by-Turn Navigation HUD Card ──────────────────────────────────── */
  drawNavCard (nav) {
    if (!nav) return;
    const distEl = document.getElementById('nav-dist');
    const compEl = document.getElementById('nav-compass');
    const strEl  = document.getElementById('nav-street');
    const iconEl = document.getElementById('nav-icon');

    if (distEl && nav.dist_m !== undefined) distEl.textContent = `In ${nav.dist_m} m`;
    if (compEl && nav.heading !== undefined) compEl.textContent = `${nav.heading}° NW`;
    if (strEl && nav.street) strEl.textContent = nav.street;
    if (iconEl && nav.maneuver) {
      iconEl.textContent = nav.maneuver === 'SLIGHT_RIGHT' ? '↱' : (nav.maneuver === 'SLIGHT_LEFT' ? '↰' : '⬆');
    }
  }


  /* ── Modern EV Power kW & Regen Delivery Gauge (Taycan / Audi e-tron GT) ── */
  drawPowerGauge (ctx, powerKw, W, H) {
    const cx = W / 2, cy = H / 2 + H * 0.02;
    const R  = Math.min(W, H) * 0.44;
    const startAngle = toRad(140);
    const endAngle   = toRad(400);
    const zeroAngle  = toRad(205); // Zero power coasting point
    const arcRange   = endAngle - startAngle;

    // 1. Outer Bezel & Dark Dial Face
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R + 14, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(80, 100, 140, 0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();

    const dialGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, R);
    dialGrad.addColorStop(0,   'rgba(18, 26, 48, 0.55)');
    dialGrad.addColorStop(0.7, 'rgba(10, 15, 30, 0.85)');
    dialGrad.addColorStop(1,   'rgba(6, 10, 20, 0.95)');
    ctx.fillStyle = dialGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Track background
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(26, 38, 70, 0.65)';
    ctx.lineWidth   = 16;
    ctx.lineCap     = 'round';
    ctx.stroke();

    // 3. Regen Zone (-100 to 0 kW) and Power Zone (0 to 400 kW)
    // Clamp power between -100 and +400 kW
    const pwrClamped = clamp(powerKw, -100, 400);
    let pwrAngle;
    if (pwrClamped < 0) {
      // Regen sweep from zeroAngle back to startAngle
      const frac = Math.abs(pwrClamped) / 100;
      pwrAngle = zeroAngle - (zeroAngle - startAngle) * frac;
      ctx.save();
      ctx.shadowColor = C.green;
      ctx.shadowBlur  = 16;
      ctx.beginPath();
      ctx.arc(cx, cy, R, pwrAngle, zeroAngle);
      ctx.strokeStyle = C.green;
      ctx.lineWidth   = 16;
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.restore();
    } else {
      // Power delivery sweep from zeroAngle to endAngle
      const frac = pwrClamped / 400;
      pwrAngle = zeroAngle + (endAngle - zeroAngle) * frac;
      const grad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
      grad.addColorStop(0,   C.cyan);
      grad.addColorStop(0.8, C.cyan);
      grad.addColorStop(1,   C.red);
      ctx.save();
      ctx.shadowColor = pwrClamped > 250 ? C.red : C.cyan;
      ctx.shadowBlur  = 16;
      ctx.beginPath();
      ctx.arc(cx, cy, R, zeroAngle, pwrAngle);
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 16;
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 4. Dial Scale Ticks
    const majorTicks = [
      { val: -100, angle: startAngle, label: '-100' },
      { val: 0,    angle: zeroAngle,  label: '0' },
      { val: 100,  angle: zeroAngle + (endAngle - zeroAngle) * 0.25, label: '100' },
      { val: 200,  angle: zeroAngle + (endAngle - zeroAngle) * 0.50, label: '200' },
      { val: 300,  angle: zeroAngle + (endAngle - zeroAngle) * 0.75, label: '300' },
      { val: 400,  angle: endAngle,   label: '400' }
    ];

    majorTicks.forEach(t => {
      const inner = R - 18;
      const outer = R - 6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(t.angle) * inner, cy + Math.sin(t.angle) * inner);
      ctx.lineTo(cx + Math.cos(t.angle) * outer, cy + Math.sin(t.angle) * outer);
      ctx.strokeStyle = t.val < 0 ? C.green : 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth   = 2.2;
      ctx.stroke();

      const lR = R - 32;
      ctx.font = Math.round(W * 0.042) + 'px sans-serif';
      ctx.fillStyle   = t.val < 0 ? C.green : 'rgba(140, 170, 210, 0.85)';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.label, cx + Math.cos(t.angle) * lR, cy + Math.sin(t.angle) * lR);
    });

    // 5. Needle
    const nLen = R - 16;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(pwrAngle);
    ctx.shadowColor = pwrClamped < 0 ? C.green : (pwrClamped > 250 ? C.red : C.cyan);
    ctx.shadowBlur  = 14;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(nLen, 0);
    ctx.strokeStyle = pwrClamped < 0 ? C.green : (pwrClamped > 250 ? C.red : C.cyan);
    ctx.lineWidth   = 3.5;
    ctx.lineCap     = 'round';
    ctx.stroke();
    ctx.restore();

    // 6. Pivot
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = pwrClamped < 0 ? C.green : C.cyan;
    ctx.fill();

    // 7. Digital Readout
    ctx.save();
    ctx.font = '800 ' + Math.round(W * 0.20) + 'px sans-serif';
    ctx.fillStyle = pwrClamped < 0 ? C.green : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = pwrClamped < 0 ? C.green : C.cyan;
    ctx.shadowBlur   = 16;
    const sign = pwrClamped > 0 ? '+' : '';
    ctx.fillText(`${sign}${Math.round(pwrClamped)}`, cx, cy - R * 0.16);
    ctx.restore();

    ctx.font = Math.round(W * 0.045) + 'px sans-serif';
    ctx.fillStyle = pwrClamped < 0 ? C.green : 'rgba(140, 170, 210, 0.8)';
    ctx.textAlign = 'center';
    ctx.fillText(pwrClamped < 0 ? 'REGEN kW' : 'POWER kW', cx, cy - R * 0.16 + W * 0.14);
  }

  /* ── 2D G-Force Friction Circle Meter ──────────────────────────────────── */
  drawGForceMeter (ctx, gLat, gLong) {
    const W = 60, H = 60;
    const cx = W / 2, cy = H / 2;
    const R  = 24;

    ctx.clearRect(0, 0, W, H);

    // Outer circle (1.0 G)
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Inner circle (0.5 G)
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
    ctx.stroke();

    // Crosshairs
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();

    // Dynamic G-Dot
    const dotX = clamp(cx + (gLat / 1.2) * R, cx - R + 2, cx + R - 2);
    const dotY = clamp(cy - (gLong / 1.2) * R, cy - R + 2, cy + R - 2);

    ctx.save();
    ctx.shadowColor = C.cyan;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fillStyle = C.cyan;
    ctx.fill();
    ctx.restore();

    const gValEl = document.getElementById('gforce-val');
    if (gValEl) {
      const mag = Math.sqrt(gLat * gLat + gLong * gLong);
      gValEl.textContent = `${mag.toFixed(2)} G`;
    }
  }

  /* ── Tire Pressure Monitoring System (TPMS) ───────────────────────────── */
  drawTPMS (tpms) {
    if (!tpms) return;
    const flEl = document.getElementById('tpms-fl-psi');
    const frEl = document.getElementById('tpms-fr-psi');
    const rlEl = document.getElementById('tpms-rl-psi');
    const rrEl = document.getElementById('tpms-rr-psi');

    if (flEl && tpms.fl !== undefined) flEl.textContent = Number(tpms.fl).toFixed(1);
    if (frEl && tpms.fr !== undefined) frEl.textContent = Number(tpms.fr).toFixed(1);
    if (rlEl && tpms.rl !== undefined) rlEl.textContent = Number(tpms.rl).toFixed(1);
    if (rrEl && tpms.rr !== undefined) rrEl.textContent = Number(tpms.rr).toFixed(1);
  }

  /* ── Turn-by-Turn Navigation HUD Card ──────────────────────────────────── */
  drawNavCard (nav) {
    if (!nav) return;
    const distEl = document.getElementById('nav-dist');
    const compEl = document.getElementById('nav-compass');
    const strEl  = document.getElementById('nav-street');
    const iconEl = document.getElementById('nav-icon');

    if (distEl && nav.dist_m !== undefined) distEl.textContent = `In ${nav.dist_m} m`;
    if (compEl && nav.heading !== undefined) compEl.textContent = `${nav.heading}° NW`;
    if (strEl && nav.street) strEl.textContent = nav.street;
    if (iconEl && nav.maneuver) {
      iconEl.textContent = nav.maneuver === 'SLIGHT_RIGHT' ? '↱' : (nav.maneuver === 'SLIGHT_LEFT' ? '↰' : '⬆');
    }
  }


  drawGearIndicator (gear) {
    const el = document.getElementById('gear-indicator');
    const display = (gear === 0 || gear === 'N') ? 'N'
                  : (gear === 'R')               ? 'R'
                  : (gear === 'P')               ? 'P'
                  : String(gear);
    if (el) {
      el.textContent = display;
      el.style.color = gear === 'R' ? C.red
                     : gear === 'N' ? C.amber
                     : gear === 'P' ? C.textMuted
                     : C.cyan;
    }
    document.querySelectorAll('.gear-btn').forEach(btn => {
      const g = btn.dataset.gear;
      const isActive = (display === g) || (display >= '1' && display <= '8' && (g === 'D' || g === 'S'));
      btn.classList.toggle('active', isActive);
      if (g === 'R') btn.classList.toggle('gear-r', isActive);
    });
  }

  /* ── Battery Bar ──────────────────────────────────────────── */
  drawBatteryBar (soc, regenKw) {
    const fill = document.getElementById('battery-bar-fill');
    const pct  = document.getElementById('battery-soc-pct');
    const regen = document.getElementById('regen-info');
    const regenBar = document.getElementById('regen-bar-fill');
    if (!fill || !pct) return;

    const socClamped = clamp(soc, 0, 100);
    fill.style.width = socClamped + '%';
    fill.className   = 'pedal-fill ' +
      (socClamped < 20 ? 'low' : socClamped < 40 ? 'mid' : '');

    pct.textContent = Math.round(socClamped) + '%';
    pct.style.color = socClamped < 20 ? C.red : socClamped < 40 ? C.amber : C.green;

    if (regenKw > 0.1) {
      regen.textContent = `↻ REGEN  ${regenKw.toFixed(1)} kW`;
      regen.style.color = C.cyan;
      if (regenBar) regenBar.style.width = clamp(regenKw / 50 * 100, 0, 100) + '%';
    } else {
      regen.textContent = '';
      if (regenBar) regenBar.style.width = '0%';
    }
  }

  /* ── Pedal Bars ───────────────────────────────────────────── */
  drawPedalBars (throttle, brake) {
    const tf = document.getElementById('throttle-fill');
    const bf = document.getElementById('brake-fill');
    const tv = document.getElementById('throttle-val');
    const bv = document.getElementById('brake-val');
    if (tf) tf.style.height = clamp(throttle, 0, 100) + '%';
    if (bf) bf.style.height = clamp(brake, 0, 100) + '%';
    if (tv) tv.textContent = Math.round(throttle) + '%';
    if (bv) bv.textContent = Math.round(brake) + '%';
  }

  /* ── Temp Gauge ───────────────────────────────────────────── */
  drawTempGauge (ctx, temp, minTemp, maxTemp, W, H) {
    const cx = W / 2, cy = H / 2 + 8;
    const R  = Math.min(W, H) * 0.38;
    const startAngle = toRad(150);
    const endAngle   = toRad(390);
    const arcRange   = endAngle - startAngle;

    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = C.track;
    ctx.lineWidth   = 8;
    ctx.lineCap     = 'round';
    ctx.stroke();

    const frac = clamp((temp - minTemp) / (maxTemp - minTemp), 0, 1);
    const color = frac > 0.85 ? C.red : frac > 0.65 ? C.amber : C.cyan;
    if (frac > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, R, startAngle, startAngle + arcRange * frac);
      ctx.strokeStyle = color;
      ctx.lineWidth   = 8;
      ctx.lineCap     = 'round';
      ctx.shadowColor = color; ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.font = `700 ${Math.round(W * 0.16)}px 'Courier New', monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(temp) + '°', cx, cy - 4);

    ctx.font = `500 ${Math.round(W * 0.1)}px sans-serif`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText('TEMP', cx, cy + R * 0.55);
  }

  /* ── ADAS Indicators ──────────────────────────────────────── */
  drawADAS () {
    const setActive = (id, active) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', !!active);
    };
    setActive('lane-left',  state.lane_dep_L);
    setActive('lane-right', state.lane_dep_R);
    setActive('bspot-left', state.bspot_L);
    setActive('bspot-right', state.bspot_R);

    const slVal = document.getElementById('speed-limit-val');
    if (slVal) slVal.textContent = Math.round(state.speed_limit_kmh) || '--';

    const accVal = document.getElementById('acc-distance-val');
    if (accVal) accVal.textContent = state.acc_distance_m != null
      ? Math.round(disp.acc_distance_m) + ' m' : '--';
  }

  /* ── Telltales ────────────────────────────────────────────── */
  drawTelltales () {
    const setTelltale = (id, active) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', !!active);
    };
    setTelltale('tt-abs',       state.abs_active);
    setTelltale('tt-airbag',    state.airbag_fault);
    setTelltale('tt-collision', state.collision);

    /* Full-screen collision flash */
    const overlay = document.getElementById('collision-overlay');
    if (overlay) overlay.classList.toggle('active', !!state.collision);
  }

  /* ── Frame Info ───────────────────────────────────────────── */
  updateFrameInfo () {
    const fcEl = document.getElementById('fi-frame');
    const ecEl = document.getElementById('fi-err');
    const frEl = document.getElementById('fi-rate');
    if (fcEl) fcEl.textContent = state.frame_count || 0;
    if (ecEl) ecEl.textContent = state.error_count || 0;

    // FPS tally
    this._fpsCt++;
    this._fpsAccum += (performance.now() - this._last);
    if (this._fpsCt >= 60) {
      this._fps = Math.round(60000 / (this._fpsAccum || 1));
      this._fpsAccum = 0; this._fpsCt = 0;
    }
    if (frEl) frEl.textContent = this._fps || '--';
  }
}

/* ═══════════════════════════════════════════════════════════════
   WebSocket Manager
   ═══════════════════════════════════════════════════════════════ */
class WSManager {
  constructor (urls, onMessage, onStatus) {
    this._urls     = Array.isArray(urls) ? urls : [urls];
    this._urlIndex = 0;
    this._onMsg    = onMessage;
    this._onStatus = onStatus;
    this._ws       = null;
    this._retryMs  = 1200;
    this._retryT   = null;
    this._connected = false;
  }

  get currentUrl () {
    return this._urls[this._urlIndex % this._urls.length];
  }

  connect () {
    if (this._ws) {
      try { this._ws.close(); } catch (_) {}
    }
    const targetUrl = this.currentUrl;
    console.log('[SafeDash WS] Connecting to:', targetUrl);
    try {
      this._ws = new WebSocket(targetUrl);
    } catch (e) {
      this._urlIndex++;
      this._scheduleRetry();
      return;
    }

    this._ws.onopen = () => {
      console.log('[SafeDash WS] Connected:', targetUrl);
      this._connected = true;
      this._onStatus(true);
      clearTimeout(this._retryT);
    };

    this._ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        this._onMsg(data);
      } catch (_) {}
    };

    this._ws.onclose = () => {
      this._connected = false;
      this._onStatus(false);
      this._urlIndex++;
      this._scheduleRetry();
    };

    this._ws.onerror = () => {
      this._connected = false;
      this._onStatus(false);
      try { this._ws.close(); } catch (_) {}
    };
  }

  _scheduleRetry () {
    clearTimeout(this._retryT);
    this._retryT = setTimeout(() => this.connect(), this._retryMs);
  }

  get connected () { return this._connected; }
}

/* ═══════════════════════════════════════════════════════════════
   Telemetry Normaliser — handles both JSON formats
   ═══════════════════════════════════════════════════════════════ */
function normaliseTelemetry (data) {
  /* Full format (from QNX resmgr bridge) */
  if (data.type === 'telemetry') {
    const { safety = {}, powertrain = {}, battery = {}, adas = {}, comfort = {}, stats = {} } = data;
    state.speed_kmh      = powertrain.speed_kmh      ?? state.speed_kmh;
    state.rpm            = powertrain.rpm             ?? state.rpm;
    state.gear           = powertrain.gear            ?? state.gear;
    state.throttle_pct   = powertrain.throttle_pct    ?? state.throttle_pct;
    state.engine_temp_c  = powertrain.engine_temp_c   ?? state.engine_temp_c;

    state.soc_pct        = battery.soc_pct            ?? state.soc_pct;
    state.voltage_v      = battery.voltage_v          ?? state.voltage_v;
    state.regen_kw       = battery.regen_kw           ?? state.regen_kw;
    state.batt_temp_c    = battery.temp_c             ?? state.batt_temp_c;

    state.brake_pct      = safety.brake_pressure_pct  ?? state.brake_pct;
    state.abs_active     = safety.abs_active          ?? state.abs_active;
    state.airbag_fault   = safety.airbag_fault        ?? state.airbag_fault;
    state.collision      = safety.collision_imminent  ?? state.collision;
    state.all_seatbelts_ok = safety.all_seatbelts_ok  ?? state.all_seatbelts_ok;

    state.lane_dep_L     = adas.lane_departure_left   ?? state.lane_dep_L;
    state.lane_dep_R     = adas.lane_departure_right  ?? state.lane_dep_R;
    state.bspot_L        = adas.blind_spot_left       ?? state.bspot_L;
    state.bspot_R        = adas.blind_spot_right      ?? state.bspot_R;
    state.speed_limit_kmh = adas.speed_limit_kmh      ?? state.speed_limit_kmh;
    state.acc_distance_m  = adas.acc_distance_m       ?? state.acc_distance_m;

    state.odometer_km    = comfort.odometer_km        ?? state.odometer_km;
    state.trip_distance_km = comfort.trip_distance_km  ?? state.trip_distance_km;

    state.frame_count    = stats.frame_count          ?? state.frame_count;
    state.error_count    = stats.error_count          ?? state.error_count;

    /* Dispatch system_status events to health monitor */
    if (data.system_status && window.__healthMonitor) {
      window.__healthMonitor.update(data.system_status);
    }
    return;
  }

  /* System health status (separate message type) */
  if (data.type === 'system_status') {
    if (window.__healthMonitor) window.__healthMonitor.update(data);
    return;
  }

  /* Simple format (host sim mode) */
  if (data.speed_kmh      !== undefined) state.speed_kmh      = data.speed_kmh;
  if (data.rpm            !== undefined) state.rpm            = data.rpm;
  if (data.gear           !== undefined) state.gear           = data.gear;
  if (data.throttle_pct   !== undefined) state.throttle_pct   = data.throttle_pct;
  if (data.brake_pct      !== undefined) state.brake_pct      = data.brake_pct;
  if (data.soc_pct        !== undefined) state.soc_pct        = data.soc_pct;
  if (data.regen_kw       !== undefined) state.regen_kw       = data.regen_kw;
  if (data.abs_active     !== undefined) state.abs_active     = data.abs_active;
  if (data.collision      !== undefined) state.collision      = data.collision;
  if (data.lane_dep_L     !== undefined) state.lane_dep_L     = data.lane_dep_L;
  if (data.lane_dep_R     !== undefined) state.lane_dep_R     = data.lane_dep_R;
  if (data.bspot_L        !== undefined) state.bspot_L        = data.bspot_L;
  if (data.bspot_R        !== undefined) {
    // key may be bspot_R or similar
    state.bspot_R = data.bspot_R;
  }
  if (data.power_kw       !== undefined) state.power_kw       = data.power_kw;
  if (data.g_lat          !== undefined) state.g_lat          = data.g_lat;
  if (data.g_long         !== undefined) state.g_long         = data.g_long;
  if (data.tpms           !== undefined) state.tpms           = data.tpms;
  if (data.nav            !== undefined) state.nav            = data.nav;
  if (data.frames         !== undefined && Array.isArray(data.frames)) {
    updateCanSniffer(data.frames);
  }
  if (data.frame_count    !== undefined) state.frame_count    = data.frame_count;
  if (data.ts             !== undefined) { /* timestamp, ignore */ }
}

/* ═══════════════════════════════════════════════════════════════
   WebSocket status UI
   ═══════════════════════════════════════════════════════════════ */
let signalLostTimer = null;
function setWSStatus (connected) {
  const dot   = document.getElementById('ws-dot');
  const label = document.getElementById('ws-label');
  const signalOverlay = document.getElementById('signal-lost-overlay');

  if (dot) {
    dot.classList.toggle('connected', connected);
  }
  if (label) {
    label.textContent = connected ? 'LIVE (QNX)' : 'SIMULATING';
    label.style.color = connected ? 'var(--accent-green)' : 'var(--accent-amber)';
  }
  if (signalOverlay) {
    if (connected) {
      clearTimeout(signalLostTimer);
      signalOverlay.classList.remove('active');
    } else {
      // 4-second grace period before warning overlay appears
      clearTimeout(signalLostTimer);
      signalLostTimer = setTimeout(() => {
        signalOverlay.classList.add('active');
      }, 4000);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   Clock
   ═══════════════════════════════════════════════════════════════ */
function startClock () {
  const el = document.getElementById('clock');
  if (!el) return;
  const tick = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    el.textContent = `${hh}:${mm}:${ss}`;
  };
  tick();
  setInterval(tick, 1000);
}

/* ═══════════════════════════════════════════════════════════════
   Demo / Simulation mode (runs when WS is unavailable)
   Generates fake telemetry so the gauges always animate
   ═══════════════════════════════════════════════════════════════ */
class DemoSimulator {
  constructor () {
    this._t = 0;
    this._interval = null;
  }

  start () {
    this._interval = setInterval(() => this._tick(), 50);
  }

  stop () {
    clearInterval(this._interval);
  }

  _tick () {
    this._t += 0.05;
    const t = this._t;

    state.speed_kmh    = 60 + Math.sin(t * 0.3)  * 55 + Math.sin(t * 0.7) * 15;
    state.rpm          = 1800 + Math.sin(t * 0.4) * 1600 + Math.abs(Math.sin(t * 0.9)) * 1200;
    state.gear         = Math.min(8, Math.max(1, Math.round(state.speed_kmh / 30) + 1));
    state.throttle_pct = clamp(30 + Math.sin(t * 0.5) * 25 + Math.sin(t * 1.1) * 10, 0, 100);
    state.brake_pct    = clamp(Math.max(0, -Math.sin(t * 0.4) * 30), 0, 100);
    state.soc_pct      = clamp(80 - t * 0.05, 5, 100);
    state.regen_kw     = state.brake_pct > 10 ? state.brake_pct * 0.4 : 0;
    state.engine_temp_c = 85 + Math.sin(t * 0.1) * 15;
    state.frame_count++;

    if (Math.abs(Math.sin(t * 0.07)) > 0.95) state.abs_active = true;
    else state.abs_active = false;

    state.lane_dep_L = Math.sin(t * 0.11) > 0.9;
    state.lane_dep_R = Math.sin(t * 0.13) > 0.95;
    state.bspot_L    = Math.sin(t * 0.09) > 0.92;
    state.bspot_R    = Math.sin(t * 0.15) > 0.92;
    state.speed_limit_kmh = 100;
    state.acc_distance_m  = 30 + Math.sin(t * 0.08) * 25;

    // EV Power & Dynamic G-forces
    state.power_kw = (state.throttle_pct / 100) * 360 - (state.brake_pct > 5 ? state.regen_kw : 0);
    state.g_long   = ((state.throttle_pct / 100) * 0.75) - ((state.brake_pct / 100) * 1.05);
    state.g_lat    = Math.sin(t * 0.5) * 0.22;

    // TPMS baseline simulation
    state.tpms = {
      fl: 36.1 + Math.sin(t * 0.1) * 0.2,
      fr: 36.0 + Math.sin(t * 0.12) * 0.2,
      rl: 35.6 + Math.sin(t * 0.09) * 0.2,
      rr: 35.7 + Math.sin(t * 0.11) * 0.2
    };

    // Navigation preview
    state.nav = {
      dist_m: Math.max(50, Math.round(550 - (t * 22) % 550)),
      heading: Math.round((315 + Math.sin(t * 0.2) * 25) % 360),
      maneuver: (Math.round(550 - (t * 22) % 550) < 180) ? 'SLIGHT_RIGHT' : 'STRAIGHT',
      street: 'QNX Innovation Expressway'
    };

    // EV Power & Dynamic G-forces
    state.power_kw = (state.throttle_pct / 100) * 360 - (state.brake_pct > 5 ? state.regen_kw : 0);
    state.g_long   = ((state.throttle_pct / 100) * 0.75) - ((state.brake_pct / 100) * 1.05);
    state.g_lat    = Math.sin(t * 0.5) * 0.22;

    // TPMS baseline simulation
    state.tpms = {
      fl: 36.1 + Math.sin(t * 0.1) * 0.2,
      fr: 36.0 + Math.sin(t * 0.12) * 0.2,
      rl: 35.6 + Math.sin(t * 0.09) * 0.2,
      rr: 35.7 + Math.sin(t * 0.11) * 0.2
    };

    // Navigation preview
    state.nav = {
      dist_m: Math.max(50, Math.round(550 - (t * 22) % 550)),
      heading: Math.round((315 + Math.sin(t * 0.2) * 25) % 360),
      maneuver: (Math.round(550 - (t * 22) % 550) < 180) ? 'SLIGHT_RIGHT' : 'STRAIGHT',
      street: 'QNX Innovation Expressway'
    };

    // Notify health monitor
    if (window.__healthMonitor) {
      window.__healthMonitor.update({
        thread_name:   'SafeDash/renderer',
        priority:      10,
        latency_us:    Math.round(300 + Math.sin(t) * 200 + Math.random() * 100),
        frame_count:   state.frame_count,
        error_count:   state.error_count,
      });
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   Bootstrap
   ═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  startClock();

  const renderer = new ClusterRenderer();
  renderer.start();

  const demo = new DemoSimulator();
  demo.start(); // Start simulated animation immediately so gauges are never blank

  const host = window.location.hostname || '127.0.0.1';
  const urls = [
    `ws://${host === 'localhost' ? '127.0.0.1' : host}:8080`,
    'ws://127.0.0.1:8080',
    'ws://localhost:8080'
  ];

  const ws = new WSManager(
    urls,
    (data) => {
      demo.stop();   // stop demo once real data arrives
      normaliseTelemetry(data);
    },
    (connected) => {
      setWSStatus(connected);
      if (!connected) demo.start();
    }
  );

  ws.connect();

  const signalOverlay = document.getElementById('signal-lost-overlay');
  if (signalOverlay) {
    signalOverlay.addEventListener('click', () => {
      signalOverlay.classList.remove('active');
    });
  }

  // Expose state for other modules
  window.__clusterState    = state;
  window.__clusterRenderer = renderer;
  window.__clusterWS       = ws;
});


/* ── Drive Mode Selector & Dynamic Cockpit Themes ───────────────────────── */
function setDriveMode(mode) {
  document.body.classList.remove('mode-sport', 'mode-eco', 'mode-normal', 'mode-autopilot');
  document.body.classList.add(`mode-${mode}`);

  document.querySelectorAll('.drive-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const label = document.getElementById('active-drive-mode-label');
  if (label) label.textContent = mode.toUpperCase();

  if (window.__audioEngine) {
    if (mode === 'sport') window.__audioEngine.playChime(780, 0.15);
    else if (mode === 'eco') window.__audioEngine.playChime(520, 0.15);
    else window.__audioEngine.playChime(620, 0.15);
  }

  // Update simulator driving characteristics if in demo mode
  if (state) {
    if (mode === 'sport') state.speed_limit_kmh = 130;
    else if (mode === 'eco') state.speed_limit_kmh = 90;
    else state.speed_limit_kmh = 100;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.drive-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setDriveMode(btn.dataset.mode);
    });
  });
  // Gear buttons
  document.querySelectorAll('.gear-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = btn.dataset.gear;
      state.gear = isNaN(g) ? g : Number(g);
      document.querySelectorAll('.gear-btn').forEach(b => b.classList.toggle('active', b === btn));
      if (window.__audioEngine) window.__audioEngine.playChime(440, 0.08);
    });
  });

  // Speed Limit +/-
  const btnLimUp = document.getElementById('btn-limit-up');
  const btnLimDn = document.getElementById('btn-limit-down');
  if (btnLimUp) {
    btnLimUp.addEventListener('click', () => {
      state.speed_limit_kmh = Math.min(200, (state.speed_limit_kmh || 100) + 10);
      const val = document.getElementById('speed-limit-val');
      if (val) val.textContent = state.speed_limit_kmh;
      if (window.__audioEngine) window.__audioEngine.playChime(880, 0.05);
    });
  }
  if (btnLimDn) {
    btnLimDn.addEventListener('click', () => {
      state.speed_limit_kmh = Math.max(30, (state.speed_limit_kmh || 100) - 10);
      const val = document.getElementById('speed-limit-val');
      if (val) val.textContent = state.speed_limit_kmh;
      if (window.__audioEngine) window.__audioEngine.playChime(660, 0.05);
    });
  }

  // ACC Target Distance +/-
  const btnAccUp = document.getElementById('btn-acc-up');
  const btnAccDn = document.getElementById('btn-acc-down');
  if (btnAccUp) {
    btnAccUp.addEventListener('click', () => {
      state.acc_distance_m = Math.min(100, (state.acc_distance_m || 50) + 5);
      const val = document.getElementById('acc-distance-val');
      if (val) val.textContent = state.acc_distance_m + ' m';
      if (window.__audioEngine) window.__audioEngine.playChime(750, 0.05);
    });
  }
  if (btnAccDn) {
    btnAccDn.addEventListener('click', () => {
      state.acc_distance_m = Math.max(15, (state.acc_distance_m || 50) - 5);
      const val = document.getElementById('acc-distance-val');
      if (val) val.textContent = state.acc_distance_m + ' m';
      if (window.__audioEngine) window.__audioEngine.playChime(550, 0.05);
    });
  }

  // Cockpit Lighting & Hazard Controls
  const btnAuto = document.getElementById('btn-lights-auto');
  const btnHigh = document.getElementById('btn-lights-high');
  const btnHazard = document.getElementById('btn-hazard');
  let hazardActive = false;
  let hazardTimer = null;

  if (btnHazard) {
    btnHazard.addEventListener('click', () => {
      hazardActive = !hazardActive;
      btnHazard.classList.toggle('active', hazardActive);
      if (hazardActive) {
        if (window.__audioEngine) window.__audioEngine.startTurnSignal();
        hazardTimer = setInterval(() => {
          state.lane_dep_L = !state.lane_dep_L;
          state.lane_dep_R = state.lane_dep_L;
        }, 400);
      } else {
        clearInterval(hazardTimer);
        state.lane_dep_L = false;
        state.lane_dep_R = false;
        if (window.__audioEngine) window.__audioEngine.stopTurnSignal();
      }
    });
  }
  if (btnHigh) {
    btnHigh.addEventListener('click', () => {
      btnHigh.classList.toggle('active');
      if (window.__roadVision) {
        window.__roadVision.highBeam = btnHigh.classList.contains('active');
      }
      if (window.__audioEngine) window.__audioEngine.playChime(900, 0.08);
    });
  }
  if (btnAuto) {
    btnAuto.addEventListener('click', () => {
      btnAuto.classList.toggle('active');
      if (window.__audioEngine) window.__audioEngine.playChime(600, 0.08);
    });
  }

  // View Switcher Buttons (DIALS / ADAS / TRACK)
  const mainEl = document.getElementById('main');
  document.querySelectorAll('.cluster-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cluster-view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      if (mainEl) {
        mainEl.classList.remove('view-adas', 'view-track');
        if (view === 'adas') mainEl.classList.add('view-adas');
        else if (view === 'track') mainEl.classList.add('view-track');
      }
      if (window.__audioEngine) window.__audioEngine.playChime(700, 0.08);
      // Trigger canvas resize
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    });
  });

  // Dual Mode Right Gauge Switcher (RPM vs EV Power kW)
  const btnModeRpm = document.getElementById('btn-mode-rpm');
  const btnModePwr = document.getElementById('btn-mode-power');
  if (btnModeRpm && btnModePwr) {
    btnModeRpm.addEventListener('click', () => {
      window.__rightGaugeMode = 'rpm';
      btnModeRpm.classList.add('active');
      btnModePwr.classList.remove('active');
      if (window.__audioEngine) window.__audioEngine.playChime(500, 0.08);
    });
    btnModePwr.addEventListener('click', () => {
      window.__rightGaugeMode = 'power';
      btnModePwr.classList.add('active');
      btnModeRpm.classList.remove('active');
      if (window.__audioEngine) window.__audioEngine.playChime(850, 0.08);
    });
  }

  // CAN Bus Sniffer Modal Wiring
  const canModal = document.getElementById('can-sniffer-modal');
  const canBtn   = document.getElementById('can-sniffer-btn');
  const canClose = document.getElementById('can-sniffer-close');
  const canPause = document.getElementById('can-pause-btn');

  if (canBtn && canModal) {
    canBtn.addEventListener('click', () => {
      canModal.classList.add('active');
      if (window.__audioEngine) window.__audioEngine.playChime(750, 0.1);
    });
  }
  if (canClose && canModal) {
    canClose.addEventListener('click', () => {
      canModal.classList.remove('active');
    });
  }
  if (canPause) {
    canPause.addEventListener('click', () => {
      window.__canSnifferPaused = !window.__canSnifferPaused;
      canPause.textContent = window.__canSnifferPaused ? '▶ RESUME STREAM' : '⏸ PAUSE STREAM';
      window.showToast?.(window.__canSnifferPaused ? '⏸' : '▶', window.__canSnifferPaused ? 'CAN Stream Paused' : 'CAN Stream Resumed');
    });
  }

  // Sidebar Tab Switching
  document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sidebar-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById('tab-' + btn.dataset.tab);
      if (target) target.classList.add('active');
      if (window.__audioEngine) window.__audioEngine.playChime(620, 0.06);
    });
  });

  // Speedometer Tap Toggle (KM/H <-> MPH)
  const spdCanvas = document.getElementById('speedometer-canvas');
  if (spdCanvas) {
    spdCanvas.addEventListener('click', () => {
      window.__speedUnit = window.__speedUnit === 'mph' ? 'kmh' : 'mph';
      if (window.__audioEngine) window.__audioEngine.playChime(780, 0.08);
      window.showToast?.('⚡', `Speedometer Unit: ${window.__speedUnit.toUpperCase()}`);
    });
  }

  // Right Gauge Tap Toggle (RPM <-> EV kW)
  const rpmCanvas = document.getElementById('rpm-canvas');
  if (rpmCanvas) {
    rpmCanvas.addEventListener('click', () => {
      window.__rightGaugeMode = window.__rightGaugeMode === 'power' ? 'rpm' : 'power';
      const btnModeRpm = document.getElementById('btn-mode-rpm');
      const btnModePwr = document.getElementById('btn-mode-power');
      if (btnModeRpm && btnModePwr) {
        btnModeRpm.classList.toggle('active', window.__rightGaugeMode === 'rpm');
        btnModePwr.classList.toggle('active', window.__rightGaugeMode === 'power');
      }
      if (window.__audioEngine) window.__audioEngine.playChime(820, 0.08);
      window.showToast?.('⚡', `Right Dial: ${window.__rightGaugeMode === 'power' ? 'EV Power & Regen (kW)' : 'Tachometer (RPM)'}`);
    });
  }

  // Fault Lab Drawer Toggle
  const appEl = document.getElementById('app');
  const btnToggleLab = document.getElementById('btn-toggle-fault-lab');
  const btnCloseLab  = document.getElementById('btn-close-fault-panel');

  const toggleFaultLab = () => {
    if (!appEl) return;
    const isCollapsed = appEl.classList.toggle('fault-collapsed');
    if (btnToggleLab) btnToggleLab.classList.toggle('active', !isCollapsed);
    if (window.__audioEngine) window.__audioEngine.playChime(isCollapsed ? 480 : 720, 0.08);
    window.showToast?.('⚡', isCollapsed ? 'Cockpit Full-Width Expanded' : 'Safety Fault Lab Opened');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  };

  if (btnToggleLab) btnToggleLab.addEventListener('click', toggleFaultLab);
  if (btnCloseLab)  btnCloseLab.addEventListener('click', toggleFaultLab);

  // Blackbox Flight Recorder Export Toasts
  const btnCsv = document.getElementById('export-csv-btn');
  const btnJson = document.getElementById('export-json-btn');
  if (btnCsv) {
    btnCsv.addEventListener('click', () => {
      window.showToast?.('💾', 'Exporting ASIL-D Blackbox Telemetry (CSV)');
    });
  }
  if (btnJson) {
    btnJson.addEventListener('click', () => {
      window.showToast?.('💾', 'Exporting ASIL-D Blackbox Telemetry (JSON)');
    });
  }

  // URL Query Parameters overrides (for automated screenshots & deep-linking)
  const q = new URLSearchParams(window.location.search);
  if (q.get('mode')) setDriveMode(q.get('mode'));
  if (q.get('tab')) {
    const tBtn = document.querySelector('.sidebar-tab-btn[data-tab="' + q.get('tab') + '"]');
    if (tBtn) tBtn.click();
  }
  if (q.get('modal') === 'can') {
    const cBtn = document.getElementById('can-sniffer-btn');
    if (cBtn) cBtn.click();
  }
  if (q.get('view')) {
    const vBtn = document.querySelector('.cluster-view-btn[data-view="' + q.get('view') + '"]');
    if (vBtn) vBtn.click();
  }
  if (q.get('gauge') === 'power') {
    const pBtn = document.getElementById('btn-mode-power');
    if (pBtn) pBtn.click();
  }
  if (q.get('unit') === 'mph') {
    window.__speedUnit = 'mph';
  }
});

/* ── Global CAN Sniffer Frame Handler ────────────────────────────────────── */
const CAN_NAME_MAP = {
  0x001: { name: 'Brake Pedal & ABS', prio: 'HIGH' },
  0x002: { name: 'Airbag Readiness', prio: 'HIGH' },
  0x003: { name: 'Seatbelt Interlock', prio: 'HIGH' },
  0x004: { name: 'Forward Collision Alert', prio: 'CRITICAL' },
  0x100: { name: 'Wheel Speed Telemetry', prio: 'MED-HIGH' },
  0x101: { name: 'Motor Shaft RPM', prio: 'MED-HIGH' },
  0x102: { name: 'Gear Position', prio: 'MED-HIGH' },
  0x103: { name: 'Throttle Pedal Sensor', prio: 'MED-HIGH' },
  0x104: { name: 'Coolant / Motor Temp', prio: 'MED' },
  0x105: { name: 'Power kW & G-Forces', prio: 'MED-HIGH' },
  0x200: { name: 'Battery State of Charge', prio: 'MED' },
  0x201: { name: 'Battery Pack Voltage', prio: 'MED' },
  0x203: { name: 'Regen Power Recovery', prio: 'MED' },
  0x205: { name: 'TPMS 4-Wheel Pressures', prio: 'MED' },
  0x300: { name: 'Lane Departure Sensing', prio: 'HIGH' },
  0x301: { name: 'Blind Spot Radar', prio: 'HIGH' },
  0x302: { name: 'Adaptive Cruise Control', prio: 'HIGH' },
  0x303: { name: 'Traffic Sign Speed Limit', prio: 'MED' },
  0x305: { name: 'Turn-by-Turn Navigation', prio: 'LOW' },
  0x400: { name: 'Odometer Telemetry', prio: 'LOW' },
  0x401: { name: 'Trip A Distance', prio: 'LOW' }
};

window.__canSnifferPaused = false;
let lastSnifferUpdate = 0;

function updateCanSniffer(frames) {
  if (window.__canSnifferPaused) return;
  const now = performance.now();
  if (now - lastSnifferUpdate < 250) return; // Rate limit DOM updates to 4Hz
  lastSnifferUpdate = now;

  const tbody = document.getElementById('can-sniffer-tbody');
  if (!tbody) return;

  const sample = frames.slice(-8); // Show latest 8 frames
  const timeStr = new Date().toISOString().substring(11, 23);

  sample.forEach(f => {
    const meta = CAN_NAME_MAP[f.id] || { name: 'Unknown Sensor', prio: 'NORMAL' };
    const hexId = '0x' + f.id.toString(16).toUpperCase().padStart(3, '0');
    const hexBytes = (f.data_hex || '00 00').toUpperCase();

    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="color:var(--text-muted);">${timeStr}</td>
      <td><span class="can-id-chip">${hexId}</span></td>
      <td style="color:${meta.prio === 'CRITICAL' ? 'var(--accent-red)' : (meta.prio === 'HIGH' ? 'var(--accent-amber)' : 'var(--text-secondary)')}; font-weight:700;">${meta.prio}</td>
      <td>${f.dlc || 2}</td>
      <td><span class="can-hex-bytes">${hexBytes}</span></td>
      <td style="color:#fff;">${meta.name}</td>
    `;
    tbody.insertBefore(row, tbody.firstChild);
  });

  // Keep max 60 rows
  while (tbody.children.length > 60) {
    tbody.removeChild(tbody.lastChild);
  }
}


