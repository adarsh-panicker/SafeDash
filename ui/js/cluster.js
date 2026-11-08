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

  /* Stats */
  frame_count: 0,
  error_count: 0,
};

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
    this.spdCanvas  = document.getElementById('speedometer-canvas');
    this.rpmCanvas  = document.getElementById('rpm-canvas');
    this.tempCanvas = document.getElementById('temp-canvas');
    this.spdCtx     = this.spdCanvas.getContext('2d');
    this.rpmCtx     = this.rpmCanvas.getContext('2d');
    this.tempCtx    = this.tempCanvas.getContext('2d');

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
    // Speedometer — large
    const spdSize = Math.min(window.innerWidth * 0.26, window.innerHeight * 0.46, 320);
    this._setCanvas(this.spdCanvas, spdSize, spdSize);
    // RPM — slightly smaller
    const rpmSize = Math.min(window.innerWidth * 0.20, window.innerHeight * 0.38, 240);
    this._setCanvas(this.rpmCanvas, rpmSize, rpmSize);
    // Temp — small
    const tempSize = 110;
    this._setCanvas(this.tempCanvas, tempSize, tempSize);
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
     'engine_temp_c','acc_distance_m','voltage_v','batt_temp_c'].forEach(lerpc);
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
    this.drawRPMGauge(this.rpmCtx, disp.rpm, 8000, W_rpm, H_rpm);
    this.drawTempGauge(this.tempCtx, disp.engine_temp_c, 40, 130, W_tmp, H_tmp);

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

  /* ── Speedometer ──────────────────────────────────────────── */
  drawSpeedometer (ctx, speed, maxSpeed, W, H) {
    const cx = W / 2, cy = H / 2 + H * 0.04;
    const R  = Math.min(W, H) * 0.44;
    const startAngle = toRad(145);
    const endAngle   = toRad(395);  // 250° sweep
    const arcRange   = endAngle - startAngle;

    /* Track arc */
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = C.track;
    ctx.lineWidth   = 14;
    ctx.lineCap     = 'round';
    ctx.stroke();

    /* Value arc — gradient green → cyan */
    const speedFrac = clamp(speed / maxSpeed, 0, 1);
    const fillEnd   = startAngle + arcRange * speedFrac;

    if (speedFrac > 0) {
      const grad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
      grad.addColorStop(0,   C.green);
      grad.addColorStop(0.5, C.cyan);
      grad.addColorStop(1,   speed > 180 ? C.red : C.cyan);
      ctx.beginPath();
      ctx.arc(cx, cy, R, startAngle, fillEnd);
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 14;
      ctx.lineCap     = 'round';
      ctx.stroke();
    }

    /* Glow on arc */
    if (speedFrac > 0) {
      ctx.save();
      ctx.shadowColor = speed > 180 ? C.red : C.cyan;
      ctx.shadowBlur  = 18;
      ctx.beginPath();
      ctx.arc(cx, cy, R, startAngle, fillEnd);
      ctx.strokeStyle = 'transparent';
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.restore();
    }

    /* Tick marks */
    const tickStep = 20;
    for (let v = 0; v <= maxSpeed; v += tickStep) {
      const frac  = v / maxSpeed;
      const angle = startAngle + arcRange * frac;
      const isMajor = (v % 60 === 0);
      const inner = R - (isMajor ? 22 : 14);
      const outer = R - 4;

      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.strokeStyle = isMajor ? C.white : C.textMuted;
      ctx.lineWidth   = isMajor ? 2 : 1;
      ctx.stroke();

      if (isMajor && v <= maxSpeed) {
        const lR = R - 36;
        ctx.font = `600 ${Math.round(W * 0.055)}px 'Courier New', monospace`;
        ctx.fillStyle   = C.textMuted;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), cx + Math.cos(angle) * lR, cy + Math.sin(angle) * lR);
      }
    }

    /* Needle */
    const needleAngle = startAngle + arcRange * speedFrac;
    const nLen = R - 20;
    const nW   = 3;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAngle);
    const needleGrad = ctx.createLinearGradient(0, 0, nLen, 0);
    needleGrad.addColorStop(0,   'rgba(255,255,255,0.1)');
    needleGrad.addColorStop(0.8, C.white);
    needleGrad.addColorStop(1,   speed > 180 ? C.red : C.cyan);
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(nLen, 0);
    ctx.strokeStyle = needleGrad;
    ctx.lineWidth   = nW;
    ctx.lineCap     = 'round';
    ctx.shadowColor = C.cyan;
    ctx.shadowBlur  = 12;
    ctx.stroke();
    ctx.restore();

    /* Needle pivot */
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fillStyle = C.white;
    ctx.shadowColor = C.cyan;
    ctx.shadowBlur  = 15;
    ctx.fill();
    ctx.shadowBlur = 0;

    /* Digital readout */
    const speedInt = Math.round(clamp(speed, 0, 999));
    ctx.font = `900 ${Math.round(W * 0.20)}px 'Courier New', monospace`;
    ctx.fillStyle = speed > 180 ? C.red : C.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (speed > 180) {
      ctx.shadowColor = C.red; ctx.shadowBlur = 20;
    }
    ctx.fillText(String(speedInt).padStart(3, ' '), cx, cy - R * 0.25);
    ctx.shadowBlur = 0;

    ctx.font = `500 ${Math.round(W * 0.07)}px sans-serif`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText('km/h', cx, cy - R * 0.25 + W * 0.13);
  }

  /* ── RPM Gauge ────────────────────────────────────────────── */
  drawRPMGauge (ctx, rpm, maxRPM, W, H) {
    const cx = W / 2, cy = H / 2 + H * 0.04;
    const R  = Math.min(W, H) * 0.42;
    const startAngle = toRad(150);
    const endAngle   = toRad(390);
    const arcRange   = endAngle - startAngle;
    const redlineFrac = 6500 / maxRPM;

    /* Track */
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = C.track;
    ctx.lineWidth   = 12;
    ctx.lineCap     = 'round';
    ctx.stroke();

    /* Redline zone */
    const redStart = startAngle + arcRange * redlineFrac;
    ctx.beginPath();
    ctx.arc(cx, cy, R, redStart, endAngle);
    ctx.strokeStyle = 'rgba(255,34,68,0.35)';
    ctx.lineWidth   = 12;
    ctx.stroke();

    /* Value arc */
    const rpmFrac = clamp(rpm / maxRPM, 0, 1);
    const fillEnd = startAngle + arcRange * rpmFrac;
    if (rpmFrac > 0) {
      const isRed = rpm >= 6500;
      ctx.beginPath();
      ctx.arc(cx, cy, R, startAngle, fillEnd);
      ctx.strokeStyle = isRed ? C.red : C.amber;
      ctx.lineWidth   = 12;
      ctx.lineCap     = 'round';
      ctx.shadowColor = isRed ? C.red : C.amber;
      ctx.shadowBlur  = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    /* Ticks */
    for (let v = 0; v <= maxRPM; v += 500) {
      const frac  = v / maxRPM;
      const angle = startAngle + arcRange * frac;
      const isMajor = (v % 1000 === 0);
      const inner = R - (isMajor ? 18 : 11);
      const outer = R - 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.strokeStyle = v >= 6500 ? C.red : (isMajor ? C.white : C.textMuted);
      ctx.lineWidth   = isMajor ? 1.5 : 0.8;
      ctx.stroke();

      if (isMajor) {
        const lR = R - 30;
        ctx.font = `600 ${Math.round(W * 0.07)}px 'Courier New', monospace`;
        ctx.fillStyle   = v >= 6500 ? C.red : C.textMuted;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v / 1000), cx + Math.cos(angle) * lR, cy + Math.sin(angle) * lR);
      }
    }

    /* Needle */
    const needleAngle = startAngle + arcRange * rpmFrac;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAngle);
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(R - 16, 0);
    ctx.strokeStyle = rpm >= 6500 ? C.red : C.amber;
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.shadowColor = rpm >= 6500 ? C.red : C.amber;
    ctx.shadowBlur  = 10;
    ctx.stroke();
    ctx.restore();

    /* Pivot */
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = C.white;
    ctx.fill();

    /* Digital readout */
    const rpmK = (rpm / 1000).toFixed(1);
    ctx.font = `700 ${Math.round(W * 0.17)}px 'Courier New', monospace`;
    ctx.fillStyle = rpm >= 6500 ? C.red : C.amber;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = rpm >= 6500 ? C.red : C.amber;
    ctx.shadowBlur   = 12;
    ctx.fillText(rpmK, cx, cy - R * 0.26);
    ctx.shadowBlur = 0;

    ctx.font = `500 ${Math.round(W * 0.08)}px sans-serif`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText('×1000 rpm', cx, cy - R * 0.26 + W * 0.12);
  }

  /* ── Gear Indicator ───────────────────────────────────────── */
  drawGearIndicator (gear) {
    const el = document.getElementById('gear-indicator');
    if (!el) return;
    const display = (gear === 0 || gear === 'N') ? 'N'
                  : (gear === 'R')               ? 'R'
                  : (gear === 'P')               ? 'P'
                  : String(gear);
    el.textContent = display;
    el.style.color = gear === 'R' ? C.red
                   : gear === 'N' ? C.amber
                   : gear === 'P' ? C.textMuted
                   : C.cyan;
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
});
