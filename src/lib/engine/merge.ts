/**
 * 协议单位 → 引擎单位 合并层（纯函数，供 store 委托与引擎测试）
 *
 * 权威语义（authorityMode）：
 * - protectRuntime=false（战前暂存 / ai-legacy 兼容旧卡）：
 *     AI 块数值直入——HP/位置/先攻/状态全以 AI 给定值为准（旧卡每楼结算流的显示层语义）
 * - protectRuntime=true（战斗进行中 + 面板权威）：
 *     AI 块是过期快照（AI 并不知道面板已结算的伤亡/移动/先攻掷骰），
 *     运行时字段保留面板值；状态取并集（AI 可叙事新增，不能移除面板结算状态）
 */
import type { BattleUnit } from './types';
import type { ParsedBattleUnit } from './protocol';

export function defaultActionEconomy() {
  return { action: false, bonus: false, reaction: false, movementUsed: 0 };
}

export interface MergeRuntimeConflict {
  id: string;
  field: 'hp' | 'pos' | 'init';
  aiValue: string;
  panelValue: string;
}

export interface MergeUnitResult {
  unit: BattleUnit;
  /** 面板权威模式下被拦截的数值冲突（用于日志警告） */
  conflicts: MergeRuntimeConflict[];
}

/**
 * 将协议单位合并为引擎单位。
 * @param existing 已存在的引擎单位（undefined = 新入场）
 * @param p        协议解析结果
 * @param protectRuntime 战斗进行中且面板权威时为 true（保护运行时字段）
 */
export function mergeUnitFromProtocol(
  existing: BattleUnit | undefined,
  p: ParsedBattleUnit,
  protectRuntime = false,
): MergeUnitResult {
  const conflicts: MergeRuntimeConflict[] = [];

  if (!existing) {
    // 新单位：合理默认值（玩家判定：友方且 ID 含「你/玩家/player」）；dataSource 标记待自动配装
    const hp = p.hp?.current ?? 10;
    const maxHp = p.hp?.max ?? hp;
    const isPlayer = p.attitude === 0 && /你|玩家|player/i.test(p.id);
    const unit: BattleUnit = {
      id: p.id,
      name: p.id,
      dataSource: 'ai-parsed',
      init: p.init ?? 10,
      initMod: 0,
      initRolled: false,
      hp,
      maxHp,
      tempHp: 0,
      ac: 13,
      speed: 30,
      pos: p.pos ?? { x: 0, y: 0 },
      attitude: p.attitude,
      statuses: [...p.statuses],
      portrait: p.portrait,
      isPlayer,
      playerControlled: isPlayer,
      aiProfile: 'tactical',
      aiAbilities: [{
        id: 'unarmed', name: '徒手打击', kind: 'melee',
        attackBonus: 2, dice: '1d4', damageType: 'bludgeoning', range: 5, multiAttack: 1,
      }],
      size: 'medium',
      resistances: [],
      immunities: [],
      vulnerabilities: [],
      actionEconomy: defaultActionEconomy(),
      hasActed: !p.next,
      notes: '',
    };
    return { unit, conflicts };
  }

  if (protectRuntime) {
    // ---- 面板权威：数值保留面板结算，AI 块仅作展示性更新 ----
    if (p.hp?.current !== undefined && p.hp.current !== existing.hp) {
      conflicts.push({ id: existing.id, field: 'hp', aiValue: `${p.hp.current}/${p.hp.max ?? p.hp.current}`, panelValue: `${existing.hp}/${existing.maxHp}` });
    }
    if (p.pos && (Math.round(p.pos.x) !== Math.round(existing.pos.x) || Math.round(p.pos.y) !== Math.round(existing.pos.y))) {
      conflicts.push({ id: existing.id, field: 'pos', aiValue: `${p.pos.x},${p.pos.y}`, panelValue: `${existing.pos.x},${existing.pos.y}` });
    }
    if (p.init !== undefined && p.init !== existing.init) {
      conflicts.push({ id: existing.id, field: 'init', aiValue: String(p.init), panelValue: String(existing.init) });
    }
    // 状态并集：AI 可新增叙事状态（如恐惧、中毒来源描述），不能删除面板结算状态
    const statuses = [...existing.statuses];
    for (const s of p.statuses) {
      if (!statuses.includes(s)) statuses.push(s);
    }
    return {
      unit: {
        ...existing,
        portrait: p.portrait ?? existing.portrait,
        attitude: p.attitude,
        statuses,
        // 战斗中 hasActed 由面板回合状态管理，不受 AI 块驱动
        hasActed: existing.hasActed,
      },
      conflicts,
    };
  }

  // ---- 战前暂存 / 兼容旧卡：AI 数值直入 ----
  return {
    unit: {
      ...existing,
      init: p.init ?? existing.init,
      initRolled: p.init !== undefined ? false : existing.initRolled,
      hp: p.hp?.current ?? existing.hp,
      maxHp: p.hp?.max ?? Math.max(existing.maxHp, p.hp?.current ?? 0),
      pos: p.pos ?? existing.pos,
      attitude: p.attitude,
      statuses: [...p.statuses],
      portrait: p.portrait ?? existing.portrait,
      hasActed: !p.next,
      // HP 恢复时清除死亡状态
      deathSaves: (p.hp?.current ?? 0) > 0 && existing.hp <= 0
        ? { successes: 0, failures: 0, stable: false, dead: false }
        : existing.deathSaves,
    },
    conflicts,
  };
}
