/**
 * 2.5D 等距渲染原语（纯 Canvas 2D，零依赖 —— 可直接复用于酒馆内嵌构建）
 *
 * 视觉语言（用户规格）：
 * - 友方单位（含玩家）：绿色圆球（径向渐变 + 悬浮 + 椭圆投影）
 * - 敌对单位：红色四棱锥（双面明暗着色 + 尖顶高光）
 * - 中立单位：琥珀色圆球
 * - 掩体/墙：灰色立方体（顶面亮 / 左面中 / 右面暗，高度按掩体类型）
 */

export interface IsoCam {
  scale: number;
  panX: number;
  panY: number;
}

/** 基础菱格尺寸（scale=1 时的像素） */
export const TILE_W = 76;
export const TILE_H = 38;

export interface Projector {
  /** 网格坐标（可为小数）→ 屏幕像素 */
  p: (gx: number, gy: number) => { x: number; y: number };
  /** 屏幕 → 网格（小数） */
  unproject: (sx: number, sy: number) => { gx: number; gy: number };
  hw: number;
  hh: number;
  scale: number;
}

export function makeProjector(cam: IsoCam): Projector {
  const hw = (TILE_W / 2) * cam.scale;
  const hh = (TILE_H / 2) * cam.scale;
  return {
    hw,
    hh,
    scale: cam.scale,
    p: (gx: number, gy: number) => ({ x: (gx - gy) * hw + cam.panX, y: (gx + gy) * hh + cam.panY }),
    unproject: (sx: number, sy: number) => {
      const a = (sx - cam.panX) / hw;
      const b = (sy - cam.panY) / hh;
      return { gx: (a + b) / 2, gy: (b - a) / 2 };
    },
  };
}

/** 稳定字符串哈希（悬浮动画相位用） */
export function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function diamondPath(ctx: CanvasRenderingContext2D, proj: Projector, cx: number, cy: number, inset = 0) {
  const i = inset;
  const n = proj.p(cx + i, cy + i);
  const e = proj.p(cx + 1 - i, cy + i);
  const s = proj.p(cx + 1 - i, cy + 1 - i);
  const w = proj.p(cx + i, cy + 1 - i);
  ctx.beginPath();
  ctx.moveTo(n.x, n.y);
  ctx.lineTo(e.x, e.y);
  ctx.lineTo(s.x, s.y);
  ctx.lineTo(w.x, w.y);
  ctx.closePath();
}

// ============ 地面 ============

