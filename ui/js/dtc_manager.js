/**
 * SafeDash — dtc_manager.js
 * Automotive OBD-II / UDS Diagnostic Trouble Code (DTC) Manager
 * QNX Global Hackathon  |  Pure Vanilla JS
 *
 * Implements standard SAE J2012 / ISO 14229 diagnostic services:
 *   - Service $03: Read Stored Diagnostic Trouble Codes (DTCs)
 *   - Service $04: Clear / Reset Emission-Related Diagnostic Info
 *   - Service $02: Read Freeze Frame Data (RPM, Speed, Temp, Battery at fault occurrence)
 */

'use strict';

const DTC_DATABASE = {
  'cpu_stress': {
    code: 'U0100',
    system: 'Network / IPC',
    desc: 'Lost Communication With Engine Control Module (ECM) — High Scheduling Latency',
    severity: 'MEDIUM',
    status: 'ACTIVE / CONFIRMED'
  },
  'infotainment_crash': {
    code: 'U0155',
    system: 'Instrument Panel Cluster',
    desc: 'Lost Communication With Instrument Panel Cluster (IPC) Control Module — Heartbeat Missed',
    severity: 'HIGH',
    status: 'PENDING / RECOVERING'
  },
  'sensor_dropout': {
    code: 'C0035',
    system: 'Chassis / ABS',
    desc: 'Left Front Wheel Speed Sensor Supply Voltage / Signal Missing',
    severity: 'HIGH',
    status: 'ACTIVE / CONFIRMED'
  },
  'memory_pressure': {
    code: 'P0606',
    system: 'Powertrain ECM',
    desc: 'Control Module Processor / Memory Exhaustion Threshold Exceeded',
    severity: 'MEDIUM',
    status: 'CONFIRMED'
  },
  'adas_alert': {
    code: 'B0001',
    system: 'Body / Restraints',
    desc: 'Forward Radar Proximity Threshold Breach — Immediate Collision Mitigation Triggered',
    severity: 'CRITICAL',
    status: 'ACTIVE'
  }
};

class DTCManager {
  constructor() {
    this.activeDTCs = new Map();
    this.freezeFrames = new Map();

    this.container = document.getElementById('dtc-list-container');
    this.badgeEl = document.getElementById('dtc-count-badge');
    this.clearBtn = document.getElementById('dtc-clear-btn');

    this._bindControls();
  }

  _bindControls() {
    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => {
        this.clearAll();
      });
    }

    const modalClose = document.getElementById('dtc-modal-close');
    const modal = document.getElementById('dtc-modal');
    if (modalClose && modal) {
      modalClose.addEventListener('click', () => {
        modal.classList.remove('active');
      });
    }
  }

  /**
   * Log a new DTC when a fault is activated
   * @param {string} faultType 
   * @param {Object} currentSnapshot 
   */
  recordFault(faultType, currentSnapshot = {}) {
    const info = DTC_DATABASE[faultType];
    if (!info) return;

    const timestamp = new Date().toTimeString().split(' ')[0];
    this.activeDTCs.set(info.code, {
      ...info,
      timestamp,
      count: (this.activeDTCs.get(info.code)?.count || 0) + 1
    });

    // Capture Freeze Frame snapshot
    this.freezeFrames.set(info.code, {
      speed: currentSnapshot.speed_kmh || 0,
      rpm: currentSnapshot.rpm || 0,
      gear: currentSnapshot.gear || 'N',
      soc: currentSnapshot.soc_pct || 85,
      temp: currentSnapshot.engine_temp_c || 80,
      timestamp
    });

    this.render();
  }

  clearAll() {
    this.activeDTCs.clear();
    this.freezeFrames.clear();
    this.render();

    // If audio engine exists, play double acknowledgment chime
    if (window.__audioEngine) {
      window.__audioEngine.playChime(800, 0.08);
      setTimeout(() => window.__audioEngine.playChime(1000, 0.12), 100);
    }
  }

  render() {
    if (this.badgeEl) {
      const count = this.activeDTCs.size;
      this.badgeEl.textContent = `${count} DTC`;
      this.badgeEl.className = count > 0 ? 'badge-alert' : 'badge-normal';
    }

    if (!this.container) return;

    if (this.activeDTCs.size === 0) {
      this.container.innerHTML = `
        <div style="padding:0.8rem; text-align:center; color:var(--text-muted); font-size:0.75rem;">
          ✓ NO DIAGNOSTIC TROUBLE CODES STORED (SAE J2012 COMPLIANT)
        </div>
      `;
      return;
    }

    let html = '';
    this.activeDTCs.forEach((dtc, code) => {
      const severityClass = dtc.severity === 'CRITICAL' ? 'dtc-crit' : (dtc.severity === 'HIGH' ? 'dtc-high' : 'dtc-med');
      html += `
        <div class="dtc-item ${severityClass}" onclick="window.__dtcManager.showFreezeFrame('${code}')">
          <div class="dtc-header">
            <span class="dtc-code font-mono">${code}</span>
            <span class="dtc-sev">${dtc.severity}</span>
            <span class="dtc-time font-mono">${dtc.timestamp}</span>
          </div>
          <div class="dtc-desc">${dtc.desc}</div>
          <div class="dtc-sub">System: ${dtc.system} | Status: ${dtc.status} (Click for Freeze Frame)</div>
        </div>
      `;
    });

    this.container.innerHTML = html;
  }

  showFreezeFrame(code) {
    const ff = this.freezeFrames.get(code);
    const dtc = this.activeDTCs.get(code);
    if (!ff || !dtc) return;

    const modal = document.getElementById('dtc-modal');
    const content = document.getElementById('dtc-modal-content');
    if (!modal || !content) return;

    content.innerHTML = `
      <div style="font-size:1.1rem; font-weight:700; color:var(--accent-red); margin-bottom:0.5rem;">
        OBD-II FREEZE FRAME — CODE ${code}
      </div>
      <div style="color:var(--text-secondary); margin-bottom:1rem; font-size:0.85rem;">
        ${dtc.desc}
      </div>
      <table style="width:100%; border-collapse:collapse; font-family:var(--font-mono); font-size:0.8rem;">
        <tr><td style="padding:4px; color:var(--text-muted);">PID $0C (Engine RPM):</td><td style="color:var(--accent-cyan);">${Math.round(ff.rpm)} RPM</td></tr>
        <tr><td style="padding:4px; color:var(--text-muted);">PID $0D (Vehicle Speed):</td><td style="color:var(--accent-cyan);">${ff.speed.toFixed(1)} km/h</td></tr>
        <tr><td style="padding:4px; color:var(--text-muted);">PID $A4 (Selected Gear):</td><td style="color:var(--accent-cyan);">${ff.gear}</td></tr>
        <tr><td style="padding:4px; color:var(--text-muted);">PID $5B (Hybrid/EV Battery SOC):</td><td style="color:var(--accent-green);">${ff.soc.toFixed(1)}%</td></tr>
        <tr><td style="padding:4px; color:var(--text-muted);">PID $05 (Coolant Temperature):</td><td style="color:var(--accent-amber);">${Math.round(ff.temp)} °C</td></tr>
        <tr><td style="padding:4px; color:var(--text-muted);">Timestamp:</td><td style="color:var(--text-primary);">${ff.timestamp}</td></tr>
      </table>
    `;

    modal.classList.add('active');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.__dtcManager = new DTCManager();
});
