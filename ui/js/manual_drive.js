/**
 * SafeDash — manual_drive.js
 * Interactive Manual Driving Keyboard Controller
 * QNX Global Hackathon  |  Pure Vanilla JS
 *
 * Allows judges and developers to manually "drive" the simulated vehicle:
 *   [W] or [↑]   : Accelerate / Throttle
 *   [S] or [↓]   : Brake / Regenerative Braking
 *   [A] or [←]   : Left Turn Signal
 *   [D] or [→]   : Right Turn Signal
 *   [SPACE]      : Emergency Hard Brake / ABS Test
 *   [M]          : Toggle between Manual Drive and AI Autonomous Cruise
 */

'use strict';

class ManualDriveController {
  constructor() {
    this.isManualMode = false;

    this.keys = {
      throttle: false,
      brake: false,
      eBrake: false,
      leftSignal: false,
      rightSignal: false
    };

    this.manualSpeed = 0;
    this.manualRpm = 800;
    this.manualGear = 'P';
    this.manualThrottle = 0;
    this.manualBrake = 0;

    this.toggleBtn = document.getElementById('manual-drive-toggle-btn');
    this.indicator = document.getElementById('drive-mode-indicator');

    this._bindEvents();
    this._startPhysicsLoop();
  }

  _bindEvents() {
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => {
        this.toggleMode();
      });
    }

    const exitHudBtn = document.getElementById('manual-hud-exit-btn');
    if (exitHudBtn) {
      exitHudBtn.addEventListener('click', () => {
        if (this.isManualMode) this.toggleMode();
      });
    }

    window.addEventListener('keydown', (e) => {
      // Toggle mode with 'm'
      if (e.key === 'm' || e.key === 'M') {
        if (!e.target.matches('input, textarea')) {
          this.toggleMode();
          return;
        }
      }

      if (!this.isManualMode) return;

      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        this.keys.throttle = true;
        e.preventDefault();
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
        this.keys.brake = true;
        e.preventDefault();
      } else if (e.key === ' ') {
        this.keys.eBrake = true;
        e.preventDefault();
      } else if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        this._toggleTurnSignal('L');
        e.preventDefault();
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        this._toggleTurnSignal('R');
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (!this.isManualMode) return;

      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        this.keys.throttle = false;
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
        this.keys.brake = false;
      } else if (e.key === ' ') {
        this.keys.eBrake = false;
      }
    });
  }

  toggleMode() {
    this.isManualMode = !this.isManualMode;

    if (this.toggleBtn) {
      this.toggleBtn.classList.toggle('active', this.isManualMode);
      this.toggleBtn.textContent = this.isManualMode ? '🎮 MANUAL DRIVE [ON]' : '🎮 MANUAL DRIVE';
    }

    const hud = document.getElementById('manual-drive-hud');
    if (hud) hud.classList.toggle('active', this.isManualMode);

    if (window.showToast) {
      window.showToast(this.isManualMode ? '🎮' : '🚗', this.isManualMode ? 'Manual Keyboard Drive Engaged' : 'Autonomous AI Cruise Restored');
    }

    if (this.indicator) {
      this.indicator.textContent = this.isManualMode ? 'MANUAL CONTROL (W/S/A/D)' : 'AUTONOMOUS / QNX CRUISE';
      this.indicator.style.color = this.isManualMode ? 'var(--accent-amber)' : 'var(--accent-cyan)';
    }

    if (window.__audioEngine) {
      window.__audioEngine.playChime(this.isManualMode ? 880 : 440, 0.15);
    }

    // Initialize manual vehicle values from current telemetry state
    if (this.isManualMode && window.__clusterState) {
      this.manualSpeed = window.__clusterState.speed_kmh || 0;
      this.manualRpm = window.__clusterState.rpm || 800;
    }
  }

  _toggleTurnSignal(dir) {
    if (!window.__clusterState) return;
    if (dir === 'L') {
      window.__clusterState.lane_dep_L = !window.__clusterState.lane_dep_L;
      window.__clusterState.lane_dep_R = false;
      if (window.__audioEngine) {
        if (window.__clusterState.lane_dep_L) window.__audioEngine.startTurnSignal();
        else window.__audioEngine.stopTurnSignal();
      }
    } else {
      window.__clusterState.lane_dep_R = !window.__clusterState.lane_dep_R;
      window.__clusterState.lane_dep_L = false;
      if (window.__audioEngine) {
        if (window.__clusterState.lane_dep_R) window.__audioEngine.startTurnSignal();
        else window.__audioEngine.stopTurnSignal();
      }
    }
  }

  _startPhysicsLoop() {
    setInterval(() => {
      if (!this.isManualMode || !window.__clusterState) return;

      const state = window.__clusterState;

      // Throttle physics
      if (this.keys.throttle) {
        this.manualThrottle = Math.min(100, this.manualThrottle + 8);
        this.manualBrake = Math.max(0, this.manualBrake - 12);
        this.manualSpeed = Math.min(240, this.manualSpeed + 1.2 * (this.manualThrottle / 100));
      } else {
        this.manualThrottle = Math.max(0, this.manualThrottle - 10);
      }

      // Brake / E-brake physics
      if (this.keys.eBrake) {
        this.manualBrake = 100;
        this.manualThrottle = 0;
        this.manualSpeed = Math.max(0, this.manualSpeed - 4.5);
        state.abs_active = this.manualSpeed > 40;
      } else if (this.keys.brake) {
        this.manualBrake = Math.min(100, this.manualBrake + 10);
        this.manualThrottle = 0;
        this.manualSpeed = Math.max(0, this.manualSpeed - 2.2 * (this.manualBrake / 100));
        state.abs_active = this.manualSpeed > 70 && this.manualBrake > 85;
      } else {
        this.manualBrake = Math.max(0, this.manualBrake - 8);
        state.abs_active = false;
        // Natural air resistance coasting
        if (!this.keys.throttle && this.manualSpeed > 0) {
          this.manualSpeed = Math.max(0, this.manualSpeed - 0.25);
        }
      }

      // Compute gear automatically
      if (this.manualSpeed < 1) this.manualGear = 'P';
      else if (this.manualSpeed < 20) this.manualGear = 1;
      else if (this.manualSpeed < 40) this.manualGear = 2;
      else if (this.manualSpeed < 65) this.manualGear = 3;
      else if (this.manualSpeed < 90) this.manualGear = 4;
      else if (this.manualSpeed < 120) this.manualGear = 5;
      else if (this.manualSpeed < 155) this.manualGear = 6;
      else if (this.manualSpeed < 195) this.manualGear = 7;
      else this.manualGear = 8;

      // Compute RPM from speed and gear
      if (this.manualGear === 'P') {
        this.manualRpm = 800 + (this.manualThrottle * 25);
      } else {
        const ratios = [0, 3.6, 2.1, 1.4, 1.0, 0.76, 0.60, 0.50, 0.42];
        const r = ratios[typeof this.manualGear === 'number' ? this.manualGear : 4];
        this.manualRpm = Math.max(800, Math.min(8000, Math.round(this.manualSpeed * r * 33 + this.manualThrottle * 12)));
      }

      // Update state
      state.speed_kmh = this.manualSpeed;
      state.rpm = this.manualRpm;
      state.gear = this.manualGear;
      state.throttle_pct = this.manualThrottle;
      state.brake_pct = this.manualBrake;
      state.regen_kw = this.manualBrake > 5 ? this.manualBrake * 0.35 : 0;
      state.soc_pct = Math.max(5, state.soc_pct - (this.manualThrottle * 0.0001));

      // Audio engine update
      if (window.__audioEngine) {
        window.__audioEngine.updateMotorSound(state.speed_kmh, state.rpm, state.throttle_pct);
      }
    }, 50);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.__manualDrive = new ManualDriveController();
});
