/**
 * SafeDash — health_monitor.js
 * System Health Display Module
 * QNX Global Hackathon  |  Pure Vanilla JS
 *
 * Receives system_status messages (via WebSocket or via
 * window.__healthMonitor.update() called from cluster.js)
 * and renders a colour-coded thread table in the bottom panel.
 */

'use strict';

class HealthMonitor {
  /**
   * @param {string} tableBodyId  — id of the <tbody> to populate
   * @param {string} frameValId   — id of frame count element
   * @param {string} errValId     — id of error count element
   * @param {string} rateValId    — id of fps/rate element
   */
  constructor (tableBodyId, frameValId, errValId, rateValId) {
    this._tbody    = document.getElementById(tableBodyId);
    this._frameEl  = document.getElementById(frameValId);
    this._errEl    = document.getElementById(errValId);
    this._rateEl   = document.getElementById(rateValId);

    /** @type {Map<string, ThreadEntry>} */
    this._threads = new Map();

    this._lastFrameCount = 0;
    this._lastFrameTime  = performance.now();
    this._frameRate      = 0;

    this._totalFrames = 0;
    this._totalErrors = 0;

    // Stale-thread sweep every 500 ms
    setInterval(() => this._sweep(), 500);
    // DOM refresh every 250 ms
    setInterval(() => this._renderTable(), 250);

    // Seed with known QNX threads so the table isn't empty on start
    this._seedKnownThreads();
  }

  /* ── Public API ─────────────────────────────────────────── */

  /**
   * Ingest a system_status message.
   * Accepts both a single-thread object and an array.
   *
   * Single-thread shape:
   *   { thread_name, priority, latency_us, frame_count, error_count }
   *
   * Array shape (from full bridge):
   *   { threads: [ { name, priority, latency_us, state }, … ],
   *     frame_count, error_count }
   */
  update (data) {
    const now = Date.now();

    // Array format
    if (Array.isArray(data.threads)) {
      data.threads.forEach(t => {
        this._upsertThread(t.name || t.thread_name || 'unknown', {
          priority:   t.priority ?? 0,
          latency_us: t.latency_us ?? 0,
          state:      t.state ?? 'RUNNING',
          last_seen:  now,
        });
      });
    } else {
      // Single-thread format
      const name = data.thread_name || data.name || 'cluster';
      this._upsertThread(name, {
        priority:   data.priority   ?? 0,
        latency_us: data.latency_us ?? 0,
        state:      data.state      ?? 'RUNNING',
        last_seen:  now,
      });
    }

    // Update global counters
    if (data.frame_count !== undefined) {
      const fc = Number(data.frame_count);
      if (fc > this._lastFrameCount) {
        const elapsed = (performance.now() - this._lastFrameTime) / 1000;
        if (elapsed > 0) {
          this._frameRate = Math.round((fc - this._lastFrameCount) / elapsed);
        }
        this._lastFrameCount = fc;
        this._lastFrameTime  = performance.now();
        this._totalFrames    = fc;
      }
    }
    if (data.error_count !== undefined) {
      this._totalErrors = Number(data.error_count);
    }
  }

  /* ── Private ─────────────────────────────────────────────── */

  _upsertThread (name, entry) {
    this._threads.set(name, { name, ...entry });
  }

  /**
   * Mark threads unseen for > 2 s as stale (don't delete — keep visible in red)
   */
  _sweep () {
    const cutoff = Date.now() - 2000;
    this._threads.forEach((t, k) => {
      if (t.last_seen < cutoff) {
        t.stale = true;
      } else {
        t.stale = false;
      }
    });
  }

  _latencyClass (latency_us, stale) {
    if (stale)             return 'red';
    if (latency_us > 5000) return 'red';
    if (latency_us > 1000) return 'amber';
    return 'green';
  }

  _renderTable () {
    if (!this._tbody) return;

    const rows = [];
    this._threads.forEach(t => {
      const cls  = this._latencyClass(t.latency_us, t.stale);
      const dot  = `<span class="ht-status-dot ${cls}"></span>`;
      const latFmt = t.stale ? 'STALE'
                   : t.latency_us >= 1000
                     ? (t.latency_us / 1000).toFixed(2) + ' ms'
                     : t.latency_us + ' µs';

      rows.push(`
        <tr>
          <td>${dot}<span class="ht-${cls}">${this._esc(t.name)}</span></td>
          <td class="ht-${cls}">${t.priority}</td>
          <td class="ht-${cls}">${latFmt}</td>
          <td class="ht-${cls}">${t.state || (t.stale ? 'STALE' : 'RUNNING')}</td>
        </tr>`);
    });

    this._tbody.innerHTML = rows.join('');

    if (this._frameEl) this._frameEl.textContent = this._totalFrames.toLocaleString();
    if (this._errEl)   this._errEl.textContent   = this._totalErrors;
    if (this._rateEl)  this._rateEl.textContent  = this._frameRate + ' fps';
  }

  _seedKnownThreads () {
    const now = Date.now();
    const seed = [
      { name: 'SafeDash/renderer',   priority: 10, latency_us: 0,    state: 'WAIT' },
      { name: 'SafeDash/ws-bridge',  priority: 15, latency_us: 0,    state: 'WAIT' },
      { name: 'SafeDash/adas-proc',  priority: 20, latency_us: 0,    state: 'WAIT' },
      { name: 'SafeDash/fault-mgr',  priority: 12, latency_us: 0,    state: 'WAIT' },
    ];
    seed.forEach(t => this._upsertThread(t.name, { ...t, last_seen: now - 3000, stale: true }));
  }

  _esc (s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

/* ── Bootstrap ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const monitor = new HealthMonitor(
    'health-thread-tbody',
    'hp-frame-val',
    'hp-err-val',
    'hp-rate-val'
  );
  window.__healthMonitor = monitor;
});
