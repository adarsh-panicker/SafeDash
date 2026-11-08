/**
 * SafeDash — audio_engine.js
 * Web Audio API Automotive Sound Synthesizer
 * QNX Global Hackathon  |  Pure Vanilla JS (Zero Audio Files Needed)
 *
 * Synthesizes in real time:
 *   1. Dynamic EV Motor Whine (variable frequency oscillation mapped to RPM & Speed)
 *   2. ADAS Collision Warning Alarm (rapid dual-tone 880Hz / 1200Hz pulsing beeps)
 *   3. Turn Signal Relay Clicker (acoustic bandpass filtered pulse)
 *   4. Critical Fault Warning Tone (descending chime)
 */

'use strict';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;

    // EV Motor oscillator nodes
    this.motorOsc = null;
    this.motorSubOsc = null;
    this.motorGain = null;

    // Warning chime interval
    this.alarmInterval = null;
    this.alarmActive = false;

    // Turn signal interval
    this.turnSignalInterval = null;
    this.turnSignalActive = false;

    this._bindControls();
  }

  _initContext() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
        this._setupMotorSynthesizer();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  _bindControls() {
    const btn = document.getElementById('sound-toggle-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        this.toggleSound(btn);
      });
    }
  }

  toggleSound(btn) {
    this._initContext();
    this.enabled = !this.enabled;

    if (btn) {
      btn.classList.toggle('active', this.enabled);
      const icon = btn.querySelector('.sound-icon');
      const label = btn.querySelector('.sound-label');
      if (icon) icon.textContent = this.enabled ? '🔊' : '🔇';
      if (label) label.textContent = this.enabled ? 'SOUND ON' : 'SOUND MUTED';
    }

    if (this.enabled) {
      this._startMotor();
      this.playChime(600, 0.1);
    } else {
      this._stopMotor();
      this.stopCollisionAlarm();
      this.stopTurnSignal();
    }
  }

  /* ── EV Motor Whine Synthesizer ────────────────────────────────────────── */

  _setupMotorSynthesizer() {
    if (!this.ctx) return;

    // Master motor gain
    this.motorGain = this.ctx.createGain();
    this.motorGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

    // Primary motor harmonic (sine/triangle)
    this.motorOsc = this.ctx.createOscillator();
    this.motorOsc.type = 'triangle';
    this.motorOsc.frequency.setValueAtTime(80, this.ctx.currentTime);

    // Sub-harmonic for mechanical texture
    this.motorSubOsc = this.ctx.createOscillator();
    this.motorSubOsc.type = 'sine';
    this.motorSubOsc.frequency.setValueAtTime(40, this.ctx.currentTime);

    // Bandpass filter to model cabin acoustic dampening
    this.motorFilter = this.ctx.createBiquadFilter();
    this.motorFilter.type = 'bandpass';
    this.motorFilter.frequency.setValueAtTime(250, this.ctx.currentTime);
    this.motorFilter.Q.setValueAtTime(2.5, this.ctx.currentTime);

    this.motorOsc.connect(this.motorFilter);
    this.motorSubOsc.connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain);
    this.motorGain.connect(this.ctx.destination);

    this.motorOsc.start();
    this.motorSubOsc.start();
  }

  _startMotor() {
    if (this.motorGain && this.ctx) {
      this.motorGain.gain.setTargetAtTime(0.06, this.ctx.currentTime, 0.1);
    }
  }

  _stopMotor() {
    if (this.motorGain && this.ctx) {
      this.motorGain.gain.setTargetAtTime(0.00001, this.ctx.currentTime, 0.1);
    }
  }

  /**
   * Update motor sound pitch & volume from live telemetry
   * @param {number} speedKmh 
   * @param {number} rpm 
   * @param {number} throttlePct 
   */
  updateMotorSound(speedKmh, rpm, throttlePct) {
    if (!this.enabled || !this.ctx || !this.motorOsc) return;

    const baseFreq = 70 + (rpm / 8000) * 450 + (speedKmh / 200) * 200;
    const filterFreq = 150 + (speedKmh / 200) * 800;
    const targetGain = 0.02 + (throttlePct / 100) * 0.07;

    const now = this.ctx.currentTime;
    this.motorOsc.frequency.setTargetAtTime(baseFreq, now, 0.05);
    this.motorSubOsc.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.05);
    this.motorFilter.frequency.setTargetAtTime(filterFreq, now, 0.05);
    this.motorGain.gain.setTargetAtTime(targetGain, now, 0.05);
  }

  /* ── ADAS Collision Alarm ──────────────────────────────────────────────── */

  startCollisionAlarm() {
    if (!this.enabled || !this.ctx || this.alarmActive) return;
    this.alarmActive = true;

    const beep = () => {
      if (!this.alarmActive || !this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1100, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(750, this.ctx.currentTime + 0.14);

      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.14);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.15);
    };

    beep();
    this.alarmInterval = setInterval(beep, 180);
  }

  stopCollisionAlarm() {
    this.alarmActive = false;
    if (this.alarmInterval) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
  }

  /* ── Turn Signal Relay Clicker ─────────────────────────────────────────── */

  startTurnSignal() {
    if (!this.enabled || !this.ctx || this.turnSignalActive) return;
    this.turnSignalActive = true;

    let high = true;
    const click = () => {
      if (!this.turnSignalActive || !this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(high ? 1400 : 950, this.ctx.currentTime);
      high = !high;

      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.035);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.04);
    };

    click();
    this.turnSignalInterval = setInterval(click, 450);
  }

  stopTurnSignal() {
    this.turnSignalActive = false;
    if (this.turnSignalInterval) {
      clearInterval(this.turnSignalInterval);
      this.turnSignalInterval = null;
    }
  }

  /* ── General Chimes ────────────────────────────────────────────────────── */

  playChime(freq = 523.25, duration = 0.2) {
    if (!this.enabled || !this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.__audioEngine = new AudioEngine();
});
