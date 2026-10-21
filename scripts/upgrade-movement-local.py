from pathlib import Path
root = Path(__file__).resolve().parents[1]
p = root / 'src/lib/engine/geometry.ts'
text = p.read_text(encoding='utf-8')
start = text.index('export interface MoveOptions')
end = text.index('// ---------- 视线与掩护 ----------', start)
text = text[:start] + '''export interface MoveOptions {
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
  const startParity = (unit.actionEconomy.diagonalSteps ?? 0) % 2;
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

''' + text[end:]
text = text.replace("else if (kind === 'half' || kind === 'threeQuarters') { half++;", "else if (kind === 'half' || kind === 'threeQuarters') { half += kind === 'threeQuarters' ? 2 : 1;")
p.write_text(text, encoding='utf-8')
p = root / 'src/lib/engine/types.ts'
text = p.read_text(encoding='utf-8').replace('  movementUsed: number;', '  movementUsed: number;\n  diagonalSteps?: number;')
text = text.replace("kind: 'half' | 'threeQuarters' | 'full';", "kind: 'half' | 'threeQuarters' | 'full' | 'difficult';")
p.write_text(text, encoding='utf-8')
p = root / 'src/lib/engine/ai.ts'
text = p.read_text(encoding='utf-8')
text = text.replace('{ ignoreFullObstacles: fly }', '{ ignoreFullObstacles: fly, mapWidth: ctx.mapWidth, mapHeight: ctx.mapHeight }')
text = text.replace('return dist <= ability.range + CELL;', 'return dist <= ability.range;').replace('return dist <= Math.max(ability.range, 5) + CELL;', 'return dist <= ability.range;')
text = text.replace('if (e.actionEconomy.reaction) continue;', "if (e.actionEconomy.reaction || e.statuses.includes('blinded') || (mover.statuses.includes('invisible') && !e.notes.includes('盲视') && !e.notes.includes('真实视觉'))) continue;")
text = text.replace('const wasIn = eCells.some(ec => gridDistanceCells(ec, fromCell, ctx.diagonal) <= reach);', 'const wasIn = eCells.some(ec => unitOccupiedCells({ ...mover, pos: { x: fromCell.cx * CELL, y: fromCell.cy * CELL } }).some(mc => gridDistanceCells(ec, mc, ctx.diagonal) <= reach));')
text = text.replace('const stillIn = eCells.some(ec => gridDistanceCells(ec, toCell, ctx.diagonal) <= reach);', 'const stillIn = eCells.some(ec => unitOccupiedCells({ ...mover, pos: { x: toCell.cx * CELL, y: toCell.cy * CELL } }).some(mc => gridDistanceCells(ec, mc, ctx.diagonal) <= reach));')
# Candidate scoring counts self/downed friends as costs; execution recomputes the entire affected set.
text = text.replace('if (!u || u.hp <= 0 || u.deathSaves?.dead) continue;\n        if (u.id === unit.id) continue;', 'if (!u || u.deathSaves?.dead) continue;\n        if (u.id === unit.id && ability.excludeSelf) continue;')
p.write_text(text, encoding='utf-8')
