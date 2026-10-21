/**
 * 地图几何引擎：网格换算、距离、AoE 形状判定、A* 寻路、视线/掩护
 * 坐标约定：内部一律用英尺（协议 pos 也是英尺），1 格 = cellSize(5) 英尺
 */
import type { Cell, MapObstacle, AoeTemplate, BattleUnit, MapConfig, AoeShapeKind } from './types';
import { SIZE_META } from './types';

export const CELL = 5; // 每格英尺

// ---------- 换算 ----------

export function feetToCell(v: number): number {
  return Math.round(v / CELL);
}

export function cellToFeet(c: number): number {
  return c * CELL;
}

/** 英尺坐标 → 格坐标 */
export function posToCell(pos: { x: number; y: number }): Cell {
  return { cx: feetToCell(pos.x), cy: feetToCell(pos.y) };
}

/** 单位占据的格子（按体型，pos 为左上角锚点） */
export function unitOccupiedCells(unit: BattleUnit): Cell[] {
  const { cx, cy } = posToCell(unit.pos);
  const span = SIZE_META[unit.size]?.cells ?? 1;
  const cells: Cell[] = [];
  for (let dx = 0; dx < span; dx++) {
    for (let dy = 0; dy < span; dy++) {
      cells.push({ cx: cx + dx, cy: cy + dy });
    }
  }
  return cells;
}

export function cellKey(c: Cell): string {
  return `${c.cx},${c.cy}`;
}

export function cellCenter(c: Cell): { x: number; y: number } {
  return { x: cellToFeet(c.cx) + CELL / 2, y: cellToFeet(c.cy) + CELL / 2 };
}

// ---------- 距离 ----------

/** 两点直线距离（英尺） */
export function euclideanDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 网格距离：D&D 战术规则（用于攻击距离/移动消耗）
 *  equal: 对角线算 5 尺（2024 默认）→ 切比雪夫距离：斜向+直向步数 = max(dx,dy)
 *  alt:   5-10-5 交替（DMG 变体）
 */
export function gridDistanceCells(from: Cell, to: Cell, diagonal: 'equal' | 'alt' = 'equal'): number {
  const dx = Math.abs(to.cx - from.cx);
  const dy = Math.abs(to.cy - from.cy);
  const straight = Math.abs(dx - dy);
  const diagonalCount = Math.min(dx, dy);
  if (diagonal === 'equal') return straight + diagonalCount; // = max(dx, dy)
  // 5-10-5：每两个对角算 3 格（15尺）
  return straight + diagonalCount + Math.floor(diagonalCount / 2);
}

export function gridDistanceFeet(from: Cell, to: Cell, diagonal: 'equal' | 'alt' = 'equal'): number {
  return gridDistanceCells(from, to, diagonal) * CELL;
}

/** 两单位间距离（格距离，取锚点） */
export function unitDistance(a: BattleUnit, b: BattleUnit, diagonal: 'equal' | 'alt' = 'equal'): number {
  return gridDistanceFeet(posToCell(a.pos), posToCell(b.pos), diagonal);
}

/** 是否在近战触及范围内（默认 5 尺；大型+） */
export function inMeleeRange(a: BattleUnit, b: BattleUnit, reach = 5, diagonal: 'equal' | 'alt' = 'equal'): boolean {
  // 大型单位占据多格：检查任意占据格之间距离
  const aCells = unitOccupiedCells(a);
  const bCells = unitOccupiedCells(b);
  const maxCells = Math.ceil(reach / CELL);
  for (const ca of aCells) {
    for (const cb of bCells) {
      if (gridDistanceCells(ca, cb, diagonal) <= maxCells) return true;
    }
  }
  return false;
}

// ---------- 占用与阻挡 ----------

export function buildOccupancy(units: BattleUnit[], excludeUnitId?: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of units) {
    if (u.id === excludeUnitId) continue;
    for (const c of unitOccupiedCells(u)) map.set(cellKey(c), u.id);
  }
  return map;
}

export function buildBlockedCells(obstacles: MapObstacle[]): Map<string, MapObstacle['kind']> {
  const map = new Map<string, MapObstacle['kind']>();
  for (const o of obstacles) {
    for (const c of o.cells) map.set(cellKey(c), o.kind);
  }
  return map;
}

// ---------- A* 寻路（移动范围计算） ----------

export interface PathResult {
  path: Cell[];
  costCells: number; // 总格数（含对角规则折算）
  reachable: boolean;
}

/** 移动模式选项（E13）：飞行单位忽略 'full' 完全阻挡地形——直线移动不绕障；
 *  单位占位（敌方可穿不可停）校验保持不变 */
