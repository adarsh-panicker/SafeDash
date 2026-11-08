/**
 * SafeDash — road_vision.js
 * High-Definition 3D Perspective ADAS Road & Radar Vision Engine
 * QNX Global Hackathon  |  Pure Vanilla Canvas (60 FPS)
 *
 * Implements Tesla FSD / Porsche InnoDrive aesthetic:
 *   - 3D perspective highway with horizon glow and animated speed-synced grid
 *   - Ego vehicle (our car) at bottom center with glowing taillights & headlight beams
 *   - Forward millimeter-wave radar projection cone
 *   - Dynamic lead vehicle with distance tracking & proximity radar rings
 *   - Real-time lane departure boundary illumination
 *   - Adjacent lane blind-spot proximity silhouettes
 */

'use strict';

class RoadVisionRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    this.offsetY = 0;
    this.laneOffset = 0;
    this.radarPulse = 0;

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : null;
    const w = rect ? rect.width : 340;
    const h = rect ? rect.height : 200;

    this.canvas.width = Math.max(280, Math.floor(w));
    this.canvas.height = Math.max(180, Math.floor(h));
  }

  render(state) {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.clearRect(0, 0, W, H);

    const horizonY = H * 0.20;
    const horizonW = W * 0.18;
    const roadBottomW = W * 0.92;
    const cx = W * 0.5;

    // Smooth lane shift on lane departure
    let targetOffset = 0;
    if (state.lane_dep_L) targetOffset = -28;
    if (state.lane_dep_R) targetOffset = 28;
    this.laneOffset += (targetOffset - this.laneOffset) * 0.08;

    const baseCx = cx + this.laneOffset;

    /* 1. Horizon & Sky Glow */
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, '#060a14');
    skyGrad.addColorStop(1, 'rgba(15, 23, 42, 0.8)');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, horizonY);

    // Horizon line with subtle cyan glow
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(W, horizonY);
    ctx.stroke();

    /* 2. 3D Perspective Road Surface */
    const roadGrad = ctx.createLinearGradient(0, horizonY, 0, H);
    roadGrad.addColorStop(0, 'rgba(14, 22, 40, 0.6)');
    roadGrad.addColorStop(0.5, 'rgba(10, 15, 30, 0.9)');
    roadGrad.addColorStop(1, 'rgba(6, 10, 20, 0.98)');

    ctx.fillStyle = roadGrad;
    ctx.beginPath();
    ctx.moveTo(baseCx - horizonW * 0.5, horizonY);
    ctx.lineTo(baseCx + horizonW * 0.5, horizonY);
    ctx.lineTo(baseCx + roadBottomW * 0.5, H);
    ctx.lineTo(baseCx - roadBottomW * 0.5, H);
    ctx.closePath();
    ctx.fill();

    /* 3. Speed-synced 3D Horizontal Road Grid */
    const speed = Math.max(5, state.speed_kmh || 0);
    this.offsetY = (this.offsetY + (speed * 0.06)) % 40;

    ctx.save();
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const normY = ((i * 35 + this.offsetY) % 240) / 240;
      const py = horizonY + Math.pow(normY, 1.8) * (H - horizonY);
      const halfW = (horizonW * 0.5) + normY * ((roadBottomW - horizonW) * 0.5);

      ctx.strokeStyle = `rgba(0, 229, 255, ${0.03 + normY * 0.12})`;
      ctx.beginPath();
      ctx.moveTo(baseCx - halfW, py);
      ctx.lineTo(baseCx + halfW, py);
      ctx.stroke();
    }
    ctx.restore();

    /* 4. Road Boundaries (Turn neon amber on lane departure) */
    const leftBorderColor = state.lane_dep_L ? '#ffaa00' : 'rgba(0, 229, 255, 0.45)';
    const rightBorderColor = state.lane_dep_R ? '#ffaa00' : 'rgba(0, 229, 255, 0.45)';

    this._drawGlowLine(ctx, baseCx - horizonW * 0.5, horizonY, baseCx - roadBottomW * 0.5, H, leftBorderColor, state.lane_dep_L ? 3 : 1.8, state.lane_dep_L ? 10 : 0);
    this._drawGlowLine(ctx, baseCx + horizonW * 0.5, horizonY, baseCx + roadBottomW * 0.5, H, rightBorderColor, state.lane_dep_R ? 3 : 1.8, state.lane_dep_R ? 10 : 0);

    /* 5. Dashed Center Lane Dividers */
    ctx.save();
    ctx.setLineDash([16, 18]);
    ctx.lineDashOffset = -this.offsetY * 1.5;

    const leftDashHorizon = baseCx - horizonW * 0.18;
    const leftDashBottom  = baseCx - roadBottomW * 0.18;
    this._drawLine(ctx, leftDashHorizon, horizonY, leftDashBottom, H, 'rgba(0, 229, 255, 0.4)', 1.5);

    const rightDashHorizon = baseCx + horizonW * 0.18;
    const rightDashBottom  = baseCx + roadBottomW * 0.18;
    this._drawLine(ctx, rightDashHorizon, horizonY, rightDashBottom, H, 'rgba(0, 229, 255, 0.4)', 1.5);
    ctx.restore();

    /* 6. Forward Millimeter-Wave Radar Cone */
    this.radarPulse = (this.radarPulse + 0.03) % 1;
    ctx.save();
    const radarGrad = ctx.createRadialGradient(baseCx, H - 30, 20, baseCx, horizonY, H * 0.7);
    const isCritical = state.collision || (state.acc_distance_m && state.acc_distance_m < 25);
    const radarColor = isCritical ? 'rgba(255, 34, 68,' : 'rgba(0, 229, 255,';

    radarGrad.addColorStop(0, `${radarColor} 0.15)`);
    radarGrad.addColorStop(0.6, `${radarColor} 0.05)`);
    radarGrad.addColorStop(1, `${radarColor} 0.0)`);

    ctx.fillStyle = radarGrad;
    ctx.beginPath();
    ctx.moveTo(baseCx, H - 25);
    ctx.lineTo(baseCx - roadBottomW * 0.28, horizonY + 20);
    ctx.lineTo(baseCx + roadBottomW * 0.28, horizonY + 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    /* 7. Lead Vehicle Ahead */
    const accDist = Math.max(10, Math.min(100, state.acc_distance_m || 45));
    const distNorm = (accDist - 10) / 90;
    const leadY = horizonY + (1.0 - Math.pow(distNorm, 0.7)) * (H * 0.58);
    const leadScale = 0.45 + (1.0 - distNorm) * 0.65;
    const leadW = 46 * leadScale;
    const leadH = 26 * leadScale;

    // Proximity Radar Rings under lead vehicle
    const ringColor = isCritical ? '#ff2244' : (accDist < 45 ? '#ffaa00' : '#00e5ff');
    ctx.save();
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = isCritical ? 2.5 : 1.2;
    ctx.shadowColor = ringColor;
    ctx.shadowBlur = isCritical ? 12 : 4;
    ctx.beginPath();
    ctx.ellipse(baseCx, leadY + leadH * 0.5, leadW * 1.3, leadH * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Lead vehicle body
    ctx.save();
    ctx.fillStyle = isCritical ? 'rgba(255, 34, 68, 0.35)' : 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(baseCx - leadW * 0.5, leadY - leadH * 0.5, leadW, leadH, 4 * leadScale);
    ctx.fill();
    ctx.stroke();

    // Lead vehicle taillights
    ctx.fillStyle = isCritical ? '#ff0033' : '#ff3344';
    ctx.shadowColor = '#ff0033';
    ctx.shadowBlur = isCritical ? 14 : 6;
    const tailW = 7 * leadScale;
    const tailH = 3 * leadScale;
    ctx.fillRect(baseCx - leadW * 0.44, leadY + leadH * 0.12, tailW, tailH);
    ctx.fillRect(baseCx + leadW * 0.44 - tailW, leadY + leadH * 0.12, tailW, tailH);
    ctx.restore();

    // Floating Distance Badge
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(10, Math.round(11 * leadScale))}px -apple-system, monospace`;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText(`${Math.round(accDist)} m`, baseCx, leadY - leadH * 0.65);
    ctx.restore();

    /* 8. Ego Vehicle (Our Car) at bottom center */
    const egoW = 54;
    const egoH = 32;
    const egoY = H - 22;

    ctx.save();
    // Headlight beam illumination (Adaptive Matrix / High Beam)
    const isHigh = !!this.highBeam;
    const beamReach = isHigh ? 125 : 65;
    const beamOpacity = isHigh ? 0.45 : 0.22;
    const beamGrad = ctx.createRadialGradient(baseCx, egoY - 10, 10, baseCx, egoY - beamReach, beamReach);
    beamGrad.addColorStop(0, `rgba(230, 245, 255, ${beamOpacity})`);
    beamGrad.addColorStop(0.7, `rgba(0, 229, 255, ${beamOpacity * 0.4})`);
    beamGrad.addColorStop(1, 'rgba(0, 229, 255, 0)');
    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(baseCx - egoW * 0.4, egoY - 6);
    ctx.lineTo(baseCx - egoW * (isHigh ? 1.0 : 0.7), egoY - beamReach);
    ctx.lineTo(baseCx + egoW * (isHigh ? 1.0 : 0.7), egoY - beamReach);
    ctx.lineTo(baseCx + egoW * 0.4, egoY - 6);
    ctx.closePath();
    ctx.fill();

    // Ego car body
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(baseCx - egoW * 0.5, egoY - egoH * 0.5, egoW, egoH, 6);
    ctx.fill();
    ctx.stroke();

    // Windshield
    ctx.fillStyle = 'rgba(0, 229, 255, 0.25)';
    ctx.beginPath();
    ctx.roundRect(baseCx - egoW * 0.35, egoY - egoH * 0.4, egoW * 0.7, egoH * 0.35, 3);
    ctx.fill();

    // Ego taillights
    ctx.fillStyle = '#ff2244';
    ctx.shadowColor = '#ff2244';
    ctx.shadowBlur = 8;
    ctx.fillRect(baseCx - egoW * 0.42, egoY + egoH * 0.25, 8, 4);
    ctx.fillRect(baseCx + egoW * 0.42 - 8, egoY + egoH * 0.25, 8, 4);
    ctx.restore();

    /* 9. Blind-Spot Proximity Silhouettes */
    if (state.bspot_L) {
      this._drawBlindSpotCar(ctx, baseCx - roadBottomW * 0.38, H * 0.72, '#ffaa00', 'LEFT');
    }
    if (state.bspot_R) {
      this._drawBlindSpotCar(ctx, baseCx + roadBottomW * 0.38, H * 0.72, '#ffaa00', 'RIGHT');
    }
  }

  _drawLine(ctx, x1, y1, x2, y2, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  _drawGlowLine(ctx, x1, y1, x2, y2, color, width, blur) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (blur > 0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
    }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  _drawBlindSpotCar(ctx, x, y, color, label) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 170, 0, 0.25)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(x - 18, y - 12, 36, 24, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`BS ${label}`, x, y + 3);
    ctx.restore();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.__roadVision = new RoadVisionRenderer('road-vision-canvas');
});