export function drawFloorTile(
  ctx: CanvasRenderingContext2D,
  proj: Projector,
  cx: number,
  cy: number,
  inBounds: boolean,
) {
  const checker = (cx + cy) % 2 === 0;
  diamondPath(ctx, proj, cx, cy, 0);
  if (inBounds) {
    ctx.fillStyle = checker ? '#2b2318' : '#251f15';
  } else {
    ctx.fillStyle = checker ? '#17130d' : '#14110c';
  }
  ctx.fill();
  ctx.strokeStyle = inBounds ? 'rgba(216,178,122,0.13)' : 'rgba(216,178,122,0.05)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** 单元格覆盖高亮（移动范围 / AoE） */
export function drawCellOverlay(
  ctx: CanvasRenderingContext2D,
  proj: Projector,
  cx: number,
  cy: number,
  fill: string,
  stroke?: string,
) {
  diamondPath(ctx, proj, cx, cy, 0.03);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// ============ 灰色立方体（掩体） ============

export type CoverKind = 'half' | 'threeQuarters' | 'full';

export function coverHeightPx(kind: CoverKind, scale: number): number {
  switch (kind) {
    case 'full': return 40 * scale;
    case 'threeQuarters': return 28 * scale;
    case 'half': return 17 * scale;
  }
}

export function drawCube(
  ctx: CanvasRenderingContext2D,
  proj: Projector,
  cx: number,
  cy: number,
  kind: CoverKind,
) {
  const scale = proj.scale;
  const inset = 0.04;
  const h = coverHeightPx(kind, scale);
  // 底面四角
  const n0 = proj.p(cx + inset, cy + inset);
  const e0 = proj.p(cx + 1 - inset, cy + inset);
  const s0 = proj.p(cx + 1 - inset, cy + 1 - inset);
  const w0 = proj.p(cx + inset, cy + 1 - inset);
  // 顶面四角（抬升 h）
  const dy = -h;
  const n1 = { x: n0.x, y: n0.y + dy };
  const e1 = { x: e0.x, y: e0.y + dy };
  const s1 = { x: s0.x, y: s0.y + dy };
  const w1 = { x: w0.x, y: w0.y + dy };

  // 阴影（略向观察者方向偏移）
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.moveTo(n0.x, n0.y + 2 * scale);
  ctx.lineTo(e0.x + 4 * scale, e0.y + 2 * scale);
  ctx.lineTo(s0.x, s0.y + 4 * scale);
  ctx.lineTo(w0.x - 4 * scale, w0.y + 2 * scale);
  ctx.closePath();
  ctx.fill();

  // 左面（W-S）
  ctx.beginPath();
  ctx.moveTo(w1.x, w1.y); ctx.lineTo(s1.x, s1.y); ctx.lineTo(s0.x, s0.y); ctx.lineTo(w0.x, w0.y);
  ctx.closePath();
  ctx.fillStyle = kind === 'half' ? '#6d737c' : '#61666e';
  ctx.fill();

  // 右面（S-E）
  ctx.beginPath();
  ctx.moveTo(s1.x, s1.y); ctx.lineTo(e1.x, e1.y); ctx.lineTo(e0.x, e0.y); ctx.lineTo(s0.x, s0.y);
  ctx.closePath();
  ctx.fillStyle = kind === 'half' ? '#565b63' : '#4b4f56';
  ctx.fill();

  // 顶面
  ctx.beginPath();
  ctx.moveTo(n1.x, n1.y); ctx.lineTo(e1.x, e1.y); ctx.lineTo(s1.x, s1.y); ctx.lineTo(w1.x, w1.y);
  ctx.closePath();
  ctx.fillStyle = kind === 'half' ? '#8d949e' : '#82888f';
  ctx.fill();
  // 顶面高光边
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 木箱（半身掩体）画交叉木条
  if (kind === 'half') {
    ctx.strokeStyle = 'rgba(30,32,36,0.55)';
    ctx.lineWidth = 1.6 * scale;
    ctx.beginPath();
    ctx.moveTo(w0.x, w0.y); ctx.lineTo(s1.x, s1.y);
    ctx.moveTo(w1.x, w1.y); ctx.lineTo(s0.x, s0.y);
    ctx.moveTo(s1.x, s1.y); ctx.lineTo(e0.x, e0.y);
    ctx.moveTo(e1.x, e1.y); ctx.lineTo(s0.x, s0.y);
    ctx.stroke();
  }

  // 轮廓
  ctx.strokeStyle = 'rgba(15,17,20,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(n1.x, n1.y); ctx.lineTo(e1.x, e1.y); ctx.lineTo(e0.x, e0.y);
  ctx.moveTo(n1.x, n1.y); ctx.lineTo(w1.x, w1.y); ctx.lineTo(w0.x, w0.y);
  ctx.moveTo(s1.x, s1.y); ctx.lineTo(s0.x, s0.y);
  ctx.stroke();
}

// ============ 绿色圆球（友方/中立） ============

export interface SphereOpts {
  /** 屏幕坐标中心（球心） */
  x: number;
  y: number;
  radius: number;
  colors: { hi: string; mid: string; lo: string };
  alpha?: number;
  squash?: number; // 1 = 正常；倒地 0.4
}

export function drawShadow(ctx: CanvasRenderingContext2D, x: number, groundY: number, rx: number, alpha = 0.32) {
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, groundY, rx, rx * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawSphere(ctx: CanvasRenderingContext2D, o: SphereOpts) {
  const { x, y, radius: r, colors, alpha = 1, squash = 1 } = o;
  ctx.save();
  ctx.globalAlpha = alpha;
  const ry = r * squash;
  const g = ctx.createRadialGradient(x - r * 0.35, y - ry * 0.42, r * 0.12, x, y, r * 1.05);
  g.addColorStop(0, colors.hi);
  g.addColorStop(0.55, colors.mid);
  g.addColorStop(1, colors.lo);
  ctx.beginPath();
  ctx.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // 高光
  ctx.beginPath();
  ctx.ellipse(x - r * 0.34, y - ry * 0.42, r * 0.22, r * 0.14, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
  // 底部反光
  ctx.beginPath();
  ctx.ellipse(x + r * 0.15, y + ry * 0.55, r * 0.5, r * 0.18, 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.restore();
}

// ============ 红色四棱锥（敌方） ============

export interface PyramidOpts {
  /** 底面中心屏幕坐标（地面） */
  x: number;
  groundY: number;
  /** 底面半径（屏幕像素） */
  baseRx: number;
  baseRy: number;
  height: number;
  alpha?: number;
  squash?: number;
  hi?: string;
  lo?: string;
}

export function drawPyramid(ctx: CanvasRenderingContext2D, o: PyramidOpts) {
  const { x, groundY, baseRx: ex, baseRy: ey, height: h, alpha = 1, squash = 1, hi = '#e05a4a', lo = '#9c2418' } = o;
  const hh = h * squash;
  const N = { x, y: groundY - ey };
  const E = { x: x + ex, y: groundY };
  const S = { x, y: groundY + ey };
  const W = { x: x - ex, y: groundY };
  const apex = { x, y: groundY - hh };
  ctx.save();
  ctx.globalAlpha = alpha;
  // 底面暗色
  ctx.beginPath();
  ctx.moveTo(N.x, N.y); ctx.lineTo(E.x, E.y); ctx.lineTo(S.x, S.y); ctx.lineTo(W.x, W.y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(40,10,8,0.55)';
  ctx.fill();
  // 左面（W-S-apex，受光面）
  ctx.beginPath();
  ctx.moveTo(W.x, W.y); ctx.lineTo(S.x, S.y); ctx.lineTo(apex.x, apex.y);
  ctx.closePath();
  ctx.fillStyle = hi;
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,6,4,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 右面（S-E-apex，背光面）
  ctx.beginPath();
  ctx.moveTo(S.x, S.y); ctx.lineTo(E.x, E.y); ctx.lineTo(apex.x, apex.y);
  ctx.closePath();
  ctx.fillStyle = lo;
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,6,4,0.5)';
  ctx.stroke();
  // 尖顶高光
  ctx.beginPath();
  ctx.arc(apex.x, apex.y, Math.max(1.5, ex * 0.06), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,220,200,0.85)';
  ctx.fill();
  ctx.restore();
}

// ============ UI 元件（HP条/名字/状态图标/光环） ============

export function drawHpBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  scale: number,
  text?: string,
) {
  const r = Math.max(0, Math.min(1, ratio));
  ctx.save();
  ctx.fillStyle = 'rgba(8,8,10,0.82)';
  ctx.strokeStyle = 'rgba(216,178,122,0.35)';
  ctx.lineWidth = 1;
  roundRect(ctx, x - w / 2 - 1, y - 1, w + 2, h + 2, 2.5 * scale);
  ctx.fill();
  ctx.stroke();
  let color: string;
  if (r > 0.5) color = '#4f9d43';
  else if (r > 0.25) color = '#d3a13c';
  else color = '#d5453c';
  ctx.fillStyle = color;
  roundRect(ctx, x - w / 2, y, Math.max(0, w * r), h, 1.8 * scale);
  ctx.fill();
  if (text) {
    ctx.font = `bold ${Math.max(9, 10 * scale)}px "Noto Sans SC", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y - 2);
    ctx.fillStyle = '#f0e6d2';
    ctx.fillText(text, x, y - 2);
  }
  ctx.restore();
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  scale: number,
  fontSize = 11,
) {
  ctx.save();
  ctx.font = `bold ${fontSize * scale}px "Noto Sans SC", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** 选中/回合光环（地面椭圆虚线圈） */
export function drawRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  rx: number,
  color: string,
  dashOffset: number,
  lineWidth = 2,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([7, 5]);
  ctx.lineDashOffset = dashOffset;
  ctx.beginPath();
  ctx.ellipse(x, groundY, rx, rx * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** 攻击命中闪光（扩散环） */
export function drawImpactRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
  color: string,
) {
  const r = 8 + progress * 34;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - progress);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3 * (1 - progress) + 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** 挥砍弧线 */
export function drawSlash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
) {
  const p = progress;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - p);
  ctx.strokeStyle = 'rgba(255,235,200,0.95)';
  ctx.lineWidth = 3.5 * (1 - p * 0.6);
  ctx.lineCap = 'round';
  const start = -0.9 + p * 1.2;
  ctx.beginPath();
  ctx.arc(x, y, 16 + p * 14, start, start + 1.5);
  ctx.stroke();
  ctx.restore();
}

/** 飘字（伤害/治疗/暴击） */
export function drawFloatText(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  progress: number,
  big = false,
) {
  const dy = progress * 42;
  ctx.save();
  ctx.globalAlpha = progress < 0.7 ? 1 : Math.max(0, (1 - progress) / 0.3);
  ctx.font = `bold ${(big ? 21 : 15)}px "Noto Sans SC", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 4;
  ctx.strokeText(text, x, y - dy);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y - dy);
  ctx.restore();
}

/** 拖拽成本徽章 */
export function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bg: string,
  scale: number,
) {
  ctx.save();
  ctx.font = `bold ${11 * Math.max(0.8, scale)}px "Noto Sans SC", system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 14;
  const h = 20;
  ctx.fillStyle = bg;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}
