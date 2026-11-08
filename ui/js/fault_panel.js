/**
 * SafeDash — fault_panel.js
 * Fault Injection Control & Logging Module
 * QNX Global Hackathon  |  Pure Vanilla JS
 */

'use strict';

class FaultPanel {
  constructor(options = {}) {
    this.apiEndpoint = options.apiEndpoint || '/fault';
    this.activeFaults = new Set();
    this.faultTimers = new Map();
    this.logEntries = [];
    this.maxLogs = 10;

    this.logContainer = document.getElementById('fault-log-entries');

    this._bindButtons();
    this._startTimerLoop();
  }

  _bindButtons() {
    const buttons = [
      { id: 'btn-fault-cpu',     fault: 'cpu_stress',         label: 'CPU Stress' },
      { id: 'btn-fault-crash',   fault: 'infotainment_crash',  label: 'Infotainment Crash' },
      { id: 'btn-fault-dropout', fault: 'sensor_dropout',      label: 'Sensor Dropout' },
      { id: 'btn-fault-memory',  fault: 'memory_pressure',     label: 'Memory Pressure' },
      { id: 'btn-fault-adas',    fault: 'adas_alert',          label: 'ADAS Collision Alert' },
      { id: 'btn-fault-clear',   fault: 'clear',               label: 'Clear All Faults' },
    ];

    buttons.forEach(({ id, fault, label }) => {
      const btn = document.getElementById(id);
      if (!btn) return;

      btn.addEventListener('click', () => {
        this.triggerFault(fault, label, btn);
      });
    });
  }

  async triggerFault(fault, label, btnElement) {
    try {
      const resp = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fault, param: 0 })
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const res = await resp.json();
      console.log(`[FaultPanel] Injected '${fault}':`, res);

      if (fault === 'clear') {
        this.clearAllFaults();
        this.addLog('SYSTEM', 'All fault injections cleared');
        if (window.__dtcManager) window.__dtcManager.clearAll();
        if (window.__audioEngine) window.__audioEngine.stopCollisionAlarm();
      } else {
        this.setActive(fault, label, btnElement);
        this.addLog('FAULT', `${label} active`);
        if (window.__dtcManager && window.__clusterState) {
          window.__dtcManager.recordFault(fault, window.__clusterState);
        }
        if (fault === 'adas_alert' && window.__audioEngine) {
          window.__audioEngine.startCollisionAlarm();
        } else if (window.__audioEngine) {
          window.__audioEngine.playChime(350, 0.25);
        }
      }
    } catch (err) {
      console.warn(`[FaultPanel] Error injecting '${fault}':`, err.message);
      // Fallback for visual demo even if backend HTTP bridge is starting
      if (fault === 'clear') {
        this.clearAllFaults();
        this.addLog('SYSTEM', 'Faults cleared (offline mode)');
        if (window.__dtcManager) window.__dtcManager.clearAll();
        if (window.__audioEngine) window.__audioEngine.stopCollisionAlarm();
      } else {
        this.setActive(fault, label, btnElement);
        this.addLog('OFFLINE', `${label} simulated`);
        if (window.__dtcManager && window.__clusterState) {
          window.__dtcManager.recordFault(fault, window.__clusterState);
        }
        if (fault === 'adas_alert' && window.__audioEngine) {
          window.__audioEngine.startCollisionAlarm();
        }
      }
    }
  }

  setActive(fault, label, btn) {
    this.activeFaults.add(fault);
    this.faultTimers.set(fault, Date.now());

    if (btn) {
      btn.classList.add('active-fault');
      const stateEl = btn.querySelector('.fault-btn-state');
      if (stateEl) stateEl.textContent = 'ACTIVE';
    }
  }

  clearAllFaults() {
    this.activeFaults.clear();
    this.faultTimers.clear();

    document.querySelectorAll('.fault-btn').forEach(btn => {
      btn.classList.remove('active-fault');
      const stateEl = btn.querySelector('.fault-btn-state');
      if (stateEl && btn.id !== 'btn-fault-clear') {
        stateEl.textContent = 'READY';
      }
      const countEl = btn.querySelector('.fault-countdown');
      if (countEl) countEl.textContent = '';
    });
  }

  _startTimerLoop() {
    setInterval(() => {
      const now = Date.now();
      this.faultTimers.forEach((startTime, fault) => {
        const elapsedSec = Math.floor((now - startTime) / 1000);
        let btnId = '';
        if (fault === 'cpu_stress') btnId = 'btn-fault-cpu';
        else if (fault === 'infotainment_crash') btnId = 'btn-fault-crash';
        else if (fault === 'sensor_dropout') btnId = 'btn-fault-dropout';
        else if (fault === 'memory_pressure') btnId = 'btn-fault-memory';
        else if (fault === 'adas_alert') btnId = 'btn-fault-adas';

        if (btnId) {
          const btn = document.getElementById(btnId);
          if (btn) {
            const countEl = btn.querySelector('.fault-countdown');
            if (countEl) countEl.textContent = `+${elapsedSec}s`;
          }
        }
      });
    }, 500);
  }

  addLog(tag, message) {
    const timeStr = new Date().toTimeString().split(' ')[0];
    this.logEntries.unshift({ time: timeStr, tag, message });
    if (this.logEntries.length > this.maxLogs) {
      this.logEntries.pop();
    }
    this._renderLogs();
  }

  _renderLogs() {
    if (!this.logContainer) return;
    this.logContainer.innerHTML = this.logEntries.map(e => `
      <div class="fault-log-entry">
        <span class="fault-log-time">[${e.time}]</span>
        <span class="fault-log-event"><strong>${e.tag}:</strong> ${e.message}</span>
      </div>
    `).join('');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.__faultPanel = new FaultPanel({
    apiEndpoint: window.location.port === '9201' ? '/fault' : 'http://localhost:9201/fault'
  });
});
