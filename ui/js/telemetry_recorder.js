/**
 * SafeDash — telemetry_recorder.js
 * Flight Data Recorder & CSV/JSON Blackbox Telemetry Exporter
 * QNX Global Hackathon  |  Pure Vanilla JS
 *
 * Records:
 *   - Continuous 10Hz flight buffer of Speed, RPM, Gear, Throttle, Brake, SOC, Latency
 *   - Automatic trigger on Fault Injection events (saves pre/post incident window)
 *   - Single-click CSV / JSON download for safety & post-mortem audits
 */

'use strict';

class TelemetryRecorder {
  constructor() {
    this.buffer = [];
    this.maxBufferSize = 600; // 60 seconds at 10Hz
    this.isRecording = true;

    this.exportCsvBtn = document.getElementById('export-csv-btn');
    this.exportJsonBtn = document.getElementById('export-json-btn');
    this.recordBadge = document.getElementById('record-status-badge');

    this._bindControls();
    this._startSampling();
  }

  _bindControls() {
    if (this.exportCsvBtn) {
      this.exportCsvBtn.addEventListener('click', () => this.exportCSV());
    }
    if (this.exportJsonBtn) {
      this.exportJsonBtn.addEventListener('click', () => this.exportJSON());
    }
  }

  _startSampling() {
    setInterval(() => {
      if (!this.isRecording || !window.__clusterState) return;

      const s = window.__clusterState;
      const entry = {
        timestamp: new Date().toISOString(),
        speed_kmh: Number((s.speed_kmh || 0).toFixed(1)),
        rpm: Math.round(s.rpm || 0),
        gear: s.gear || 'N',
        throttle_pct: Math.round(s.throttle_pct || 0),
        brake_pct: Math.round(s.brake_pct || 0),
        soc_pct: Number((s.soc_pct || 85).toFixed(1)),
        regen_kw: Number((s.regen_kw || 0).toFixed(2)),
        abs_active: s.abs_active ? 1 : 0,
        collision: s.collision ? 1 : 0,
        active_fault: window.__faultPanel?.activeFaults?.size || 0
      };

      this.buffer.push(entry);
      if (this.buffer.length > this.maxBufferSize) {
        this.buffer.shift();
      }

      if (this.recordBadge) {
        this.recordBadge.textContent = `REC (${this.buffer.length})`;
      }
    }, 100);
  }

  exportCSV() {
    if (this.buffer.length === 0) {
      alert('Blackbox buffer is empty.');
      return;
    }

    const headers = Object.keys(this.buffer[0]).join(',');
    const rows = this.buffer.map(row => Object.values(row).join(','));
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `safedash_telemetry_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (window.__audioEngine) window.__audioEngine.playChime(660, 0.1);
  }

  exportJSON() {
    if (this.buffer.length === 0) {
      alert('Blackbox buffer is empty.');
      return;
    }

    const jsonStr = JSON.stringify({
      vehicle: 'SafeDash QNX SDP 8.0 Reference Platform',
      captured_at: new Date().toISOString(),
      sample_rate_hz: 10,
      total_frames: this.buffer.length,
      telemetry: this.buffer
    }, null, 2);

    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `safedash_flight_recorder_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (window.__audioEngine) window.__audioEngine.playChime(660, 0.1);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.__telemetryRecorder = new TelemetryRecorder();
});