export interface MoveOptions {
  ignoreFullObstacles?: boolean;
  mapWidth?: number;
  mapHeight?: number;
}

export function movementStepCost(from: Cell, to: Cell, unit: BattleUnit, units: BattleUnit[], obstacles: MapObstacle[], diagonal: 'equal' | 'alt', diagonalSteps: number, opts: MoveOptions = {}) {
  const diagonalStep = from.cx !== to.cx && from.cy !== to.cy;
  const cells = unitOccupiedCells({ ...unit, pos: { x: to.cx * CELL, y: to.cy * CELL } });
  const difficult = !opts.ignoreFullObstacles && cells.some(c => obstacles.some(o => o.kind === 'difficult' && o.cells.some(x => cellKey(x) === cellKey(c))));
  const allySpace = units.some(u => u.id !== unit.id && unitOccupiedCells(u).some(c => cells.some(x => cellKey(x) === cellKey(c))));
  const base = diagonalStep && diagonal === 'alt' && diagonalSteps % 2 === 1 ? 2 : 1;
  return { feet: base * CELL * (difficult || allySpace ? 2 : 1), diagonalStep };
}

function movementSearch(from: Cell, unit: BattleUnit, units: BattleUnit[], obstacles: MapObstacle[], diagonal: 'equal' | 'alt', budget: number, opts: MoveOptions, target?: Cell) {
  const blocked = opts.ignoreFullObstacles ? new Map<string, MapObstacle['kind']>() : buildBlockedCells(obstacles);
  const occupied = buildOccupancy(units, unit.id);
  const span = SIZE_META[unit.size]?.cells ?? 1;
  const startParity = (unit.actionEconomy?.diagonalSteps ?? 0) % 2;
  const stateKey = (c: Cell, parity: number) => `${cellKey(c)}:${parity}`;
  const inBounds = (c: Cell) => (opts.mapWidth === undefined || (c.cx >= 0 && c.cx + span <= opts.mapWidth)) && (opts.mapHeight === undefined || (c.cy >= 0 && c.cy + span <= opts.mapHeight));
  const canPass = (c: Cell, stop = false) => {
    if (!inBounds(c)) return false;
    for (const cell of unitOccupiedCells({ ...unit, pos: { x: c.cx * CELL, y: c.cy * CELL } })) {
      const k = cellKey(cell);
      if (blocked.get(k) === 'full') return false;
      const id = occupied.get(k);
      if (id && (stop || units.find(u => u.id === id)?.attitude !== unit.attitude)) return false;
    }
    return true;
  };
  if (target && !canPass(target, true)) return { result: new Map<string, number>(), path: [] as Cell[] };
  const startKey = stateKey(from, startParity);
  const costs = new Map<string, number>([[startKey, 0]]);
  const parents = new Map<string, string>();
  const result = new Map<string, number>([[cellKey(from), 0]]);
  const bestKeys = new Map<string, string>([[cellKey(from), startKey]]);
  const queue = [{ cell: from, parity: startParity, cost: 0 }];
  let visited = 0;
  while (queue.length && visited++ < 30000) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    const key = stateKey(current.cell, current.parity);
    if (current.cost !== costs.get(key)) continue;
    if (target && cellKey(current.cell) === cellKey(target)) break;
    for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const next = { cx: current.cell.cx + dx, cy: current.cell.cy + dy };
      if (!canPass(next)) continue;
      if (dx && dy && !canPass({ cx: next.cx, cy: current.cell.cy }) && !canPass({ cx: current.cell.cx, cy: next.cy })) continue;
      const step = movementStepCost(current.cell, next, unit, units, obstacles, diagonal, current.parity, opts);
      const cost = current.cost + step.feet;
      if (cost > budget) continue;
      const parity = diagonal === 'alt' && step.diagonalStep ? 1 - current.parity : current.parity;
      const nextKey = stateKey(next, parity);
      if (cost >= (costs.get(nextKey) ?? Infinity)) continue;
      costs.set(nextKey, cost); parents.set(nextKey, key);
      const cell = cellKey(next);
      if (cost < (result.get(cell) ?? Infinity)) { result.set(cell, cost); bestKeys.set(cell, nextKey); }
      queue.push({ cell: next, parity, cost });
    }
  }
  const path: Cell[] = [];
  if (target && canPass(target, true)) {
    let key = bestKeys.get(cellKey(target));
    while (key) {
      const [cx, cy] = key.split(':')[0].split(',').map(Number);
      path.unshift({ cx, cy }); key = parents.get(key);
    }
  }
  return { result, path };
}

