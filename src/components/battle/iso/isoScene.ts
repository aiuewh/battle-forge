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

/**
 * 舞台色板（暖暗底 + 金强调）。CSS 侧镜像：globals.css `.battle-workspace` 的 `--hud-*` 令牌。
 * 语义固定：金=行动/可达，青绿=治疗/恢复，蓝=选中，红=敌方/伤害，琥珀=中立。
 */
export const STAGE_PALETTE = {
  bgTop: '#100d09',
  bgBottom: '#1a1410',
  floorInA: '#2b2318',
  floorInB: '#251f15',
  floorOutA: '#17130d',
  floorOutB: '#14110c',
  gridIn: 'rgba(216,178,122,0.26)',
  gridOut: 'rgba(216,178,122,0.07)',
  boundaryEdge: 'rgba(0,0,0,0.6)',
  boundaryLine: 'rgba(229,189,125,0.5)',
  rangeFill: 'rgba(229,189,125,0.20)',
  rangeFillHover: 'rgba(229,189,125,0.34)',
  rangeStroke: 'rgba(229,189,125,0.5)',
  pathValid: 'rgba(240,205,150,0.95)',
  pathInvalid: 'rgba(255,110,110,0.9)',
  pathBadgeBg: 'rgba(70,55,22,0.92)',
  // 选中环：暖白（与金色主题同族）——原先的冷蓝 #6eb4fa 与全局金色冲突
  selectRing: 'rgba(255,246,224,0.92)',
  hpHigh: '#4f9d43',
  hpMid: '#d3a13c',
  hpLow: '#d5453c',
  ink: '#f0e6d2',
  plateBg: 'rgba(14,11,8,0.84)',
  plateBorder: 'rgba(229,189,125,0.32)',
  plateBorderCurrent: 'rgba(229,189,125,0.9)',
  plateBorderSelected: 'rgba(255,246,224,0.82)',
  // ── 环境层（v2 2026-11-23）──
  // 此前战场只有纯色棋盘格 + 单位，画面扁平单调。这三层是低成本的氛围叠加：
  //   ① 光晕：从战场中心向外的暖光衰减，制造"被火把照亮"的焦点感
  //   ② 边界晕影：地图外圈向内压暗，视线自然收拢到中心
  //   ③ 地面颗粒：极淡的噪点，避免大色块显得像塑料板
  vignetteEdge: 'rgba(4,3,2,0.62)',
  vignetteCore: 'rgba(4,3,2,0)',
  glowCore: 'rgba(255,214,150,0.11)',
  glowEdge: 'rgba(255,200,120,0)',
  gritLight: 'rgba(255,236,200,0.030)',
  gritDark: 'rgba(0,0,0,0.055)',
} as const;

/**
 * HP 比例 → 色梯（画布名牌与 DOM 血条共用）。
 * 单一来源：所有 HP 颜色都必须经过这里，别在组件里硬编码 hex ——
 * 此前 InitiativeBar / UnitDetailCard 各自写了一套 #c9973a/#b03a3a，
 * 与画布的 #d3a13c/#d5453c 不一致，同一条血条在地图和列表里颜色不同。
 */
export function hpColor(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  return r > 0.5 ? STAGE_PALETTE.hpHigh : r > 0.25 ? STAGE_PALETTE.hpMid : STAGE_PALETTE.hpLow;
}

/** HP 比例 → 渐变（DOM 进度条用）。终点色比主色亮一档，保持与画布同一色相。 */
export function hpGradient(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  if (r > 0.5) return `linear-gradient(90deg, ${STAGE_PALETTE.hpHigh}, #6dbf5e)`;
  if (r > 0.25) return `linear-gradient(90deg, ${STAGE_PALETTE.hpMid}, #e0b040)`;
  return `linear-gradient(90deg, ${STAGE_PALETTE.hpLow}, #e05252)`;
}

/** canvas 内中文字体栈：Noto Sans SC 未内嵌时按平台回退，避免掉到衬线默认 */
const CJK_FONT = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

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
    ctx.fillStyle = checker ? STAGE_PALETTE.floorInA : STAGE_PALETTE.floorInB;
  } else {
    ctx.fillStyle = checker ? STAGE_PALETTE.floorOutA : STAGE_PALETTE.floorOutB;
  }
  ctx.fill();
  ctx.strokeStyle = inBounds ? STAGE_PALETTE.gridIn : STAGE_PALETTE.gridOut;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 每 5 格一条主网格线：地图类 UI 的通行做法，
  // 让小格有了「尺」的参照，扫读距离时不用逐格数。
  if (inBounds && (cx % 5 === 0 || cy % 5 === 0)) {
    const n = proj.p(cx, cy), e = proj.p(cx + 1, cy);
    const s2 = proj.p(cx + 1, cy + 1), w2 = proj.p(cx, cy + 1);
    ctx.strokeStyle = 'rgba(229,189,125,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (cy % 5 === 0) { ctx.moveTo(n.x, n.y); ctx.lineTo(e.x, e.y); }       // 北边
    if (cx % 5 === 0) { ctx.moveTo(w2.x, w2.y); ctx.lineTo(s2.x, s2.y); }   // 西边
    ctx.stroke();
  }
}

