/**
 * SafeDash — road_vision.js
 * 2.5D Perspective ADAS Road & Radar Visualizer
 * QNX Global Hackathon  |  Pure Vanilla Canvas (60 FPS)
 *
 * Renders:
 *   1. Moving perspective highway lanes with speed-synced dashed lines
 *   2. Dynamic lead vehicle rendered with wireframe aesthetic & distance radar
 *   3. Real-time Lane Departure Warning (lane line flashes neon amber when crossing)
 *   4. Blind Spot proximity silhouettes on adjacent left/right lanes
 *   5. Forward collision radar proximity rings (turns red under 20m)
 */

'use strict';

class RoadVisionRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    this.offsetY = 0;
    this.laneOffset = 0; // -1 (left departure) to +1 (right departure)

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.max(220, Math.floor(rect.width));
    this.canvas.height = Math.max(160, Math.floor(rect.height || 180));
  }

  /**
   * Render frame
   * @param {Object} state - Telemetry state
   */
  render(state) {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Horizon coordinates
    const horizonY = H * 0.22;
    const horizonW = W * 0.16;
    const roadBottomW = W * 0.88;
    const cx = W * 0.5;

    // Shift road position based on lane departure
    let targetOffset = 0;
    if (state.lane_dep_L) targetOffset = -22;
    if (state.lane_dep_R) targetOffset = 22;
    this.laneOffset += (targetOffset - this.laneOffset) * 0.1;

    const baseCx = cx + this.laneOffset;

    // Road surface gradient
    const roadGrad = ctx.createLinearGradient(0, horizonY, 0, H);
    roadGrad.addColorStop(0, 'rgba(15, 23, 42, 0.4)');
    roadGrad.addColorStop(1, 'rgba(10, 14, 26, 0.95)');

    ctx.fillStyle = roadGrad;
    ctx.beginPath();
    ctx.moveTo(baseCx - horizonW * 0.5, horizonY);
    ctx.lineTo(baseCx + horizonW * 0.5, horizonY);
    ctx.lineTo(baseCx + roadBottomW * 0.5, H);
    ctx.lineTo(baseCx - roadBottomW * 0.5, H);
    ctx.closePath();
    ctx.fill();

    // Outer road borders
    const borderLeftColor = state.lane_dep_L ? '#ffaa00' : 'rgba(0, 229, 255, 0.4)';
    const borderRightColor = state.lane_dep_R ? '#ffaa00' : 'rgba(0, 229, 255, 0.4)';

    this._drawRoadLine(ctx, baseCx - horizonW * 0.5, horizonY, baseCx - roadBottomW * 0.5, H, borderLeftColor, state.lane_dep_L ? 3 : 1.5);
    this._drawRoadLine(ctx, baseCx + horizonW * 0.5, horizonY, baseCx + roadBottomW * 0.5, H, borderRightColor, state.lane_dep_R ? 3 : 1.5);

    // Speed-based dashed center lane markings
    const speed = Math.max(5, state.speed_kmh || 0);
    this.offsetY = (this.offsetY + (speed * 0.08)) % 40;

    // Draw dashed lane strips
    ctx.save();
    ctx.setLineDash([12, 14]);
    ctx.lineDashOffset = -this.offsetY;

    // Left lane dash
    const leftDashHorizon = baseCx - horizonW * 0.18;
    const leftDashBottom = baseCx - roadBottomW * 0.18;
    this._drawRoadLine(ctx, leftDashHorizon, horizonY, leftDashBottom, H, 'rgba(0, 229, 255, 0.35)', 1.5);

    // Right lane dash
    const rightDashHorizon = baseCx + horizonW * 0.18;
    const rightDashBottom = baseCx + roadBottomW * 0.18;
    this._drawRoadLine(ctx, rightDashHorizon, horizonY, rightDashBottom, H, 'rgba(0, 229, 255, 0.35)', 1.5);

    ctx.restore();

    // Draw Lead Vehicle & ACC Distance Radar
    const accDist = Math.max(10, Math.min(100, state.acc_distance_m || 45));
    const distNorm = (accDist - 10) / 90; // 0 = close (bottom), 1 = far (horizon)
    const carY = horizonY + (1.0 - distNorm) * (H * 0.62);
    const carScale = 0.4 + (1.0 - distNorm) * 0.6;
    const carW = 44 * carScale;
    const carH = 26 * carScale;

    // Collision warning threshold (< 25m)
    const isCritical = state.collision || accDist < 25;
    const radarColor = isCritical ? '#ff2244' : (accDist < 45 ? '#ffaa00' : '#00e5ff');

    // Radar distance rings on road
    ctx.strokeStyle = radarColor;
    ctx.lineWidth = isCritical ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.ellipse(baseCx, carY + carH * 0.6, carW * 1.3, carH * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Lead vehicle wireframe box
    ctx.fillStyle = isCritical ? 'rgba(255, 34, 68, 0.3)' : 'rgba(0, 229, 255, 0.2)';
    ctx.strokeStyle = radarColor;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.roundRect(baseCx - carW * 0.5, carY - carH * 0.5, carW, carH, 4 * carScale);
    ctx.fill();
    ctx.stroke();

    // Lead vehicle taillights
    ctx.fillStyle = isCritical ? '#ff0000' : '#ff4444';
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = isCritical ? 10 : 4;

    const tailW = 6 * carScale;
    const tailH = 3 * carScale;
    ctx.fillRect(baseCx - carW * 0.45, carY + carH * 0.15, tailW, tailH);
    ctx.fillRect(baseCx + carW * 0.45 - tailW, carY + carH * 0.15, tailW, tailH);
    ctx.shadowBlur = 0;

    // Distance badge floating above lead car
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(9, Math.round(11 * carScale))}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(accDist)}m`, baseCx, carY - carH * 0.65);

    // Blind spot indicator silhouettes
    if (state.bspot_L) {
      this._drawBlindSpotCar(ctx, baseCx - roadBottomW * 0.38, H * 0.75, '#ffaa00', 'LEFT');
    }
    if (state.bspot_R) {
      this._drawBlindSpotCar(ctx, baseCx + roadBottomW * 0.38, H * 0.75, '#ffaa00', 'RIGHT');
    }
  }

  _drawRoadLine(ctx, x1, y1, x2, y2, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  _drawBlindSpotCar(ctx, x, y, color, label) {
    ctx.fillStyle = 'rgba(255, 170, 0, 0.25)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x - 16, y - 10, 32, 20, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`BS ${label}`, x, y + 2);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.__roadVision = new RoadVisionRenderer('road-vision-canvas');
});