/** Path and reachable map share the same costs, terrain, footprint and alternating diagonal state. */
export function findPath(from: Cell, to: Cell, units: BattleUnit[], obstacles: MapObstacle[], movingUnit: BattleUnit, diagonal: 'equal' | 'alt' = 'equal', opts: MoveOptions = {}): PathResult {
  if (![from.cx, from.cy, to.cx, to.cy].every(Number.isFinite)) return { path: [], costCells: Infinity, reachable: false };
  if (cellKey(from) === cellKey(to)) return { path: [from], costCells: 0, reachable: true };
  if (gridDistanceCells(from, to, diagonal) > 1000) return { path: [], costCells: Infinity, reachable: false };
  const search = movementSearch(from, movingUnit, units, obstacles, diagonal, 5000, opts, to);
  const reachable = search.path.length > 0;
  return { path: search.path, costCells: reachable ? search.result.get(cellKey(to))! / CELL : Infinity, reachable };
}

export function reachableCells(unit: BattleUnit, units: BattleUnit[], obstacles: MapObstacle[], movementFeet: number, diagonal: 'equal' | 'alt' = 'equal', opts: MoveOptions = {}): Map<string, number> {
  const search = movementSearch(posToCell(unit.pos), unit, units, obstacles, diagonal, Math.min(Math.max(0, movementFeet), 2500), opts);
  return new Map([...search.result].map(([key, cost]) => [key, cost / CELL]));
}

// ---------- 视线与掩护 ----------

