/**
 * 快照与 diff：跨回合对比（移动轨迹 / HP 变化 / 状态增减）
 */
import type { BattleSnapshot, SnapshotDiff, UnitDiff, BattleUnit } from './types';
import { parseBattleBlock, type ParsedBattleUnit } from './protocol';

/** 从协议单位生成快照 */
export function snapshotFromParsed(units: ParsedBattleUnit[], source: BattleSnapshot['source'] = 'embed'): BattleSnapshot {
  return {
    ts: Date.now(),
    source,
    units: units.map(u => ({
      id: u.id,
      init: u.init ?? 0,
      hp: u.hp?.current ?? 0,
      maxHp: u.hp?.max ?? u.hp?.current ?? 0,
      pos: u.pos ?? { x: 0, y: 0 },
      attitude: u.attitude,
      statuses: [...u.statuses],
    })),
  };
}

export function snapshotFromUnits(units: BattleUnit[], source: BattleSnapshot['source'] = 'manual'): BattleSnapshot {
  return {
    ts: Date.now(),
    source,
    units: units
      .filter(u => !u.deathSaves?.dead)
      .map(u => ({
        id: u.id,
        init: u.init,
        hp: u.hp,
        maxHp: u.maxHp,
        pos: { ...u.pos },
        attitude: u.attitude,
        statuses: [...u.statuses],
      })),
  };
}

/** 比较两个快照 */
export function diffSnapshots(prev: BattleSnapshot | null, next: BattleSnapshot): SnapshotDiff {
  if (!prev) {
    return {
      prevTs: null,
      nextTs: next.ts,
      unitDiffs: next.units.map(u => ({
        id: u.id, hpDelta: 0, posDelta: null,
        addedStatuses: [], removedStatuses: [],
        isNew: true, removed: false, died: false, revived: false,
      })),
    };
  }
  const prevMap = new Map(prev.units.map(u => [u.id, u]));
  const nextMap = new Map(next.units.map(u => [u.id, u]));
  const diffs: UnitDiff[] = [];

  for (const u of next.units) {
    const p = prevMap.get(u.id);
    if (!p) {
      diffs.push({
        id: u.id, hpDelta: 0, posDelta: null,
        addedStatuses: [], removedStatuses: [],
        isNew: true, removed: false, died: false, revived: false,
      });
      continue;
    }
    const hpDelta = u.hp - p.hp;
    const posDelta = (u.pos.x !== p.pos.x || u.pos.y !== p.pos.y)
      ? { x: u.pos.x - p.pos.x, y: u.pos.y - p.pos.y }
      : null;
    const added = u.statuses.filter(s => !p.statuses.includes(s));
    const removed = p.statuses.filter(s => !u.statuses.includes(s));
    diffs.push({
      id: u.id, hpDelta, posDelta, addedStatuses: added, removedStatuses: removed,
      isNew: false, removed: false,
      died: p.hp > 0 && u.hp <= 0,
      revived: p.hp <= 0 && u.hp > 0,
    });
  }
  for (const p of prev.units) {
    if (!nextMap.has(p.id)) {
      diffs.push({
        id: p.id, hpDelta: 0, posDelta: null,
        addedStatuses: [], removedStatuses: [],
        isNew: false, removed: true, died: false, revived: false,
      });
    }
  }
  return { prevTs: prev.ts, nextTs: next.ts, unitDiffs: diffs };
}

// ---------- 快照历史存储（localStorage，嵌入模式跨消息共享） ----------

const HISTORY_KEY = 'dnd-battle-history';
const MAX_HISTORY = 120;

export function loadHistory(): BattleSnapshot[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function appendHistory(snap: BattleSnapshot): BattleSnapshot[] {
  const history = loadHistory();
  history.push(snap);
  while (history.length > MAX_HISTORY) history.shift();
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch { /* 配额满时静默 */ }
  return history;
}

/** 取某快照时间戳之前最近的一条（用于 diff 轨迹） */
export function findPrevSnapshot(ts: number): BattleSnapshot | null {
  const history = loadHistory();
  let prev: BattleSnapshot | null = null;
  for (const s of history) {
    if (s.ts < ts) prev = s;
  }
  return prev;
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch { /* noop */ }
}