/**
 * 地面颗粒：极淡的随机噪点，打散大色块的塑料感。
 * 用 muHash 保证同一格每帧噪点一致（否则会闪）。只在地图范围内画。
 */
export function drawFloorGrit(
  ctx: CanvasRenderingContext2D,
  proj: Projector,
  cx: number,
  cy: number,
  seed: number,
) {
  // 每格 5-7 个点，位置由 (格坐标, 序号, seed) 决定 —— 稳定不闪
  const n = 5 + (seed % 3);
  for (let i = 0; i < n; i++) {
    const h1 = ((cx * 73856093) ^ (cy * 19349663) ^ (i * 83492791) ^ seed) >>> 0;
    const h2 = (h1 * 2654435761) >>> 0;
    const fx = (h1 % 1000) / 1000;
    const fy = (h2 % 1000) / 1000;
    const p = proj.p(cx + fx, cy + fy);
    const r = 0.5 + ((h1 >> 8) % 3) * 0.28;
    ctx.fillStyle = (i % 2 === 0) ? STAGE_PALETTE.gritLight : STAGE_PALETTE.gritDark;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 地形装饰：在部分格子上撒确定性碎石/裂纹/苔痕。
 *
 * 为什么需要它：纯棋盘格 + 光照解决不了「单调」——地面没有任何信息密度。
 * 装饰用格坐标哈希决定，同一格永远同一图案（不闪），也不需要美术素材。
 * 密度由 seed 控制；只画很小的笔触，不遮挡格线、不影响点击判定。
 */
export function drawTerrainDetail(
  ctx: CanvasRenderingContext2D,
  proj: Projector,
  cx: number,
  cy: number,
  seed: number,
) {
  const h = ((cx * 73856093) ^ (cy * 19349663) ^ (seed * 83492791)) >>> 0;
  const kind = h % 10;
  // 10 格里约 3 格有装饰。碎石在 1280px 下会退化成均匀白点（像脏屏），
  // 所以只保留裂纹与苔痕这两种「成片」的笔触。
  if (kind > 2) return;

  const cxF = ((h >> 4) % 700) / 700 * 0.7 + 0.15;
  const cyF = ((h >> 11) % 700) / 700 * 0.7 + 0.15;
  const p = proj.p(cx + cxF, cy + cyF);
  const sc = proj.scale;

  ctx.save();
  if (kind === 0) {
    // 裂纹：一条折线
    ctx.strokeStyle = 'rgba(14,11,8,0.72)';
    ctx.lineWidth = Math.max(1.2, 1.8 * sc);
    ctx.beginPath();
    let px = p.x - 16 * sc, py = p.y;
    ctx.moveTo(px, py);
    for (let i = 0; i < 3; i++) {
      const hh = (h * (i + 7) * 2246822519) >>> 0;
      px += (8 + (hh % 6)) * sc;
      py += (((hh >> 5) % 9) - 4) * sc * 0.85;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  } else {
    // 苔痕：一小片暗淡绿斑
    const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 17 * sc);
    g.addColorStop(0, 'rgba(88,112,66,0.52)');
    g.addColorStop(0.6, 'rgba(74,98,56,0.26)');
    g.addColorStop(1, 'rgba(66,88,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 17 * sc, 8.5 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 战场光晕：以可见区域中心为源的径向暖光，让玩家视线落在战场中央。
 * 画在全部地面之后、单位之前，alpha 很低不会影响格线可读性。
 */
export function drawStageGlow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
) {
  const cx = w * 0.5;
  const cy = h * 0.46;
  const radius = Math.max(w, h) * 0.62;
  const g = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius);
  g.addColorStop(0, STAGE_PALETTE.glowCore);
  g.addColorStop(0.55, 'rgba(255,205,130,0.042)');
  g.addColorStop(1, STAGE_PALETTE.glowEdge);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * 边界晕影：四边向内压暗，把视线收拢到战场中心。
 * 用四条线性渐变而不是单体径向，避免中间区域被压平。
 */
export function drawStageVignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strength = 1,
) {
  const band = Math.max(64, Math.min(w, h) * 0.22);
  ctx.save();
  ctx.globalAlpha = strength;

  // 上：边缘深 → 内侧透明
  let g = ctx.createLinearGradient(0, 0, 0, band);
  g.addColorStop(0, STAGE_PALETTE.vignetteEdge);
  g.addColorStop(1, STAGE_PALETTE.vignetteCore);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, band);

  // 下：反向
  g = ctx.createLinearGradient(0, h, 0, h - band);
  g.addColorStop(0, STAGE_PALETTE.vignetteEdge);
  g.addColorStop(1, STAGE_PALETTE.vignetteCore);
  ctx.fillStyle = g;
  ctx.fillRect(0, h - band, w, band);

  // 左：边缘深 → 内侧透明
  g = ctx.createLinearGradient(0, 0, band, 0);
  g.addColorStop(0, STAGE_PALETTE.vignetteEdge);
  g.addColorStop(1, STAGE_PALETTE.vignetteCore);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, band, h);

  // 右：反向
  g = ctx.createLinearGradient(w, 0, w - band, 0);
  g.addColorStop(0, STAGE_PALETTE.vignetteEdge);
  g.addColorStop(1, STAGE_PALETTE.vignetteCore);
  ctx.fillStyle = g;
  ctx.fillRect(w - band, 0, band, h);

  ctx.restore();
}

/**
 * 台面厚度：沿地图菱形的两条前边（南、东）向下画出"地基"，
 * 让整张地图看起来是一块有厚度的石台，而不是浮着的平面贴图。
 *
 * 这是等距视角最能提升体积感的一步 —— 平面贴图无论怎么加光照都是"贴纸"，
 * 有了侧壁立刻变成"物件"。只用两个多边形 + 一条顶楞高光。
 */
export function drawSlabWall(
  ctx: CanvasRenderingContext2D,
  proj: Projector,
  mapW: number,
  mapH: number,
  depthPx: number,
) {
  const cS = proj.p(mapW, mapH);   // 南角（最下方）
  const cE = proj.p(mapW, 0);       // 东角（右侧）
  const cW = proj.p(0, mapH);       // 西角（左侧）

  ctx.save();
  // 右侧壁（S→E 的下沿）
  ctx.beginPath();
  ctx.moveTo(cE.x, cE.y);
  ctx.lineTo(cS.x, cS.y);
  ctx.lineTo(cS.x, cS.y + depthPx);
  ctx.lineTo(cE.x, cE.y + depthPx);
  ctx.closePath();
  const gR = ctx.createLinearGradient(cE.x, cE.y, cS.x, cS.y + depthPx);
  gR.addColorStop(0, 'rgba(48,40,30,0.98)');
  gR.addColorStop(0.5, 'rgba(38,32,24,0.98)');
  gR.addColorStop(1, 'rgba(26,22,16,0.98)');
  ctx.fillStyle = gR;
  ctx.fill();

  // 左侧壁（S→W 的下沿）
  ctx.beginPath();
  ctx.moveTo(cS.x, cS.y);
  ctx.lineTo(cW.x, cW.y);
  ctx.lineTo(cW.x, cW.y + depthPx);
  ctx.lineTo(cS.x, cS.y + depthPx);
  ctx.closePath();
  const gL = ctx.createLinearGradient(cS.x, cS.y, cW.x, cW.y + depthPx);
  gL.addColorStop(0, 'rgba(30,25,19,0.98)');
  gL.addColorStop(1, 'rgba(20,17,13,0.98)');
  ctx.fillStyle = gL;
  ctx.fill();

  // 南角竖楞：最靠前的那条边，加一道亮线强调厚度转角
  ctx.beginPath();
  ctx.moveTo(cS.x, cS.y);
  ctx.lineTo(cS.x, cS.y + depthPx);
  ctx.strokeStyle = 'rgba(229,189,125,0.20)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 底部收边：比壁面更暗一线，制造"侵入地面"的落影
  ctx.beginPath();
  ctx.moveTo(cW.x, cW.y + depthPx);
  ctx.lineTo(cS.x, cS.y + depthPx);
  ctx.lineTo(cE.x, cE.y + depthPx);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.restore();
}

/**
 * 边界外深渊：在地图菱形之外画一层向外衰减的暗色，
 * 让"地图浮在深渊上"而不是"贴在一块黑布上"。
 * 做法：先用菱形路径 + 反向 even-odd 填充整屏，再叠径向渐变压暗外缘。
 */
export function drawAbyss(
  ctx: CanvasRenderingContext2D,
  proj: Projector,
  mapW: number,
  mapH: number,
  w: number,
  h: number,
) {
  const cN = proj.p(0, 0), cE = proj.p(mapW, 0), cS = proj.p(mapW, mapH), cW = proj.p(0, mapH);
  // 地图重心（用于径向渐变的圆心）
  const cx = (cN.x + cS.x) / 2;
  const cy = (cN.y + cS.y) / 2;
  // 从地图边界到屏幕角落的距离
  const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));

  ctx.save();
  // even-odd：整屏减去地图菱形
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.moveTo(cN.x, cN.y); ctx.lineTo(cE.x, cE.y); ctx.lineTo(cS.x, cS.y); ctx.lineTo(cW.x, cW.y);
  ctx.closePath();
  ctx.clip('evenodd');

  // 以地图中心为源的径向渐变：近处透明、远处渐深再回一点（避免实黑）
  const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.18, cx, cy, far);
  g.addColorStop(0, 'rgba(6,4,3,0.00)');
  g.addColorStop(0.45, 'rgba(6,4,3,0.30)');
  g.addColorStop(0.80, 'rgba(8,5,4,0.52)');
  g.addColorStop(1, 'rgba(10,7,5,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * 地板光照带：沿地图对角线方向打一条柔和的高光，制造"火把斜照"的体积感。
 * 纯色棋盘格最大的问题是平坦 —— 一条带方向的亮度梯度就能救回大半。
 * 只在 detailFloor 时调用，alpha 极低不干扰格线。
 */
export function drawFloorLightSweep(
  ctx: CanvasRenderingContext2D,
  proj: Projector,
  mapW: number,
  mapH: number,
) {
  // 从地图左上角到右下角的投影线方向
  const a = proj.p(0, 0);
  const b = proj.p(mapW, mapH);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // 沿 (dy, -dx) 法线方向偏移，形成斜向渐变
  const nx = dy / len, ny = -dx / len;
  const halfSpan = Math.max(mapW, mapH) * TILE_W * proj.scale * 0.55;
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;

  const g = ctx.createLinearGradient(
    cx + nx * halfSpan, cy + ny * halfSpan,
    cx - nx * halfSpan, cy - ny * halfSpan,
  );
  g.addColorStop(0, 'rgba(255,224,170,0.14)');
  g.addColorStop(0.42, 'rgba(255,214,150,0.062)');
  g.addColorStop(1, 'rgba(0,0,0,0.105)');

  // 只在地图菱形内生效：用边界路径做 clip
  const cN = proj.p(0, 0), cE = proj.p(mapW, 0), cS = proj.p(mapW, mapH), cW = proj.p(0, mapH);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cN.x, cN.y); ctx.lineTo(cE.x, cE.y); ctx.lineTo(cS.x, cS.y); ctx.lineTo(cW.x, cW.y);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
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
  ctx.strokeStyle = STAGE_PALETTE.plateBorder;
  ctx.lineWidth = 1;
  roundRect(ctx, x - w / 2 - 1, y - 1, w + 2, h + 2, 2.5 * scale);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = hpColor(r);
  roundRect(ctx, x - w / 2, y, Math.max(0, w * r), h, 1.8 * scale);
  ctx.fill();
  if (text) {
    ctx.font = `bold ${Math.max(9, 10 * scale)}px ${CJK_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y - 2);
    ctx.fillStyle = STAGE_PALETTE.ink;
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
  ctx.font = `bold ${fontSize * scale}px ${CJK_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ============ 名牌卡（名字 + 常显血条 + 状态行） ============

export interface NameplateStatus { icon: string; color: string }
export interface NameplateInfo {
  /** 已含 ★/👤/🤖 等前后的完整显示名 */
  name: string;
  nameColor: string;
  hp: number;
  maxHp: number;
  statuses: NameplateStatus[];
  variant: 'current' | 'selected' | 'default';
}

const PLATE_FONT = `bold 11px ${CJK_FONT}`;
const PLATE_PAD_X = 7;
const PLATE_PAD_Y = 5;
const PLATE_NAME_ROW = 14;
const PLATE_GAP = 4;
const PLATE_BAR_W = 56;
const PLATE_BAR_H = 7; // 槽高（含 1px 内边）= 9px
const PLATE_STATUS_ROW = 13;

/**
 * 先量后画：布局（宽度截断长名）必须在放置避让前完成。
 * 名牌为屏幕空间恒定尺寸，不随缩放缩小，保证低倍率下可读。
 */
export function plateLayout(ctx: CanvasRenderingContext2D, info: NameplateInfo): { w: number; h: number; label: string } {
  ctx.save();
  ctx.font = PLATE_FONT;
  const maxTextW = 118 - PLATE_PAD_X * 2;
  const fullW = ctx.measureText(info.name).width;
  const w = Math.max(64, Math.min(118, Math.ceil(fullW) + PLATE_PAD_X * 2));
  let label = info.name;
  if (fullW > maxTextW) {
    while (label.length > 1 && ctx.measureText(`${label}…`).width > maxTextW) label = label.slice(0, -1);
    label = `${label}…`;
  }
  ctx.restore();
  const h = PLATE_PAD_Y + PLATE_NAME_ROW + PLATE_GAP + PLATE_BAR_H + 2
    + (info.statuses.length > 0 ? PLATE_GAP + PLATE_STATUS_ROW : 0) + PLATE_PAD_Y;
  return { w, h, label };
}

export function drawNameplate(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  topY: number,
  info: NameplateInfo,
  w: number,
  h: number,
  label: string,
) {
  const x = centerX - w / 2;
  ctx.save();
  ctx.fillStyle = STAGE_PALETTE.plateBg;
  roundRect(ctx, x, topY, w, h, 6);
  ctx.fill();
  if (info.variant === 'current') {
    ctx.strokeStyle = STAGE_PALETTE.plateBorderCurrent;
    ctx.shadowColor = 'rgba(229,189,125,0.45)';
    ctx.shadowBlur = 7;
  } else if (info.variant === 'selected') {
    ctx.strokeStyle = STAGE_PALETTE.plateBorderSelected;
  } else {
    ctx.strokeStyle = STAGE_PALETTE.plateBorder;
  }
  ctx.lineWidth = 1;
  roundRect(ctx, x, topY, w, h, 6);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 名字行
  ctx.font = PLATE_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const nameY = topY + PLATE_PAD_Y + PLATE_NAME_ROW / 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 3;
  ctx.strokeText(label, centerX, nameY);
  ctx.fillStyle = info.nameColor;
  ctx.fillText(label, centerX, nameY);

  // HP 条行（数字常显）
  const barY = topY + PLATE_PAD_Y + PLATE_NAME_ROW + PLATE_GAP;
  const barX = centerX - PLATE_BAR_W / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, barX, barY, PLATE_BAR_W, PLATE_BAR_H + 2, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(229,189,125,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  const ratio = info.maxHp > 0 ? Math.max(0, Math.min(1, info.hp / info.maxHp)) : 0;
  if (ratio > 0) {
    ctx.fillStyle = hpColor(ratio);
    roundRect(ctx, barX + 1, barY + 1, Math.max(2, (PLATE_BAR_W - 2) * ratio), PLATE_BAR_H, 2);
    ctx.fill();
  }
  ctx.font = `bold 9px ${CJK_FONT}`;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 2.5;
  const hpText = `${Math.max(0, info.hp)}/${info.maxHp}`;
  const barCY = barY + (PLATE_BAR_H + 2) / 2;
  ctx.strokeText(hpText, centerX, barCY);
  ctx.fillStyle = STAGE_PALETTE.ink;
  ctx.fillText(hpText, centerX, barCY);

  // 状态图标行
  if (info.statuses.length > 0) {
    const rowY = barY + PLATE_BAR_H + 2 + PLATE_GAP + PLATE_STATUS_ROW / 2;
    ctx.font = `11px ${CJK_FONT}`;
    const n = info.statuses.length;
    info.statuses.forEach((st, i) => {
      const ix = centerX + (i - (n - 1) / 2) * 15;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeText(st.icon, ix, rowY);
      ctx.fillStyle = st.color;
      ctx.fillText(st.icon, ix, rowY);
    });
  }
  ctx.restore();
}

/** 当前行动者聚光：地面金色柔光（椭圆压扁贴地，随脉冲呼吸） */
export function drawSpotlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  radius: number,
  alpha: number,
) {
  if (alpha <= 0.01 || radius <= 1) return;
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(1, 0.5);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  g.addColorStop(0, `rgba(245,197,66,${alpha})`);
  g.addColorStop(0.55, `rgba(245,197,66,${alpha * 0.4})`);
  g.addColorStop(1, 'rgba(245,197,66,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
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
  ctx.font = `bold ${(big ? 21 : 15)}px ${CJK_FONT}`;
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
  ctx.font = `bold ${11 * Math.max(0.8, scale)}px ${CJK_FONT}`;
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