/** 布雷森汉姆直线采样（格） */
export function lineCells(from: Cell, to: Cell): Cell[] {
  const cells: Cell[] = [];
  let x = from.cx, y = from.cy;
  const dx = Math.abs(to.cx - from.cx), dy = Math.abs(to.cy - from.cy);
  const sx = from.cx < to.cx ? 1 : -1, sy = from.cy < to.cy ? 1 : -1;
  let err = dx - dy;
  let guard = 0;
  while (guard++ < 500) {
    cells.push({ cx: x, cy: y });
    if (x === to.cx && y === to.cy) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return cells;
}

/** 掩护判定：攻击者→目标连线穿越的阻挡格数量
 *  0=无掩护 1=半身(+2) 2+=四分之三(+5)，全阻挡=完全掩护 */
export function estimateCover(
  attacker: BattleUnit,
  target: BattleUnit,
  obstacles: MapObstacle[],
  occupiedCells: Map<string, MapObstacle['kind']>,
): { cover: 'none' | 'half' | 'threeQuarters' | 'full'; blockingCells: Cell[]; bonus: number } {
  const from = posToCell(attacker.pos);
  const targetCells = unitOccupiedCells(target);
  // 取最佳视线（掩护最少的一条）
  let best: { cover: 'none' | 'half' | 'threeQuarters' | 'full'; blockingCells: Cell[]; bonus: number } = {
    cover: 'full', blockingCells: [], bonus: 0,
  };
  for (const tc of targetCells) {
    const cells = lineCells(from, tc).slice(1, -1); // 排除起点终点
    let half = 0, full = 0;
    const blocking: Cell[] = [];
    for (const c of cells) {
      const kind = occupiedCells.get(cellKey(c));
      if (kind === 'full') { full++; blocking.push(c); }
      else if (kind === 'half' || kind === 'threeQuarters') { half += kind === 'threeQuarters' ? 2 : 1; blocking.push(c); }
    }
    let cover: 'none' | 'half' | 'threeQuarters' | 'full';
    let bonus = 0;
    if (full >= 1) { cover = 'full'; }
    else if (half >= 2) { cover = 'threeQuarters'; bonus = 5; }
    else if (half === 1) { cover = 'half'; bonus = 2; }
    else cover = 'none';
    const rank = { none: 0, half: 1, threeQuarters: 2, full: 3 } as const;
    if (rank[cover] < rank[best.cover]) best = { cover, blockingCells: blocking, bonus };
  }
  return best;
}

// ---------- AoE 形状 ----------

export interface AoeResult {
  cells: Cell[];
  affectedUnitIds: string[];
  areaFeet: number;
}

/** 枚举 AoE 形状覆盖的格子（以格中心是否在形状内判定，标准做法） */
export function aoeCells(
  template: AoeTemplate,
  units: BattleUnit[],
): AoeResult {
  const o = template.origin;
  const cells: Cell[] = [];
  // 反 DoS：AoE 半径钳制 [0, 2000] 尺（400 格；合法法术最大 ~100 尺半径，
  // 恶意 size=1e9 会在格枚举中冻结 UI）
  const size = Math.min(Math.max(template.size, 0), 2000);
  // 半径扩半格容差（格中心在边缘内）
  const tol = CELL * 0.501;
  const maxRange = size + (template.kind === 'cone' || template.kind === 'line' ? 0 : 0) + CELL * 2;
  const c0 = posToCell(o);
  const scan = Math.ceil(maxRange / CELL) + 2;

  for (let cx = c0.cx - scan; cx <= c0.cx + scan; cx++) {
    for (let cy = c0.cy - scan; cy <= c0.cy + scan; cy++) {
      const center = cellCenter({ cx, cy });
      let inside = false;
      switch (template.kind) {
        case 'circle': case 'sphere': {
          inside = euclideanDistance(center, o) <= size + tol;
          break;
        }
        case 'cylinder': {
          // 圆柱：底面圆 + 高度（格子层面同圆）
          inside = euclideanDistance(center, o) <= size + tol;
          break;
        }
        case 'cube': case 'square': {
          // 边长 size 的正方形，origin 为角/中心（取中心）
          const half = size / 2;
          inside = Math.abs(center.x - o.x) <= half + tol && Math.abs(center.y - o.y) <= half + tol;
          break;
        }
        case 'line': {
          // 从 origin 向 angle 方向延伸 size 长度，宽 5 尺
          const dx = center.x - o.x, dy = center.y - o.y;
          const len = Math.hypot(dx, dy);
          if (len <= size + tol) {
            const ang = Math.atan2(dy, dx);
            let diff = Math.abs(ang - (template.angle ?? 0));
            while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
            // 线宽 5 尺：垂直距离 <= 2.5
            const sinA = Math.sin(template.angle ?? 0), cosA = Math.cos(template.angle ?? 0);
            const along = dx * cosA + dy * sinA;
            const perp = Math.abs(-dx * sinA + dy * cosA);
            inside = along >= -tol && along <= size + tol && perp <= tol;
          }
          break;
        }
        case 'cone': {
          // 原点向 angle 方向展开 size 长度，60° 锥
          const dx = center.x - o.x, dy = center.y - o.y;
          const len = Math.hypot(dx, dy);
          if (len <= size + tol) {
            const ang = Math.atan2(dy, dx);
            let diff = Math.abs(ang - (template.angle ?? 0));
            while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
            inside = diff <= Math.PI / 6 + 0.02; // 60° 锥 → ±30°
          }
          break;
        }
      }
      if (inside) cells.push({ cx, cy });
    }
  }

  // 影响的单位：任意占据格在形状内
  const cellSet = new Set(cells.map(cellKey));
  const affectedUnitIds: string[] = [];
  for (const u of units) {
    if (u.statuses.includes('dead')) continue;
    if (unitOccupiedCells(u).some(c => cellSet.has(cellKey(c)))) {
      affectedUnitIds.push(u.id);
    }
  }
  return { cells, affectedUnitIds, areaFeet: cells.length * CELL * CELL };
}

/** 常用法术 AoE 预设 */
export const AOE_PRESETS: Array<{
  label: string; kind: AoeShapeKind; size: number; color: string; note: string;
}> = [
  { label: '火球术', kind: 'sphere', size: 20, color: 'rgba(240,120,40,0.35)', note: '3环·半径20尺球体·敏捷豁免' },
  { label: '燃烧之手', kind: 'cone', size: 15, color: 'rgba(250,160,50,0.35)', note: '1环·15尺锥形·敏捷豁免' },
  { label: '雷鸣波', kind: 'cube', size: 15, color: 'rgba(120,170,250,0.35)', note: '1环·15尺立方·体质豁免' },
  { label: '闪电束', kind: 'line', size: 100, color: 'rgba(130,220,250,0.35)', note: '3环·100尺直线·敏捷豁免' },
  { label: '臭云术', kind: 'sphere', size: 20, color: 'rgba(140,200,120,0.3)', note: '3环·半径20尺·体质豁免' },
  { label: '冰风暴', kind: 'cylinder', size: 20, color: 'rgba(160,220,240,0.35)', note: '4环·半径20尺圆柱·敏捷豁免' },
  { label: '油腻术', kind: 'square', size: 10, color: 'rgba(220,200,110,0.3)', note: '1环·10尺方格·敏捷豁免' },
  { label: '5尺爆发', kind: 'circle', size: 5, color: 'rgba(200,200,220,0.3)', note: '近战顺劈范围' },
  { label: '10尺爆发', kind: 'circle', size: 10, color: 'rgba(200,200,220,0.3)', note: '十字顺劈' },
];
