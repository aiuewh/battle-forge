'use client';

/**
 * 战斗状态仓库（Zustand）
 * - 引擎状态：单位/地图/回合/事件日志
 * - 协议合并：新 <battle> 快照 arrival → 保留引擎扩展字段的智能合并
 * - 持久化：localStorage 自动保存
 * - 撤销：命令栈（最多 50 步）
 */
import { create } from 'zustand';
import type {
  BattleUnit, BattleEvent, MapObstacle, AoeTemplate, MapConfig,
  TurnState, RulesConfig, Attitude, DamageType, BattleSnapshot, SnapshotDiff, AiAbility,
} from '@/lib/engine/types';
import { AI_PROFILE_META } from '@/lib/engine/types';
import { DEFAULT_RULES, normalizeRules } from '@/lib/engine/types';
import {
  resolveAttack, resolveSave, resolveDeathSave, resolveHeal, resolveConcentration,
  applyTypeModifiers,
  type AttackOptions, type SaveOptions,
} from '@/lib/engine/combat';
import type { AttackResult } from '@/lib/engine/types';
import {
  startBattle, advanceTurn, checkBattleEnd, buildInitiativeOrder,
  rollInitiativeForUnits, rebuildOrderKeepActor, type InitiativeRollDetail,
} from '@/lib/engine/initiative';
import { defaultActionEconomy, mergeUnitFromProtocol, type MergeRuntimeConflict } from '@/lib/engine/merge';
import {
  parseDmMessage, generateBattleBlock, type ParsedBattleUnit, type ParsedCheck,
} from '@/lib/engine/protocol';
import {
  type StatblockDef, statblockFromPreset, unitFromStatblock, applyStatblockToUnit,
  matchStatblockForName, parseEncounterDefs, generateEncounterBlock,
  loadBestiary, saveBestiary,
} from '@/lib/engine/statblocks';
import {
  type VarTree, type CharSheet, applyPatches, charSheetsFromTree, unitFromCharSheet,
  applySheetToUnit, matchSheetForName, loadRoster, saveRoster,
} from '@/lib/engine/sheetbridge';
import { generateBattleResultBlock } from '@/lib/engine/report';
import {
  fnv1a, shouldApplyImport, appendChain, emptyChain, type HashChainState,
} from '@/lib/engine/embedSync';
import { aggregateEffects, exhaustionPenalty } from '@/lib/engine/conditions';
import {
  snapshotFromParsed, snapshotFromUnits, diffSnapshots, appendHistory, loadHistory,
  findPrevSnapshot,
} from '@/lib/engine/snapshot';
import { rollFormula, judgeCheck } from '@/lib/engine/dice';
import type { RollMode } from '@/lib/engine/types';
import { unitFromPreset, buildDemoBattle, MONSTER_PRESETS, type MonsterPreset } from '@/lib/engine/presets';
import {
  inMeleeRange, posToCell, gridDistanceFeet, buildBlockedCells, estimateCover, cellToFeet,
  aoeCells, unitDistance, cellCenter,
} from '@/lib/engine/geometry';
import { coverBonus, effectiveSpeed, abilityMod, proficiencyBonus, setRules as engineSetRules } from '@/lib/engine/rules';
import {
  planTurn, validateStep, isAiControlled, unitAbilities, opportunityAttackers,
  type AiContext, type AiStep,
} from '@/lib/engine/ai';

const STORAGE_KEY = 'dnd-battle-state-v1';

/** AI 回合计划缓存（模块级，不入持久化；按 轮次:单位ID 失效） */
let aiPlanCache: { key: string; steps: AiStep[]; replans: number } = { key: '', steps: [], replans: 0 };

export function clearAiPlanCache() {
  aiPlanCache = { key: '', steps: [], replans: 0 };
}

function currentAiCtx(s: { units: BattleUnit[]; obstacles: MapObstacle[]; mapConfig: MapConfig; playerTargetId: string | null }): AiContext {
  return {
    units: s.units,
    obstacles: s.obstacles,
    diagonal: s.mapConfig.diagonal,
    mapWidth: s.mapConfig.width,
    mapHeight: s.mapConfig.height,
    playerTargetId: s.playerTargetId,
  };
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** 掷骰明细写入战斗日志（先攻主流程共用） */
function logInitiativeRolls(rolls: InitiativeRollDetail[], units: BattleUnit[], header: string, getStore: () => BattleStore) {
  getStore().logEvent({ type: 'note', text: header, level: 'info' });
  for (const r of rolls) {
    const u = units.find(x => x.id === r.id);
    getStore().logEvent({
      type: 'note', actorId: r.id,
      text: `🎲 ${u?.name ?? r.id}：${r.detail}${r.surprised ? '（惊讶·劣势）' : ''}`,
      level: 'info',
    });
  }
}

/**
 * 2024 武器精通：攻击结算后的自动处理（低成本接入）
 * - Graze 擦掠：未命中仍造成攻击属性调整值伤害
 * - Topple 失衡：命中后目标 CON 豁免 vs DC 8+属性调整+熟练，失败倒地
 * - Push 推离：命中后目标 STR 豁免，失败被推离 10 尺
 * - Vex/Sap/Slow/Nick/Cleave 依赖「下回合」等时序状态，留在叙事层/手动处理
 */
function applyMasteryEffects(store: BattleStore, unit: BattleUnit, target: BattleUnit, ability: AiAbility, result: AttackResult | undefined) {
  if (!result || !ability.mastery) return;
  const masteryDc = 8 + (ability.masteryMod ?? 0) + proficiencyBonus(unit.level ?? unit.cr);
  switch (ability.mastery) {
    case 'Graze': {
      if (result.hit) return;
      const graze = Math.max(0, ability.masteryMod ?? 0);
      if (graze <= 0) return;
      store.logEvent({
        type: 'damage', actorId: unit.id, targetId: target.id,
        text: `🗡️ 精通·擦掠（Graze）：${target.name} 仍受 ${graze} 点擦伤`,
        level: 'bad',
      });
      store.damageUnit(target.id, graze, { type: ability.damageType, source: unit.id });
      return;
    }
    case 'Topple': {
      if (!result.hit) return;
      const r = resolveSave(target, { ability: 'con', dc: masteryDc });
      const saved = r.check.outcome.includes('success');
      store.logEvent({
        type: 'save', actorId: unit.id, targetId: target.id,
        text: `🗡️ 精通·失衡（Topple）：${target.name} 体质豁免 [${r.check.dice.rawD20}]=${r.check.total} vs DC${masteryDc} —— ${saved ? '成功，保持站立' : '失败，倒地！'}`,
        level: saved ? 'info' : 'bad',
      });
      if (!saved) store.toggleStatus(target.id, 'prone');
      return;
    }
    case 'Push': {
      if (!result.hit) return;
      const r = resolveSave(target, { ability: 'str', dc: masteryDc });
      const saved = r.check.outcome.includes('success');
      store.logEvent({
        type: 'save', actorId: unit.id, targetId: target.id,
        text: `🗡️ 精通·推离（Push）：${target.name} 力量豁免 [${r.check.dice.rawD20}]=${r.check.total} vs DC${masteryDc} —— ${saved ? '成功，稳住脚步' : '失败，被推离 10 尺！'}`,
        level: saved ? 'info' : 'bad',
      });
      if (saved) return;
      // 沿攻击方向直线推离 10 尺（钳制在地图边界内）
      const dx = target.pos.x - unit.pos.x;
      const dy = target.pos.y - unit.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      const map = store.mapConfig;
      const dest = {
        x: Math.min(Math.max(0, Math.round(target.pos.x + (dx / len) * 10)), map.width * map.cellSize),
        y: Math.min(Math.max(0, Math.round(target.pos.y + (dy / len) * 10)), map.height * map.cellSize),
      };
      store.moveUnit(target.id, dest, true);
      return;
    }
    default:
      return;
  }
}

/**
 * 玩家多重攻击逐刀结算：每刀前重读目标存活状态，击杀立即停手；
 * 有剩余攻击且场上还有其他敌人时挂 multiAttackQueue，由 ActionBar 重弹目标选择
 * 续打（2024 Extra Attack：击杀后剩余攻击可改选目标）。不含尸体攻击。
 */
function runMultiAttackSequence(
  get: () => BattleStore,
  set: (partial: Partial<BattleStore>) => void,
  actorId: string,
  ability: AiAbility,
  targetId: string,
  times: number,
) {
  let remaining = times;
  for (; remaining > 0; remaining--) {
    const target = get().units.find(u => u.id === targetId);
    if (!target || target.hp <= 0 || target.deathSaves?.dead) break;
    const actor = get().units.find(u => u.id === actorId);
    if (!actor) return;
    const cover = estimateCover(actor, target, get().obstacles, buildBlockedCells(get().obstacles));
    const atkResult = get().performAttack(actorId, target.id, {
      attackBonus: ability.attackBonus ?? 0,
      targetAc: target.ac + coverBonus(cover.cover),
      weaponDamage: ability.dice,
      weaponType: ability.damageType,
      isRanged: ability.kind === 'ranged',
      coverKind: cover.cover,
    });
    applyMasteryEffects(get(), actor, target, ability, atkResult);
  }
  if (remaining <= 0) return;
  const actor = get().units.find(u => u.id === actorId);
  if (!actor || actor.hp <= 0 || actor.deathSaves?.dead) return;
  const hasOtherTargets = get().units.some(u => u.attitude === 2 && u.hp > 0 && !u.deathSaves?.dead && u.id !== targetId);
  if (!hasOtherTargets) {
    get().logEvent({ type: 'note', text: `🎯 目标已被击杀——场上无其他敌人，剩余 ${remaining} 次攻击放弃`, level: 'info' });
    return;
  }
  set({ multiAttackQueue: { actorId, abilityId: ability.id, remaining } });
  get().logEvent({ type: 'note', text: `🎯 目标已被击杀——【${ability.name}】剩余 ${remaining} 次攻击：请在行动栏选择新目标续打，或放弃`, level: 'info' });
}

/** 为新入库的瘦单位（dataSource='ai-parsed'）自动配装完整数据：暂存敌卡 > 角色名单 > 图鉴 > 内置预设 */
function attachLibraryData(
  units: BattleUnit[],
  newIds: string[],
  sources: { staged: StatblockDef[]; bestiary: StatblockDef[]; sheets: CharSheet[] },
): { units: BattleUnit[]; reports: string[] } {
  const reports: string[] = [];
  const presetDefs = MONSTER_PRESETS.map(statblockFromPreset);
  const out = units.map(u => {
    if (!newIds.includes(u.id) || u.dataSource !== 'ai-parsed') return u;
    if (u.attitude === 2) {
      const def = matchStatblockForName(u.name, sources.staged)
        ?? matchStatblockForName(u.name, sources.bestiary)
        ?? matchStatblockForName(u.name, presetDefs);
      if (def) {
        reports.push(`📋 ${u.name} ← 敌卡「${def.name}」（AC${def.ac} · ${def.attacks.length} 个动作 · ${AI_PROFILE_META[def.aiProfile].label}）`);
        return applyStatblockToUnit(u, def);
      }
    } else {
      const sheet = matchSheetForName(u.name, sources.sheets);
      if (sheet) {
        reports.push(`🧙 ${u.name} ← 角色名单「${sheet.name}」（Lv.${sheet.level} · AC${sheet.ac} · 武器×${sheet.weapons.length}${sheet.spellSlots ? ' · 法术位' : ''}）`);
        const attached = applySheetToUnit(u, sheet);
        attached.playerControlled = true; // 名单角色默认玩家操控（可在详情卡/先攻条切回 AI 托管）
        return attached;
      }
      const def2 = matchStatblockForName(u.name, sources.staged) ?? matchStatblockForName(u.name, sources.bestiary);
      if (def2) {
        reports.push(`📋 ${u.name} ← 敌卡「${def2.name}」（AC${def2.ac} · ${def2.attacks.length} 个动作）`);
        return applyStatblockToUnit(u, def2);
      }
    }
    return u;
  });
  return { units: out, reports };
}

/** 将协议单位合并为引擎单位（委托引擎层；保留引擎扩展字段 + 面板权威保护） */

/** 统一行动结算的可选项 */
export interface CastOpts {
  /** AoE 原点（默认目标位置） */
  originPos?: { x: number; y: number };
  /** 锥形/线形方向（默认指向目标） */
  angle?: number;
  /** 跳过动作经济检查（AI 回合 / 战斗外自由结算） */
  ignoreEconomy?: boolean;
}

export type PlayerActionKind = 'dash' | 'dodge' | 'disengage' | 'hide' | 'help' | 'ready' | 'potion';

export interface BattleStore {
  // ---- 状态 ----
  units: BattleUnit[];
  obstacles: MapObstacle[];
  aoeTemplates: AoeTemplate[];
  mapConfig: MapConfig;
  turn: TurnState;
  events: BattleEvent[];
  rules: RulesConfig;
  battleActive: boolean;
  battleName: string;
  lastDiff: SnapshotDiff | null;
  history: BattleSnapshot[];
  /** 上次骰子结果（供骰子动画播放） */
  lastRoll: {
    id: string;
    formula: string;
    result: ReturnType<typeof rollFormula>;
    note?: string;
  } | null;
  embedMode: boolean;
  /** UI：当前选中单位 */
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;

  // ---- AI 行动逻辑 ----
  /** 敌方/AI 队友回合自动执行 */
  aiAutoPlay: boolean;
  /** AI 每步间隔（ms） */
  aiSpeed: number;
  /** 玩家侧上次攻击的目标（队友集火参考） */
  playerTargetId: string | null;
  /** 队友切换玩家操控/AI 托管 */
  togglePlayerControl: (id: string) => void;
  setAiAutoPlay: (v: boolean) => void;
  setAiSpeed: (ms: number) => void;
  /** 执行当前 AI 单位回合的一步；返回是否继续（供驱动器循环） */
  takeAiStep: () => boolean;
  /** 载入演示遭遇 */
  loadDemoBattle: () => void;

  // ---- 持久化 ----
  save: () => void;
  load: () => boolean;
  reset: () => void;

  // ---- 单位操作 ----
  addUnit: (unit: Partial<BattleUnit> & { id: string }) => void;
  addUnitFromPreset: (preset: MonsterPreset, hostile?: boolean) => void;
  updateUnit: (id: string, patch: Partial<BattleUnit>) => void;
  removeUnit: (id: string) => void;
  moveUnit: (id: string, pos: { x: number; y: number }, recordEvent?: boolean) => void;
  toggleStatus: (id: string, status: string) => void;
  /** 应用伤害并落账，返回类型修正+临时HP吸收后实际扣除的 HP（无此单位返回 0）；攻击路径传 skipTypeMods 防二次结算 */
  damageUnit: (id: string, amount: number, opts?: { isCrit?: boolean; type?: DamageType; source?: string; skipTypeMods?: boolean }) => number;
  /** 伤害落账后检查专注（法术/AoE/巢穴等非攻击路径统一调用；攻击路径在 performAttack 内处理） */
  concentrationAfterDamage: (targetId: string, damage: number) => void;
  healUnit: (id: string, amount: number) => void;
  tempHpUnit: (id: string, amount: number) => void;
  spendSpellSlot: (id: string, level: number) => void;
  restoreSpellSlots: (id: string, longRest?: boolean) => void;
  setConcentration: (id: string, spell: string | null) => void;

  // ---- 死亡豁免 ----
  rollDeathSave: (id: string, forced?: number) => void;
  addDeathFail: (id: string, count?: number) => void;
  addDeathSuccess: (id: string) => void;
  stabilizeUnit: (id: string) => void;
  reviveUnit: (id: string, hp?: number) => void;

  // ---- 回合 ----
  startCombat: () => void;
  nextTurn: () => void;
  prevTurn: () => void;
  endCombat: () => void;
  rollInitiativeAll: () => void;
  setSurprised: (ids: string[]) => void;

  // ---- 攻击/豁免/骰子 ----
  performAttack: (attackerId: string, targetId: string, opts: AttackOptions) => AttackResult | undefined;
  /** 反应【回合结束时】：其他单位的回合结束，带回合结束反应的敌方单位自动执行 */
  fireTurnEndReactions: (endedUnitId: string) => void;
  /** 反应【被命中后·伤害减半传送】：在伤害落账前拦截，减半并传送 */
  applyHitReactionsPreDamage: (targetId: string, attackerId: string, incoming: number) => { halved: boolean; final: number };
  /** 反应【被命中后·攻击类】：反应撕裂等，伤害结算完毕后反击 */
  runPostHitReactions: (targetId: string, attackerId: string, opts: AttackOptions) => void;
  /** 传送：半径 radiusCells 格内随机可站立格 */
  randomTeleport: (id: string, radiusFeet: number) => boolean;
  /** 巢穴动作：先攻20槽自动执行（敌卡「巢穴动作」字段） */
  executeLairAction: () => void;
  /** 传奇动作：其他单位回合结束后，敌方传奇单位消耗点数自动执行 */
  runLegendaryActions: (endedUnitId: string) => void;
  /** 定向移动：向目标直线找 radiusCells 内最靠近目标的空格 */
  moveToward: (id: string, targetId: string, radiusFeet: number) => boolean;
  performSave: (targetId: string, opts: SaveOptions) => number;
  quickRoll: (formula: string, mode?: RollMode, note?: string) => void;

  // ---- 地图 ----
  addObstacle: (cells: MapObstacle['cells'], kind: MapObstacle['kind']) => void;
  clearObstacles: () => void;
  addAoeTemplate: (t: Omit<AoeTemplate, 'id'>) => void;
  updateAoeTemplate: (id: string, patch: Partial<AoeTemplate>) => void;
  removeAoeTemplate: (id: string) => void;
  clearAoeTemplates: () => void;
  setMapConfig: (patch: Partial<MapConfig>) => void;

  // ---- 协议 ----
  importBattleBlock: (raw: string, source?: 'embed' | 'import' | 'manual') => { added: number; updated: number };
  importDmMessage: (text: string, source?: 'embed' | 'import' | 'manual', depth?: number | null) => ParsedCheck[];
  generateExportBlock: (withNext?: boolean) => string;
  exportWarReport: () => string;
  importWarReport: (json: string) => boolean;

  // ---- 数据层：变量树 / 角色名单 / 敌卡图鉴 / 遭遇暂存 ----
  /** MVU 变量树（<UpdateVariable> 增量累积缓存） */
  varTree: VarTree;
  /** 角色名单（从变量树同步，可上阵为友方单位） */
  rosterSheets: CharSheet[];
  /** 自定义敌卡图鉴（localStorage 持久化） */
  bestiary: StatblockDef[];
  /** 遭遇暂存区：<encounter> 敌卡先入此区，待 <battle> 触发时自动配装 */
  stagedStatblocks: StatblockDef[];
  /** 从变量树重建角色名单，返回角色名列表 */
  syncRosterFromTree: () => string[];
  /** 暂存敌卡（同名替换）；replace=true 清空后写入 */
  stageStatblockDefs: (defs: StatblockDef[], replace?: boolean) => void;
  clearStagedStatblocks: () => void;
  bestiaryUpsert: (def: StatblockDef) => void;
  bestiaryRemove: (id: string) => void;
  /** 暂存敌卡 → 直接上阵 */
  addUnitFromStatblock: (def: StatblockDef, hostile?: boolean) => void;
  /** 角色名单 → 上阵为友方单位 */
  addUnitFromSheet: (name: string, isPlayer?: boolean) => void;
  rosterRemove: (name: string) => void;
  /** 暂存敌卡导出为 <encounter> 块（给 AI 看格式 / 备份） */
  generateEncounterText: () => string;

  // ---- 结算权威：战报导出 ----
  /** 生成 <battleresult> 战报块（粘贴回酒馆，AI 据此叙述战后 + 应用变量） */
  generateBattleResult: () => string;

  // ---- 嵌入同步：哈希链 ----
  /** 已应用的嵌入导入哈希链（防重复/防旧楼回写） */
  importChain: HashChainState;
  /** 从 localStorage 强制重载状态（非领导者面板同步用） */
  hydrateFromPersisted: () => boolean;
  /** 非领导者面板：禁止持久化写入（防过期状态覆写共享存储） */
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;

  // ---- 统一行动结算（玩家行动栏核心） ----
  /** 执行一个动作（武器攻击/法术/治疗/AoE/单体豁免）：自动动作经济 + 法术位 + 专注 + 掩护 + 优劣势 */
  castAbility: (actorId: string, abilityId: string, targetId: string | null, opts?: CastOpts) => void;
  /** 玩家多重攻击余量：目标被击杀后等待重选目标续打（换回合/重置/放弃即作废） */
  multiAttackQueue: { actorId: string; abilityId: string; remaining: number } | null;
  /** 用新目标续打多重攻击余量（动作/法术位已在首发时消耗，不重复扣） */
  continueMultiAttack: (actorId: string, abilityId: string, targetId: string | null) => void;
  /** 放弃多重攻击余量 */
  clearMultiAttackQueue: () => void;
  /** 通用动作：冲刺/闪避/脱离/隐藏/协助/预备/治疗药水 */
  playerAction: (kind: PlayerActionKind, unitId: string, targetId?: string | null) => void;

  // ---- 其他 ----
  logEvent: (e: Partial<BattleEvent> & { text: string; type: BattleEvent['type'] }) => void;
  setRules: (patch: Partial<RulesConfig>) => void;
  setBattleName: (name: string) => void;
  setEmbedMode: (v: boolean) => void;
  clearLastRoll: () => void;
  clearHistory: () => void;
  computeLastDiff: (ts: number) => void;
}

function persist(state: BattleStore, force = false) {
  if (state.readOnly && !force) return; // 非领导者面板不写入共享存储
  try {
    const data = {
      units: state.units,
      obstacles: state.obstacles,
      mapConfig: state.mapConfig,
      turn: state.turn,
      events: state.events.slice(-200),
      rules: state.rules,
      battleActive: state.battleActive,
      battleName: state.battleName,
      aiAutoPlay: state.aiAutoPlay,
      aiSpeed: state.aiSpeed,
      playerTargetId: state.playerTargetId,
      varTree: state.varTree,
      rosterSheets: state.rosterSheets,
      stagedStatblocks: state.stagedStatblocks,
      importChain: state.importChain,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* 静默 */ }
}

export const useBattleStore = create<BattleStore>((set, get) => ({
  units: [],
  obstacles: [],
  aoeTemplates: [],
  mapConfig: { width: 30, height: 20, cellSize: 5, diagonal: 'equal' },
  turn: { round: 0, currentUnitId: null, order: [], turnIndex: -1, ended: false, surprisedIds: [] },
  events: [],
  rules: { ...DEFAULT_RULES },
  battleActive: false,
  battleName: '未命名遭遇',
  lastDiff: null,
  history: [],
  lastRoll: null,
  embedMode: false,
  selectedId: null,
  setSelectedId: (id) => set({ selectedId: id }),
  aiAutoPlay: true,
  aiSpeed: 450,
  playerTargetId: null,
  multiAttackQueue: null,
  varTree: {},
  rosterSheets: [],
  bestiary: [],
  stagedStatblocks: [],
  importChain: emptyChain(),
  readOnly: false,
  togglePlayerControl: (id) => {
    const unit = get().units.find(u => u.id === id);
    if (!unit || unit.attitude !== 0 || unit.isPlayer) return;
    const next = !unit.playerControlled;
    set({ units: get().units.map(u => (u.id === id ? { ...u, playerControlled: next } : u)) });
    get().logEvent({
      type: 'note', actorId: id,
      text: `${unit.name} 切换为「${next ? '玩家操控' : 'AI 托管'}」`,
      level: 'info',
    });
    // 若切到 AI 且正轮到他 → 清空计划让 AI 接管
    if (!next && get().turn.currentUnitId === id) clearAiPlanCache();
    persist(get());
  },
  setAiAutoPlay: (v) => { set({ aiAutoPlay: v }); persist(get()); },
  setAiSpeed: (ms) => { set({ aiSpeed: ms }); persist(get()); },

  save: () => persist(get()),
  load: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const savedRoster = loadRoster();
      if (!raw) {
        set({
          varTree: savedRoster.tree,
          rosterSheets: savedRoster.sheets,
          bestiary: loadBestiary(),
        });
        return false;
      }
      const data = JSON.parse(raw);
      const restoredRules = data.rules
        ? { ...DEFAULT_RULES, ...normalizeRules(data.rules) }
        : { ...DEFAULT_RULES };
      set({
        units: data.units ?? [],
        obstacles: data.obstacles ?? [],
        mapConfig: data.mapConfig ?? get().mapConfig,
        turn: data.turn ?? get().turn,
        events: data.events ?? [],
        rules: restoredRules,
        battleActive: data.battleActive ?? false,
        battleName: data.battleName ?? '未命名遭遇',
        aiAutoPlay: data.aiAutoPlay ?? true,
        aiSpeed: data.aiSpeed ?? 450,
        playerTargetId: data.playerTargetId ?? null,
        multiAttackQueue: null,
        varTree: data.varTree ?? savedRoster.tree,
        rosterSheets: data.rosterSheets ?? savedRoster.sheets,
        bestiary: loadBestiary(),
        stagedStatblocks: data.stagedStatblocks ?? [],
        importChain: data.importChain ?? emptyChain(),
        history: loadHistory(),
      });
      engineSetRules(restoredRules);
      return (data.units?.length ?? 0) > 0;
    } catch {
      return false;
    }
  },
  reset: () => {
    clearAiPlanCache();
    set({
      units: [], obstacles: [], aoeTemplates: [], events: [],
      turn: { round: 0, currentUnitId: null, order: [], turnIndex: -1, ended: false, surprisedIds: [] },
      battleActive: false, lastDiff: null, lastRoll: null, playerTargetId: null, multiAttackQueue: null, history: loadHistory(),
    });
    persist(get());
  },

  // ---------------- 单位 ----------------

  addUnit: (unit) => {
    const existing = get().units;
    const count = existing.filter(u => u.name.startsWith(unit.id)).length;
    const finalId = count > 0 ? `${unit.id}${count + 1}` : unit.id;
    const newUnit: BattleUnit = {
      id: finalId,
      name: unit.name ?? finalId,
      init: unit.init ?? 10,
      initMod: unit.initMod ?? 0,
      hp: unit.hp ?? 10,
      maxHp: unit.maxHp ?? unit.hp ?? 10,
      tempHp: unit.tempHp ?? 0,
      ac: unit.ac ?? 13,
      speed: unit.speed ?? 30,
      pos: unit.pos ?? { x: 0, y: 0 },
      attitude: (unit.attitude ?? 1) as Attitude,
      statuses: unit.statuses ?? [],
      portrait: unit.portrait,
      isPlayer: unit.isPlayer ?? false,
      size: unit.size ?? 'medium',
      cr: unit.cr,
      level: unit.level,
      abilities: unit.abilities,
      saveBonuses: unit.saveBonuses,
      resistances: unit.resistances ?? [],
      immunities: unit.immunities ?? [],
      vulnerabilities: unit.vulnerabilities ?? [],
      deathSaves: unit.deathSaves,
      spellSlots: unit.spellSlots,
      concentration: unit.concentration,
      legendary: unit.legendary,
      actionEconomy: defaultActionEconomy(),
      notes: unit.notes ?? '',
      reach: unit.reach,
      color: unit.color,
      aiProfile: unit.aiProfile,
      aiAbilities: unit.aiAbilities?.map(a => ({ ...a })),
      playerControlled: unit.playerControlled,
      hasActed: false,
    };
    set({ units: [...get().units, newUnit] });
    get().logEvent({ type: 'unit-add', actorId: newUnit.id, text: `${newUnit.name} 登场（HP ${newUnit.hp}/${newUnit.maxHp}，AC ${newUnit.ac}）`, level: 'info' });
    // 战斗中途登场：掷先攻并插入回合序列（2024：加入时掷先攻）
    if (get().battleActive && get().rules.authorityMode !== 'ai-legacy' && newUnit.hp > 0) {
      const { rolls, initById } = rollInitiativeForUnits([get().units[get().units.length - 1]], get().rules, []);
      const rolled = initById.get(newUnit.id);
      if (rolled !== undefined) {
        set({ units: get().units.map(u => (u.id === newUnit.id ? { ...u, init: rolled, initRolled: true } : u)) });
        for (const r of rolls) {
          get().logEvent({ type: 'note', actorId: r.id, text: `🆕 ${newUnit.name} 入场掷先攻 ${r.detail}`, level: 'info' });
        }
        set({ turn: rebuildOrderKeepActor(get().units, get().rules, get().turn, Date.now() % 100000) });
      }
    }
    persist(get());
  },

  addUnitFromPreset: (preset, hostile = true) => {
    const existing = get().units;
    const count = existing.filter(u => u.name.startsWith(preset.name)).length;
    const unit = unitFromPreset(preset, count, hostile);
    // 自动摆位：敌方在右半场随机列，友方在左
    const col = hostile ? get().mapConfig.width - 2 - Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
    const row = 1 + Math.floor(Math.random() * Math.max(1, get().mapConfig.height - 2));
    unit.pos = { x: col * 5, y: row * 5 };
    set({ units: [...get().units, unit] });
    get().logEvent({ type: 'unit-add', actorId: unit.id, text: `${unit.name} 登场（CR ${preset.cr}，HP ${unit.hp}，AC ${unit.ac}）`, level: 'info' });
    persist(get());
  },

  updateUnit: (id, patch) => {
    set({ units: get().units.map(u => (u.id === id ? { ...u, ...patch } : u)) });
    persist(get());
  },

  removeUnit: (id) => {
    const u = get().units.find(x => x.id === id);
    set({ units: get().units.filter(x => x.id !== id) });
    if (u) get().logEvent({ type: 'unit-remove', actorId: id, text: `${u.name} 离场`, level: 'info' });
    persist(get());
  },

  moveUnit: (id, pos, recordEvent = true) => {
    const unit = get().units.find(u => u.id === id);
    if (!unit) return;
    const fromCell = posToCell(unit.pos);
    const toCell = posToCell(pos);
    const dist = gridDistanceFeet(fromCell, toCell, get().mapConfig.diagonal);
    set({
      units: get().units.map(u =>
        u.id === id
          ? { ...u, pos, actionEconomy: { ...u.actionEconomy, movementUsed: u.actionEconomy.movementUsed + dist } }
          : u,
      ),
    });
    if (recordEvent && dist > 0) {
      get().logEvent({ type: 'move', actorId: id, text: `${unit.name} 移动 ${dist} 尺 → (${Math.round(pos.x / 5)},${Math.round(pos.y / 5)})`, level: 'info' });
    }
    // 借机攻击：主动离开敌人触及范围（战斗中 & 非脱离状态）
    // 规则修正：所有具备反应的威胁者各自借机（每人消耗自己的反应），不再只取第一个
    if (get().battleActive && dist > 0) {
      const ctx = currentAiCtx(get());
      const threats = opportunityAttackers(ctx, unit, fromCell, toCell).filter(t => {
        // 带反应定义的单位改用每轮/每回合计数判定
        if (t.unit.reactions?.length) {
          return (t.unit.reactionsUsedRound ?? 0) < (t.unit.reactionsPerRound ?? 1) && !t.unit.reactionUsedTurn;
        }
        return true;
      });
      for (const t of threats) {
        set({ units: get().units.map(u => (u.id === t.unit.id
          ? {
              ...u,
              actionEconomy: { ...u.actionEconomy, reaction: true },
              ...(u.reactions?.length
                ? { reactionsUsedRound: (u.reactionsUsedRound ?? 0) + 1, reactionUsedTurn: true }
                : {}),
            }
          : u)) });
        get().logEvent({
          type: 'attack', actorId: t.unit.id, targetId: unit.id,
          text: `⚡ 借机攻击 —— ${t.unit.name} 对脱离触及的 ${unit.name} 发动【${t.ability.name}】！`,
          level: 'bad',
        });
        const cover = estimateCover(t.unit, unit, get().obstacles, buildBlockedCells(get().obstacles));
        if (cover.cover === 'full') {
          get().logEvent({
            type: 'attack', actorId: t.unit.id, targetId: unit.id,
            text: `⛔ 借机攻击取消 —— ${unit.name} 处于全掩护，无法被直接指定（2024 规则）`,
            level: 'info',
          });
          continue;
        }
        get().performAttack(t.unit.id, unit.id, {
          attackBonus: t.ability.attackBonus ?? 0,
          targetAc: unit.ac + coverBonus(cover.cover),
          weaponDamage: t.ability.dice,
          weaponType: t.ability.damageType,
        });
      }
    }
    persist(get());
  },

  toggleStatus: (id, status) => {
    const unit = get().units.find(u => u.id === id);
    if (!unit) return;
    const has = unit.statuses.includes(status);
    const statuses = has ? unit.statuses.filter(s => s !== status) : [...unit.statuses, status];
    // 2024：力竭达到 10 级即死亡
    let dead = false;
    if (!has && /^exhaustion:(\d+)$/.test(status)) {
      const lv = parseInt(status.split(':')[1], 10);
      dead = lv >= 10;
    }
    set({
      units: get().units.map(u => (u.id === id
        ? { ...u, statuses, ...(dead ? { deathSaves: { successes: 0, failures: 3, stable: false, dead: true } } : {}) }
        : u)),
    });
    get().logEvent({
      type: has ? 'status-remove' : 'status-add',
      actorId: id,
      text: `${unit.name} ${has ? '解除' : '获得'}状态：${status}${dead ? ' —— 力竭 10 级，死亡' : ''}`,
      level: dead ? 'crit' : has ? 'good' : 'bad',
    });
    if (dead) {
      get().logEvent({ type: 'death', actorId: id, text: `💀 ${unit.name} 力竭衰竭而死`, level: 'crit' });
    }
    persist(get());
  },

  damageUnit: (id, amount, opts = {}) => {
    const unit = get().units.find(u => u.id === id);
    if (!unit) return 0;
    // 伤害类型管线（2024：抗性→易伤→免疫依次应用；石化全抗性）。
    // 攻击路径（performAttack→resolveAttack）已应用过，传 skipTypeMods 防止二次结算；
    // 法术/AoE/巢穴/精通等路径在此统一应用——修复火球无视免疫/抗性的 P0 缺陷
    let typed = amount;
    if (opts.type && !opts.skipTypeMods) {
      const r = applyTypeModifiers(unit, amount, opts.type);
      typed = r.final;
      if (r.note) {
        get().logEvent({
          type: 'damage', actorId: id,
          text: `🛡️ ${unit.name} ${r.note}：${amount} → ${typed}`,
          level: 'info',
        });
      }
    }
    // 临时 HP 吸收
    let absorbed = 0;
    let remaining = typed;
    if (unit.tempHp > 0) {
      absorbed = Math.min(unit.tempHp, typed);
      remaining = typed - absorbed;
    }
    const newHp = unit.hp - remaining;
    let deathSaves = unit.deathSaves;
    let killed = false;
    if (newHp <= 0 && unit.hp > 0) {
      // 跌至 0：巨额伤害即死（2024：剩余伤害 = 伤害 - 受伤前当前 HP ≥ 生命值上限才立即死亡）；
      // 敌方小怪归零即死（2024 惯例，传奇单位除外）；友方进入死亡豁免
      if (remaining - unit.hp >= unit.maxHp) {
        killed = true;
        deathSaves = { successes: 0, failures: 3, stable: false, dead: true };
      } else if (unit.attitude === 2 && !unit.legendary) {
        killed = true;
        deathSaves = { successes: 0, failures: 3, stable: false, dead: true };
      } else {
        deathSaves = get().rules.failOnDropToZero
          ? { successes: 0, failures: 1, stable: false, dead: false }
          : { successes: 0, failures: 0, stable: false, dead: false };
      }
    } else if (unit.hp <= 0 && remaining > 0) {
      // 已在 0 HP 再受伤：受「0 HP 受伤记失败」开关管理（默认开启 = 2024 规则：+1 失败 / 重击 +2）
      if (get().rules.failOnDamageAtZero) {
        const fails = opts.isCrit ? 2 : 1;
        const ds = unit.deathSaves ?? { successes: 0, failures: 0, stable: false, dead: false };
        killed = ds.failures + fails >= 3;
        deathSaves = { ...ds, failures: ds.failures + fails, dead: killed };
      }
    }
    set({
      units: get().units.map(u => (u.id === id
        ? { ...u, hp: Math.max(0, newHp), tempHp: u.tempHp - absorbed, deathSaves, statuses: killed ? u.statuses : u.statuses }
        : u)),
    });
    const hpNote = absorbed > 0 ? `（临时HP吸收${absorbed}）` : '';
    const typedNote = typed !== amount ? `（类型修正后 ${typed}）` : '';
    get().logEvent({
      type: 'damage',
      actorId: id,
      text: `${unit.name} 受到 ${amount}${opts.type ? ' [' + opts.type + ']' : ''}${typedNote} 伤害${hpNote} → HP ${Math.max(0, newHp)}/${unit.maxHp}${killed ? ' ☠️死亡' : newHp <= 0 ? ' 濒死！' : ''}`,
      level: killed ? 'crit' : 'bad',
      data: { amount, type: opts.type, killed },
    });
    if (killed) {
      get().logEvent({ type: 'death', actorId: id, text: `💀 ${unit.name} 死亡`, level: 'crit' });
    }
    persist(get());
    return remaining;
  },

  healUnit: (id, amount) => {
    const unit = get().units.find(u => u.id === id);
    if (!unit) return;
    // 2024：死亡不是 0 HP——治疗无法作用于尸体（需复活类法术走 reviveUnit）
    if (unit.deathSaves?.dead) {
      get().logEvent({
        type: 'heal', actorId: id,
        text: `⛔ ${unit.name} 已死亡——治疗无法生效（需要复活法术）`,
        level: 'bad',
      });
      return;
    }
    const newHp = Math.min(unit.maxHp, Math.max(0, unit.hp) + amount);
    const fromZero = unit.hp <= 0;
    set({
      units: get().units.map(u => (u.id === id
        ? {
            ...u,
            hp: newHp,
            deathSaves: fromZero ? { successes: 0, failures: 0, stable: false, dead: false } : u.deathSaves,
            statuses: fromZero ? u.statuses.filter(s => s !== 'unconscious') : u.statuses,
          }
        : u)),
    });
    get().logEvent({
      type: 'heal', actorId: id,
      text: `${unit.name} 恢复 ${amount} HP → ${newHp}/${unit.maxHp}${fromZero ? '（苏醒）' : ''}`,
      level: 'good',
    });
    persist(get());
  },

  tempHpUnit: (id, amount) => {
    set({ units: get().units.map(u => (u.id === id ? { ...u, tempHp: Math.max(u.tempHp, amount) } : u)) });
    const unit = get().units.find(u => u.id === id);
    if (unit) get().logEvent({ type: 'heal', actorId: id, text: `${unit.name} 获得 ${amount} 临时HP`, level: 'good' });
    persist(get());
  },

  spendSpellSlot: (id, level) => {
    const unit = get().units.find(u => u.id === id);
    if (!unit?.spellSlots?.[level]) return;
    const slot = unit.spellSlots[level];
    if (slot.current <= 0) return;
    set({
      units: get().units.map(u => (u.id === id
        ? { ...u, spellSlots: { ...u.spellSlots, [level]: { ...slot, current: slot.current - 1 } } }
        : u)),
    });
    get().logEvent({ type: 'spell-slot', actorId: id, text: `${unit.name} 消耗 ${level} 环法术位（余 ${slot.current - 1}/${slot.max}）`, level: 'info' });
    persist(get());
  },

  restoreSpellSlots: (id, longRest = true) => {
    const unit = get().units.find(u => u.id === id);
    if (!unit?.spellSlots) return;
    const slots: typeof unit.spellSlots = {};
    for (const [k, v] of Object.entries(unit.spellSlots)) {
      slots[Number(k)] = { ...v, current: longRest ? v.max : Math.min(v.max, v.current + Math.ceil(v.max / 2)) };
    }
    set({ units: get().units.map(u => (u.id === id ? { ...u, spellSlots: slots } : u)) });
    get().logEvent({ type: 'spell-slot', actorId: id, text: `${unit.name} ${longRest ? '长休' : '短休(房规半恢复)'}恢复法术位`, level: 'good' });
    persist(get());
  },

  setConcentration: (id, spell) => {
    const unit = get().units.find(u => u.id === id);
    if (!unit) return;
    set({ units: get().units.map(u => (u.id === id ? { ...u, concentration: spell ?? undefined } : u)) });
    if (spell) {
      get().logEvent({ type: 'concentration', actorId: id, text: `${unit.name} 开始专注：${spell}`, level: 'info' });
    } else if (unit.concentration) {
      get().logEvent({ type: 'concentration', actorId: id, text: `${unit.name} 的专注【${unit.concentration}】被打断！`, level: 'bad' });
    }
    persist(get());
  },

  concentrationAfterDamage: (targetId, damage) => {
    const t = get().units.find(u => u.id === targetId);
    if (!t || !t.concentration || damage <= 0) return;
    const conc = resolveConcentration(t, damage);
    if (conc.broken) {
      get().setConcentration(targetId, null);
    } else {
      get().logEvent({
        type: 'concentration', actorId: targetId,
        text: `${t.name} ${conc.check.label}：${conc.check.total} —— 维持专注`,
        level: 'info',
      });
    }
  },

  // ---------------- 死亡豁免 ----------------

  rollDeathSave: (id, forced) => {
    const unit = get().units.find(u => u.id === id);
    if (!unit) return;
    const r = resolveDeathSave(unit, forced);
    set({
      units: get().units.map(u => (u.id === id ? { ...u, deathSaves: r.newState } : u)),
      lastRoll: { id: uid(), formula: '死亡豁免', result: r.check.dice, note: r.check.label },
    });
    const events: Record<string, string> = {
      none: `死亡豁免 ${r.check.dice.total}（${r.success ? '成功' : '失败'}）`,
      stable: `死亡豁免成功×3 —— ${unit.name} 伤势稳定`,
      dead: `💀 三次失败 —— ${unit.name} 死亡`,
      'revive-1hp': `✨ 裸骰20 —— ${unit.name} 恢复 1 HP 苏醒！`,
      'double-fail': `💥 裸骰1 —— 记两次失败！`,
    };
    set({
      units: get().units.map(u => {
        if (u.id !== id) return u;
        if (r.event === 'revive-1hp') return { ...u, hp: 1, deathSaves: r.newState };
        if (r.event === 'dead') return { ...u, statuses: [...u.statuses, 'unconscious'] };
        return u;
      }),
    });
    get().logEvent({
      type: 'save', actorId: id,
      text: `${unit.name}：${events[r.event]}`,
      level: r.event === 'dead' ? 'crit' : r.success ? 'good' : 'bad',
    });
    persist(get());
  },

  addDeathFail: (id, count = 1) => {
    const unit = get().units.find(u => u.id === id);
    if (!unit) return;
    const ds = unit.deathSaves ?? { successes: 0, failures: 0, stable: false, dead: false };
    const dead = ds.failures + count >= 3;
    set({ units: get().units.map(u => (u.id === id ? { ...u, deathSaves: { ...ds, failures: ds.failures + count, dead } } : u)) });
    if (dead) get().logEvent({ type: 'death', actorId: id, text: `💀 ${unit.name} 死亡`, level: 'crit' });
    persist(get());
  },

  addDeathSuccess: (id) => {
    const unit = get().units.find(u => u.id === id);
    if (!unit) return;
    const ds = unit.deathSaves ?? { successes: 0, failures: 0, stable: false, dead: false };
    const stable = ds.successes + 1 >= 3;
    set({ units: get().units.map(u => (u.id === id ? { ...u, deathSaves: { ...ds, successes: stable ? 0 : ds.successes + 1, stable } } : u)) });
    if (stable) get().logEvent({ type: 'stabilize', actorId: id, text: `${unit.name} 伤势稳定`, level: 'good' });
    persist(get());
  },

  stabilizeUnit: (id) => {
    set({ units: get().units.map(u => (u.id === id ? { ...u, deathSaves: { successes: 0, failures: 0, stable: true, dead: false } } : u)) });
    const unit = get().units.find(u => u.id === id);
    if (unit) get().logEvent({ type: 'stabilize', actorId: id, text: `${unit.name} 被稳定伤势（医药 DC10）`, level: 'good' });
    persist(get());
  },

  reviveUnit: (id, hp = 1) => {
    set({
      units: get().units.map(u => (u.id === id
        ? { ...u, hp, deathSaves: { successes: 0, failures: 0, stable: false, dead: false }, statuses: u.statuses.filter(s => s !== 'unconscious') }
        : u)),
    });
    const unit = get().units.find(u => u.id === id);
    if (unit) get().logEvent({ type: 'revive', actorId: id, text: `${unit.name} 复苏，HP ${hp}`, level: 'good' });
    persist(get());
  },

  // ---------------- 回合 ----------------

  startCombat: () => {
    const { units, rules, turn: prevTurn } = get();
    if (units.length === 0) return;
    // PHB 战斗步骤③：掷先攻——全员敏捷检定 d20+敏捷调整值（2024：被惊讶者劣势）
    let finalUnits = units;
    if (rules.authorityMode !== 'ai-legacy') {
      const { rolls, initById } = rollInitiativeForUnits(units, rules, prevTurn.surprisedIds);
      finalUnits = units.map(u => {
        const rolled = initById.get(u.id);
        return rolled !== undefined
          ? { ...u, init: rolled, initRolled: true }
          : { ...u, initRolled: true };
      });
      logInitiativeRolls(rolls, units, '🎲 掷先攻（1d20 + 先攻加值）', () => get());
    } else {
      finalUnits = units.map(u => ({ ...u, initRolled: true }));
      get().logEvent({ type: 'note', text: '📋 先攻采用 DM/AI 给定值（兼容模式）', level: 'info' });
    }
    const order = buildInitiativeOrder(finalUnits, rules, Date.now() % 100000);
    const turn: TurnState = {
      round: 1, order, turnIndex: 0,
      currentUnitId: order[0] ?? null, ended: false, surprisedIds: prevTurn.surprisedIds,
    };
    // 2014 惊讶规则：首个行动者被突袭 → 首轮不能行动，直接推进到下一有效单位
    if (rules.surpriseMode === 'skip-turn' && turn.surprisedIds.length > 0) {
      const firstSurprised = finalUnits.find(u => u.id === turn.currentUnitId && turn.surprisedIds.includes(u.id));
      if (firstSurprised) {
        get().logEvent({ type: 'note', actorId: firstSurprised.id, text: `😮 ${firstSurprised.name} 遭到突袭，第 1 轮无法行动（2014 规则）`, level: 'bad' });
        const adv = advanceTurn(turn, finalUnits, rules);
        turn.currentUnitId = adv.state.currentUnitId;
        turn.turnIndex = adv.state.turnIndex;
        turn.round = adv.state.round;
      }
    }
    // 重置动作经济
    set({
      turn,
      battleActive: true,
      units: finalUnits.map(u => ({ ...u, actionEconomy: defaultActionEconomy(), hasActed: false })),
    });
    const first = finalUnits.find(u => u.id === turn.currentUnitId);
    get().logEvent({ type: 'round-start', text: `⚔️ 战斗开始！第 1 轮 —— ${first?.name ?? '?'} 先行动`, level: 'info' });
    appendHistory(snapshotFromUnits(get().units, 'manual'));
    persist(get());
  },

  nextTurn: () => {
    const { turn, units, rules } = get();
    // 反应【回合结束时】：其他单位的回合结束，带回合结束反应的敌方单位自动执行
    if (turn.currentUnitId && get().battleActive) get().fireTurnEndReactions(turn.currentUnitId);
    // 传奇动作：其他单位的回合结束后，敌方传奇单位消耗点数执行一次
    if (turn.currentUnitId && get().battleActive) get().runLegendaryActions(turn.currentUnitId);
    const result = advanceTurn(turn, units, rules);
    // 标记当前已行动（清除脱离状态），重置下一单位动作经济；多重攻击余量不跨回合
    set({
      multiAttackQueue: null,
      turn: result.state,
      units: units.map(u => {
        // 每个回合开始：所有单位的「本回合已用反应」标记刷新
        const base = { ...u, reactionUsedTurn: false };
        if (u.id === turn.currentUnitId) {
          return { ...base, hasActed: true, statuses: u.statuses.filter(s => s !== 'disengaging') };
        }
        if (u.id === result.state.currentUnitId) {
          return {
            ...base,
            actionEconomy: defaultActionEconomy(),
            // 闪避持续到自身下回合开始（2024）：轮到闪避者行动时解除
            statuses: u.statuses.filter(st => st !== 'dodging'),
          };
        }
        return base;
      }),
    });
    // 时光缓速解除：反应拥有者回合开始时，移除其施加的速度锁
    const newActor = get().units.find(u => u.id === result.state.currentUnitId);
    if (newActor?.reactions?.some(r => r.effect === 'speed-zero')) {
      set({ units: get().units.map(u => (u.statuses.includes('slow_time') ? { ...u, statuses: u.statuses.filter(st => st !== 'slow_time') } : u)) });
    }
    // 濒死单位的回合位置经过了：自动掷死亡豁免（2024：死亡豁免在自己回合开始时掷）
    for (const dsId of result.needsDeathSave) {
      get().rollDeathSave(dsId);
    }
    const nu = get().units.find(u => u.id === result.newUnitId);
    if (result.newRound) {
      // 新一轮：传奇点重置
      set({
        units: get().units.map(u => (u.legendary ? { ...u, legendary: { ...u.legendary, points: u.legendary.max } } : u)),
      });
      // 新一轮：每轮反应次数清零
      set({
        units: get().units.map(u => (u.reactions ? { ...u, reactionsUsedRound: 0 } : u)),
      });
      get().logEvent({ type: 'round-start', text: `📍 第 ${result.state.round} 轮开始`, level: 'info' });
    }
    if (result.lairTrigger) {
      get().executeLairAction();
    }
    get().logEvent({
      type: 'turn-start',
      actorId: result.newUnitId ?? undefined,
      text: `▶️ 轮到 ${nu?.name ?? '?'} 行动`,
      level: 'info',
    });
    // 战斗结束检查
    const endCheck = checkBattleEnd(get().units);
    if (endCheck.ended) {
      set({ turn: { ...get().turn, ended: true }, battleActive: false });
      get().logEvent({
        type: 'note',
        text: `🏁 战斗结束！${endCheck.winner === 0 ? '友方' : endCheck.winner === 2 ? '敌方' : ''}获胜`,
        level: 'crit',
      });
    }
    persist(get());
  },

  prevTurn: () => {
    const { turn } = get();
    if (turn.turnIndex <= 0) return;
    const idx = turn.turnIndex - 1;
    set({ turn: { ...turn, turnIndex: idx, currentUnitId: turn.order[idx] ?? null } });
    persist(get());
  },

  endCombat: () => {
    set({ battleActive: false, turn: { ...get().turn, ended: true } });
    get().logEvent({ type: 'note', text: '🏁 战斗结束', level: 'info' });
    persist(get());
  },

  rollInitiativeAll: () => {
    const { units, rules, turn, battleActive } = get();
    const { rolls, initById } = rollInitiativeForUnits(units, rules, turn.surprisedIds);
    set({
      units: units.map(u => {
        const rolled = initById.get(u.id);
        return rolled !== undefined
          ? { ...u, init: rolled, initRolled: true }
          : u;
      }),
    });
    logInitiativeRolls(rolls, units, '🎲 全员重掷先攻（1d20 + 先攻加值）', () => get());
    // 战斗进行中重掷：重建顺序但保持当前行动者（先攻值变化立即生效，不打断当前回合）
    if (battleActive) {
      set({ turn: rebuildOrderKeepActor(get().units, get().rules, get().turn, Date.now() % 100000) });
    }
    persist(get());
  },

  setSurprised: (ids) => {
    set({ turn: { ...get().turn, surprisedIds: ids } });
    persist(get());
  },

  // ---------------- 攻击/豁免 ----------------

  performAttack: (attackerId, targetId, opts) => {
    const attacker = get().units.find(u => u.id === attackerId);
    const target = get().units.find(u => u.id === targetId);
    if (!attacker || !target) return;
    // 2024 上下文：距离（倒地 5 尺内优/外劣）与贴身敌对生物（远程劣势）
    const diag = get().mapConfig.diagonal;
    const distanceFeet = unitDistance(attacker, target, diag);
    const hostileWithin5Ft = get().units.some(u =>
      u.id !== attackerId && u.hp > 0 && !u.deathSaves?.dead
      && u.attitude !== attacker.attitude && u.attitude !== 1 && attacker.attitude !== 1
      && unitDistance(attacker, u, diag) <= 5);
    const result = resolveAttack(attacker, target, {
      ...opts,
      distanceFeet,
      hostileWithin5Ft,
      critWeaponDiceOnly: get().rules.critWeaponDiceOnly,
    });
    set({ lastRoll: { id: uid(), formula: opts.weaponDamage, result: result.attack.dice, note: `攻击 ${target.name}` } });
    // 动作经济：当前行动者消耗动作；玩家侧攻击记录集火目标
    const isCurrentActor = attackerId === get().turn.currentUnitId && get().battleActive;
    set({
      units: get().units.map(u => (u.id === attackerId && isCurrentActor
        ? { ...u, actionEconomy: { ...u.actionEconomy, action: true } }
        : u)),
    });
    if (attacker.attitude === 0) set({ playerTargetId: targetId });
    const outcomeText: Record<string, string> = {
      'critical-success': '💥 大成功命中！',
      'success': '命中',
      'failure': '未命中',
      'critical-failure': '❌ 大失败',
    };
    get().logEvent({
      type: 'attack',
      actorId: attackerId,
      targetId,
      text: `${attacker.name} 攻击 ${target.name}：d20[${result.attack.dice.rawD20}]${result.attack.dice.modifier >= 0 ? '+' : ''}${result.attack.dice.modifier}=${result.attack.dice.total} vs AC${opts.targetAc} —— ${outcomeText[result.attack.outcome]}${result.critical ? '（重击）' : ''}`,
      level: result.critical ? 'crit' : result.hit ? 'bad' : 'info',
      data: { result },
    });
    if (result.hit && result.damage) {
      // 反应【被命中后·伤害减半传送】（时轴穿梭类）：在伤害落账前拦截
      const halved = get().applyHitReactionsPreDamage(targetId, attackerId, result.damage.final);
      if (halved.halved) result.damage.final = halved.final;
      get().damageUnit(targetId, result.damage.final, {
        isCrit: result.critical,
        type: opts.weaponType,
        source: attackerId,
        skipTypeMods: true, // resolveAttack 内已应用类型修正，避免二次结算
      });
      // 专注豁免
      if (result.damage.concentrationDc) {
        const conc = resolveConcentration(target, result.damage.appliedToHp);
        if (conc.broken) {
          get().setConcentration(targetId, null);
        } else {
          get().logEvent({
            type: 'concentration', actorId: targetId,
            text: `${target.name} ${conc.check.label}：${conc.check.total} —— 维持专注`,
            level: 'info',
          });
        }
      }
      // 反应【被命中后·攻击类】（反应撕裂等）：伤害结算完毕后反击
      get().runPostHitReactions(targetId, attackerId, opts);
    }
    persist(get());
    return result;
  },

  fireTurnEndReactions: (endedUnitId) => {
    const ended = get().units.find(u => u.id === endedUnitId);
    if (!ended) return;
    const reactors = get().units.filter(u =>
      u.attitude === 2 && u.id !== endedUnitId && u.hp > 0 && !u.deathSaves?.dead &&
      u.reactions?.some(r => r.trigger === 'turn-end' && r.effect === 'speed-zero'));
    for (const reactor of reactors) {
      if ((reactor.reactionsUsedRound ?? 0) >= (reactor.reactionsPerRound ?? 1) || reactor.reactionUsedTurn) continue;
      const foes = get().units.filter(u =>
        u.id !== reactor.id && u.attitude !== reactor.attitude && u.hp > 0 && !u.deathSaves?.dead);
      const inRange = foes.filter(u => Math.hypot(u.pos.x - reactor.pos.x, u.pos.y - reactor.pos.y) <= 60);
      const weakened = inRange.find(u => u.statuses.some(st => st.includes('削弱') || st.toLowerCase().includes('weaken') || st.includes('时光')));
      const target = weakened ?? inRange.slice().sort((a, b) =>
        ((a.pos.x - reactor.pos.x) ** 2 + (a.pos.y - reactor.pos.y) ** 2) - ((b.pos.x - reactor.pos.x) ** 2 + (b.pos.y - reactor.pos.y) ** 2))[0];
      if (!target) continue;
      set({ units: get().units.map(u => (u.id === reactor.id
        ? { ...u, reactionsUsedRound: (u.reactionsUsedRound ?? 0) + 1, reactionUsedTurn: true, actionEconomy: { ...u.actionEconomy, reaction: true } }
        : u.id === target.id ? { ...u, statuses: [...new Set([...u.statuses, 'slow_time'])] } : u)) });
      get().logEvent({
        type: 'note', actorId: reactor.id, targetId: target.id,
        text: `⏳ 反应【时光缓速】：${reactor.name} 使 ${target.name} 速度降为0（持续到 ${reactor.name} 下个回合开始）`,
        level: 'bad',
      });
    }
  },

  applyHitReactionsPreDamage: (targetId, attackerId, incoming) => {
    const target = get().units.find(u => u.id === targetId);
    if (!target || target.attitude !== 2 || !target.reactions?.length) return { halved: false, final: incoming };
    const rx = target.reactions.find(r => r.trigger === 'hit' && r.effect === 'damage-halve-teleport'
      && (target.reactionsUsedRound ?? 0) < (target.reactionsPerRound ?? 1) && !target.reactionUsedTurn);
    if (!rx) return { halved: false, final: incoming };
    const final = Math.max(1, Math.floor(incoming / 2));
    set({
      units: get().units.map(u => (u.id === targetId
        ? { ...u, reactionsUsedRound: (u.reactionsUsedRound ?? 0) + 1, reactionUsedTurn: true, actionEconomy: { ...u.actionEconomy, reaction: true } }
        : u)),
    });
    const moved = get().randomTeleport(targetId, 30);
    get().logEvent({
      type: 'note', actorId: targetId,
      text: `⏳ 反应【${rx.name}】：${target.name} 将本次伤害减半（${incoming}→${final}）${moved ? '，并传送脱离' : ''}`,
      level: 'info', data: { reaction: rx },
    });
    return { halved: true, final };
  },

  runPostHitReactions: (targetId, attackerId, opts) => {
    const target = get().units.find(u => u.id === targetId);
    const attacker = get().units.find(u => u.id === attackerId);
    if (!target || !attacker || target.attitude !== 2 || !target.reactions?.length) return;
    if ((target.reactionsUsedRound ?? 0) >= (target.reactionsPerRound ?? 1) || target.reactionUsedTurn) return;
    const rx = target.reactions.find(r => r.trigger === 'hit' && r.effect === 'attack'
      && (target.reactionsUsedRound ?? 0) < (target.reactionsPerRound ?? 1) && !target.reactionUsedTurn);
    if (!rx) return;
    const ability = target.aiAbilities?.find(a => a.name === rx.attackName)
      ?? target.aiAbilities?.find(a => a.kind === 'melee');
    if (!ability) return;
    set({ units: get().units.map(u => (u.id === targetId
      ? { ...u, reactionsUsedRound: (u.reactionsUsedRound ?? 0) + 1, reactionUsedTurn: true, actionEconomy: { ...u.actionEconomy, reaction: true } }
      : u)) });
    get().logEvent({
      type: 'note', actorId: targetId, targetId: attackerId,
      text: `⚡ 反应【${rx.name}】触发：${target.name} 对 ${attacker.name} 反击`,
      level: 'bad',
    });
    get().performAttack(targetId, attackerId, {
      attackBonus: ability.attackBonus ?? 0,
      targetAc: attacker.ac,
      weaponDamage: ability.dice,
      weaponType: ability.damageType,
    });
  },

  randomTeleport: (id, radiusFeet) => {
    const u = get().units.find(x => x.id === id);
    if (!u) return false;
    const blocked = new Set([...buildBlockedCells(get().obstacles).keys()]);
    const occ = new Set(get().units.filter(x => x.id !== id && x.hp > 0).map(x => `${x.pos.x},${x.pos.y}`));
    const cands: Array<{ x: number; y: number }> = [];
    // pos 坐标为英尺：半径按英尺遍历，步长 5 尺（1 格）
    for (let dx = -radiusFeet; dx <= radiusFeet; dx += 5) {
      for (let dy = -radiusFeet; dy <= radiusFeet; dy += 5) {
        if (dx === 0 && dy === 0) continue;
        const cx = u.pos.x + dx, cy = u.pos.y + dy;
        if (cx < 0 || cy < 0) continue;
        const key = `${cx},${cy}`;
        if (!blocked.has(key) && !occ.has(key)) cands.push({ x: cx, y: cy });
      }
    }
      if (!cands.length) return false;
      const pick = cands[Math.floor(Math.random() * cands.length)];
      set({ units: get().units.map(x => (x.id === id ? { ...x, pos: pick } : x)) });
      return true;
    },

  executeLairAction: () => {
    const casters = get().units.filter(u => u.attitude === 2 && u.hp > 0 && !u.deathSaves?.dead && (u.lairActions?.length ?? 0) > 0);
    for (const caster of casters) {
      const act = caster.lairActions![0];
      const rangeFeet = act.rangeFeet ?? 9999;
      const targets = get().units.filter(u =>
        u.attitude !== caster.attitude && u.hp > 0 && !u.deathSaves?.dead &&
        Math.hypot(u.pos.x - caster.pos.x, u.pos.y - caster.pos.y) <= rangeFeet);
      get().logEvent({
        type: 'lair', actorId: caster.id,
        text: `🐉 巢穴动作 —— ${caster.name}：【${act.name}】${act.description ? `（${act.description}）` : ''}`,
        level: 'bad',
      });
      if (!act.damage) continue;
      for (const t of targets) {
        const roll = rollFormula(act.damage);
        let dmg = roll.total;
        let saveText = '';
        if (act.saveDc && act.saveAbility) {
          const save = resolveSave(t, { ability: act.saveAbility, dc: act.saveDc });
          const success = save.check.outcome.includes('success');
          if (success) dmg = Math.floor(dmg / 2);
          saveText = `（${save.check.label}：${save.check.total} vs DC${act.saveDc} ${success ? '成功，半伤' : '失败'}）`;
        }
        get().logEvent({
          type: 'save', actorId: t.id,
          text: `巢穴动作波及 ${t.name}：${act.damage} → ${dmg} 点${act.damageType ?? ''}伤害${saveText}`,
          level: 'bad',
        });
        const appliedLair = get().damageUnit(t.id, dmg, { type: act.damageType, source: caster.id });
        // 专注检定用类型修正后的实际扣血（抗性减免不应抬高专注 DC）
        get().concentrationAfterDamage(t.id, appliedLair);
      }
    }
  },

  runLegendaryActions: (endedUnitId) => {
    const actors = get().units.filter(u =>
      u.attitude === 2 && u.id !== endedUnitId && u.hp > 0 && !u.deathSaves?.dead &&
      (u.legendary?.points ?? 0) > 0 && (u.legendaryActions?.length ?? 0) > 0);
    for (const actor of actors) {
      const affordable = actor.legendaryActions!.filter(a => a.cost <= (actor.legendary?.points ?? 0));
      if (!affordable.length) continue;
      const foes = get().units.filter(u =>
        u.attitude !== actor.attitude && u.hp > 0 && !u.deathSaves?.dead);
      if (!foes.length) continue;
      const nearest = foes.slice().sort((a, b) =>
        ((a.pos.x - actor.pos.x) ** 2 + (a.pos.y - actor.pos.y) ** 2) - ((b.pos.x - actor.pos.x) ** 2 + (b.pos.y - actor.pos.y) ** 2))[0];
      const distFt = Math.hypot(nearest.pos.x - actor.pos.x, nearest.pos.y - actor.pos.y);
      // 优先攻击型（有可达目标）；否则移动型（接近）；再否则记录型
      const attackAct = affordable.find(a => a.kind === 'attack');
      const ability = attackAct ? (actor.aiAbilities?.find(x => x.name === attackAct.attackName) ?? actor.aiAbilities?.find(x => x.kind === 'melee')) : undefined;
      const inReach = ability && distFt <= (ability.range ?? 5) + 5;
      const chosen = (attackAct && ability && inReach)
        ? attackAct
        : affordable.find(a => a.kind === 'move') ?? (attackAct && ability ? attackAct : affordable.find(a => a.kind === 'note'));
      if (!chosen) continue;
      const spend = () => set({ units: get().units.map(u => (u.id === actor.id && u.legendary
        ? { ...u, legendary: { ...u.legendary, points: Math.max(0, u.legendary.points - chosen.cost) } }
        : u)) });
      if (chosen.kind === 'attack' && ability) {
        const target = (ability.range ?? 5) > distFt ? nearest
          : foes.find(u => Math.hypot(u.pos.x - actor.pos.x, u.pos.y - actor.pos.y) <= (ability.range ?? 5)) ?? nearest;
        const cover = estimateCover(actor, target, get().obstacles, buildBlockedCells(get().obstacles));
        if (cover.cover === 'full') {
          get().logEvent({
            type: 'legendary', actorId: actor.id, targetId: target.id,
            text: `🐉 传奇动作【${chosen.name}】取消 —— ${target.name} 处于全掩护，无法被直接指定（不消耗传奇点）`,
            level: 'info',
          });
        } else {
          get().logEvent({
            type: 'legendary', actorId: actor.id, targetId: target.id,
            text: `🐉 传奇动作【${chosen.name}】（-${chosen.cost}点）—— ${actor.name} 对 ${target.name} 发动【${ability.name}】`,
            level: 'bad',
          });
          spend();
          get().performAttack(actor.id, target.id, {
            attackBonus: ability.attackBonus ?? 0,
            targetAc: target.ac + coverBonus(cover.cover),
            weaponDamage: ability.dice,
            weaponType: ability.damageType,
            coverKind: cover.cover,
          });
        }
      } else if (chosen.kind === 'move') {
        const feet = chosen.moveFeet ?? actor.speed;
        get().logEvent({
          type: 'legendary', actorId: actor.id,
          text: `🐉 传奇动作【${chosen.name}】（-${chosen.cost}点）—— ${actor.name} 移动 ${feet} 尺`,
          level: 'bad',
        });
        spend();
        get().moveToward(actor.id, nearest.id, feet);
      } else {
        get().logEvent({
          type: 'legendary', actorId: actor.id,
          text: `🐉 传奇动作【${chosen.name}】（-${chosen.cost}点）—— ${actor.name}${chosen.description ? `：${chosen.description}` : ''}`,
          level: 'bad',
        });
        spend();
      }
    }
  },

  moveToward: (id, targetId, radiusFeet) => {
    const u = get().units.find(x => x.id === id);
    const target = get().units.find(x => x.id === targetId);
    if (!u || !target) return false;
    const blocked = new Set([...buildBlockedCells(get().obstacles).keys()]);
    const occ = new Set(get().units.filter(x => x.id !== id && x.hp > 0).map(x => `${x.pos.x},${x.pos.y}`));
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    // pos 坐标为英尺：移动半径按英尺，步长 5 尺（1 格）
    for (let dx = -radiusFeet; dx <= radiusFeet; dx += 5) {
      for (let dy = -radiusFeet; dy <= radiusFeet; dy += 5) {
        if (Math.hypot(dx, dy) > radiusFeet) continue;
        const cx = u.pos.x + dx, cy = u.pos.y + dy;
        if (cx < 0 || cy < 0) continue;
        const key = `${cx},${cy}`;
        if ((dx !== 0 || dy !== 0) && (blocked.has(key) || occ.has(key))) continue;
        const d = (cx - target.pos.x) ** 2 + (cy - target.pos.y) ** 2;
        if (d < bestDist) { bestDist = d; best = { x: cx, y: cy }; }
      }
    }
    if (!best || (best.x === u.pos.x && best.y === u.pos.y)) return false;
    set({ units: get().units.map(x => (x.id === id ? { ...x, pos: best! } : x)) });
    return true;
  },

  performSave: (targetId, opts) => {
    const target = get().units.find(u => u.id === targetId);
    if (!target) return 0;
    const r = resolveSave(target, opts);
    set({ lastRoll: { id: uid(), formula: '豁免', result: r.check.dice, note: r.check.label } });
    get().logEvent({
      type: 'save', actorId: targetId,
      text: `${target.name} ${r.check.label}：[${r.check.dice.rawD20}]${r.check.dice.modifier >= 0 ? '+' : ''}${r.check.dice.modifier}=${r.check.total} —— ${r.check.outcome.includes('success') ? '成功' : '失败'}`,
      level: r.check.outcome.includes('success') ? 'good' : 'bad',
    });
    return r.damageTaken;
  },

  quickRoll: (formula, mode = 'normal', note) => {
    try {
      const result = rollFormula(formula, { mode });
      set({ lastRoll: { id: uid(), formula, result, note } });
      const kept = result.rolls.filter(r => r.kept).map(r => r.value).join(',');
      get().logEvent({
        type: 'check',
        text: `🎲 ${formula}${mode !== 'normal' ? `（${mode === 'advantage' ? '优势' : '劣势'}）` : ''} [${kept}]${result.modifier ? (result.modifier > 0 ? '+' : '') + result.modifier : ''} = ${result.total}${note ? ' · ' + note : ''}`,
        level: result.rawD20 === 20 ? 'crit' : result.rawD20 === 1 ? 'bad' : 'info',
      });
      persist(get());
    } catch (e) {
      console.error('骰子公式错误', e);
    }
  },

  // ---------------- AI 回合执行 ----------------

  takeAiStep: () => {
    const s = get();
    if (!s.battleActive || s.turn.ended) return false;
    const unit = s.units.find(u => u.id === s.turn.currentUnitId);
    if (!unit) return false;
    if (!isAiControlled(unit)) return false;

    const ctx = currentAiCtx(s);
    const cacheKey = `${s.turn.round}:${unit.id}:${unit.hp}`;
    if (aiPlanCache.key !== cacheKey) {
      aiPlanCache = { key: cacheKey, steps: planTurn(ctx, unit), replans: 0 };
    }
    if (aiPlanCache.steps.length === 0) {
      get().nextTurn();
      return get().battleActive && get().turn.currentUnitId === unit.id ? false : get().battleActive;
    }

    const step = aiPlanCache.steps[0];
    // 校验失败 → 重规划（最多 2 次），仍失败则丢弃该步
    const needsValidation = ['move', 'attack', 'aoe', 'heal'].includes(step.type);
    if (needsValidation && !validateStep(ctx, unit, step)) {
      if (aiPlanCache.replans < 2) {
        aiPlanCache = { key: cacheKey, steps: planTurn(ctx, get().units.find(u => u.id === unit.id) ?? unit), replans: aiPlanCache.replans + 1 };
        return true;
      }
      aiPlanCache.steps.shift();
      return true;
    }
    aiPlanCache.steps.shift();

    switch (step.type) {
      case 'death-save': {
        get().rollDeathSave(unit.id);
        aiPlanCache.steps = [{ type: 'end-turn' }];
        return true;
      }
      case 'stand-up': {
        const cost = Math.floor(effectiveSpeed(unit) / 2);
        set({
          units: get().units.map(u => (u.id === unit.id
            ? { ...u, statuses: u.statuses.filter(st => st !== 'prone'), actionEconomy: { ...u.actionEconomy, movementUsed: u.actionEconomy.movementUsed + cost } }
            : u)),
        });
        get().logEvent({ type: 'status-remove', actorId: unit.id, text: `${unit.name} 站起（消耗 ${cost} 尺移动力）`, level: 'info' });
        return true;
      }
      case 'disengage': {
        set({
          units: get().units.map(u => (u.id === unit.id
            ? { ...u, statuses: [...new Set([...u.statuses, 'disengaging'])], actionEconomy: { ...u.actionEconomy, action: true } }
            : u)),
        });
        get().logEvent({ type: 'note', actorId: unit.id, text: `🏃 ${unit.name} 使用脱离动作 —— 本回合移动不触发借机攻击`, level: 'info' });
        return true;
      }
      case 'dash': {
        set({
          units: get().units.map(u => (u.id === unit.id
            ? { ...u, actionEconomy: { ...u.actionEconomy, action: true, movementUsed: Math.max(0, u.actionEconomy.movementUsed - effectiveSpeed(u)) } }
            : u)),
        });
        get().logEvent({ type: 'note', actorId: unit.id, text: `💨 ${unit.name} 冲刺！本回合移动力翻倍`, level: 'info' });
        return true;
      }
      case 'move': {
        const cell = step.path[0];
        if (cell) get().moveUnit(unit.id, { x: cellToFeet(cell.cx), y: cellToFeet(cell.cy) });
        return true;
      }
      case 'attack': {
        const ability = unitAbilities(unit).find(a => a.id === step.abilityId);
        const target = get().units.find(u => u.id === step.targetId);
        if (ability && target) {
          // 攻击法术结算法术位（此前仅 AoE/治疗结算；无 spellSlots 模型的天生施法者不设限）
          if (ability.spellLevel && unit.spellSlots) {
            const slot = unit.spellSlots[ability.spellLevel];
            if (!slot || slot.current <= 0) {
              get().logEvent({ type: 'note', actorId: unit.id, text: `⛔ ${unit.name} 的 ${ability.spellLevel} 环法术位不足——【${ability.name}】无法施放`, level: 'info' });
              return true;
            }
            get().spendSpellSlot(unit.id, ability.spellLevel);
          }
          const cover = estimateCover(unit, target, s.obstacles, buildBlockedCells(s.obstacles));
          if (cover.cover === 'full') {
            get().logEvent({ type: 'attack', actorId: unit.id, targetId: target.id, text: `⛔ ${unit.name} 放弃攻击——${target.name} 处于全掩护，无法直接指定`, level: 'info' });
            return true;
          }
          get().logEvent({
            type: 'attack', actorId: unit.id, targetId: target.id,
            text: `${unit.name} 发动【${ability.name}】→ ${target.name}${cover.bonus > 0 ? `（目标${cover.cover === 'half' ? '半身' : '3/4'}掩护 +${cover.bonus}）` : ''}`,
            level: 'info',
          });
          const atkResult = get().performAttack(unit.id, target.id, {
            attackBonus: ability.attackBonus ?? 0,
            targetAc: target.ac + coverBonus(cover.cover),
            weaponDamage: ability.dice,
            weaponType: ability.damageType,
            isRanged: ability.kind === 'ranged',
            coverKind: cover.cover,
          });
          applyMasteryEffects(get(), unit, target, ability, atkResult);
        }
        return true;
      }
      case 'aoe': {
        const ability = unitAbilities(unit).find(a => a.id === step.abilityId);
        if (ability && ability.aoe) {
          set({ units: get().units.map(u => (u.id === unit.id ? { ...u, actionEconomy: { ...u.actionEconomy, action: true } } : u)) });
          // AI 施法同样消耗法术位（此前绕过 castAbility 导致无限火球）
          if (ability.spellLevel) get().spendSpellSlot(unit.id, ability.spellLevel);
          get().addAoeTemplate({
            kind: ability.aoe.kind, size: ability.aoe.size,
            origin: step.origin, angle: step.angle,
            color: 'rgba(240,120,40,0.35)', label: ability.name,
          });
          const dmg = rollFormula(ability.dice);
          set({ lastRoll: { id: uid(), formula: ability.dice, result: dmg, note: `${ability.name} 伤害` } });
          get().logEvent({
            type: 'attack', actorId: unit.id,
            text: `🔥 ${unit.name} 施放【${ability.name}】！伤害 ${dmg.total} —— 波及 ${step.targets.length} 个单位`,
            level: 'crit',
          });
          for (const tid of step.targets) {
            const t = get().units.find(u => u.id === tid);
            if (!t || t.hp <= 0 || t.deathSaves?.dead) continue;
            const r = resolveSave(t, {
              ability: (ability.saveAbility ?? 'dex'),
              dc: ability.saveDc ?? 13,
              halfOnSuccess: ability.halfOnSuccess,
              sourceDamage: dmg.total,
            });
            get().logEvent({
              type: 'save', actorId: tid,
              text: `${t.name} ${ability.saveAbility?.toUpperCase() ?? 'DEX'} 豁免 [${r.check.dice.rawD20}]=${r.check.total} vs DC${ability.saveDc ?? 13} —— ${r.check.outcome.includes('success') ? '成功（半伤）' : '失败（全额伤害）'}`,
              level: r.check.outcome.includes('success') ? 'good' : 'bad',
            });
            const applied = get().damageUnit(tid, r.damageTaken, { type: ability.damageType, source: unit.id });
            // 专注检定用类型修正后的实际扣血（抗性减免不应抬高专注 DC）
            get().concentrationAfterDamage(tid, applied);
          }
        }
        return true;
      }
      case 'heal': {
        const ability = unitAbilities(unit).find(a => a.id === step.abilityId);
        const t = get().units.find(u => u.id === step.targetId);
        if (ability && t) {
          // AI 治疗法术同样消耗法术位
          if (ability.spellLevel) get().spendSpellSlot(unit.id, ability.spellLevel);
          const r = rollFormula(ability.dice);
          set({
            lastRoll: { id: uid(), formula: ability.dice, result: r, note: `${ability.name} 治疗` },
            units: get().units.map(u => (u.id === unit.id
              ? { ...u, actionEconomy: { ...u.actionEconomy, action: true } }
              : u)),
          });
          get().logEvent({
            type: 'heal', actorId: unit.id, targetId: t.id,
            text: `💚 ${unit.name} 使用【${ability.name}】治疗 ${t.name} ${r.total} 点`,
            level: 'good',
          });
          get().healUnit(t.id, r.total);
        }
        return true;
      }
      case 'flee-note': {
        get().logEvent({ type: 'note', actorId: unit.id, text: step.text, level: 'bad' });
        return true;
      }
      case 'end-turn': {
        clearAiPlanCache();
        get().nextTurn();
        return get().battleActive;
      }
      default:
        return true;
    }
  },

  loadDemoBattle: () => {
    clearAiPlanCache();
    const demo = buildDemoBattle();
    set({
      units: [],
      obstacles: demo.obstacles,
      aoeTemplates: [],
      events: [],
      battleActive: false,
      playerTargetId: null,
      multiAttackQueue: null,
      battleName: demo.battleName,
      mapConfig: { ...get().mapConfig, width: 22, height: 9, cellSize: 5, diagonal: 'equal' },
      turn: { round: 0, currentUnitId: null, order: [], turnIndex: -1, ended: false, surprisedIds: [] },
    });
    for (const u of demo.units) get().addUnit(u);
    get().logEvent({
      type: 'note',
      text: `🎮 演示遭遇「${demo.battleName}」已载入 —— 点击「开始战斗」体验 2.5D 地图与 AI 行动逻辑（牧师/法师默认 AI 托管，可在单位详情中切换玩家操控）`,
      level: 'info',
    });
    persist(get());
  },

  // ---------------- 地图 ----------------

  addObstacle: (cells, kind) => {
    set({ obstacles: [...get().obstacles, { cells, kind }] });
    persist(get());
  },

  clearObstacles: () => {
    set({ obstacles: [] });
    persist(get());
  },

  addAoeTemplate: (t) => {
    set({ aoeTemplates: [...get().aoeTemplates, { ...t, id: uid() }] });
    persist(get());
  },

  updateAoeTemplate: (id, patch) => {
    set({ aoeTemplates: get().aoeTemplates.map(t => (t.id === id ? { ...t, ...patch } : t)) });
    persist(get());
  },

  removeAoeTemplate: (id) => {
    set({ aoeTemplates: get().aoeTemplates.filter(t => t.id !== id) });
    persist(get());
  },

  clearAoeTemplates: () => {
    set({ aoeTemplates: [] });
    persist(get());
  },

  setMapConfig: (patch) => {
    set({ mapConfig: { ...get().mapConfig, ...patch } });
    persist(get());
  },

  // ---------------- 协议 ----------------

  importBattleBlock: (raw, source = 'import') => {
    const parsed = parseDmMessage(raw);
    const list = parsed.latestBattle;
    if (!list || list.length === 0) return { added: 0, updated: 0 };
    const prevUnits = get().units;
    // 智能检测：快照与现有单位完全不相交 → 视为新遭遇，清场重建
    const hasOverlap = list.some(p => prevUnits.some(u => u.id === p.id));
    const isNewEncounter = source === 'embed' && prevUnits.length > 0 && !hasOverlap;
    if (isNewEncounter) {
      get().logEvent({ type: 'note', text: '🆕 检测到新遭遇 —— 战场已重置，等待掷先攻开战', level: 'info' });
      // 新遭遇：清场并重置为战前状态（回合/惊讶名单归零，掷先攻按钮重新可用）
      set({
        battleActive: false,
        turn: { round: 0, currentUnitId: null, order: [], turnIndex: -1, ended: false, surprisedIds: [] },
      });
    }
    // 面板权威：战斗进行中时 AI 块是过期快照（AI 不知道面板已结算的伤亡/移动/先攻掷骰）
    const protectRuntime = get().battleActive && get().rules.authorityMode !== 'ai-legacy';
    let added = 0, updated = 0;
    const baseUnits: BattleUnit[] = isNewEncounter ? [] : [...prevUnits];
    const nextUnits: BattleUnit[] = baseUnits;
    let nextActorId: string | null = null;
    const newIds: string[] = [];
    const conflicts: MergeRuntimeConflict[] = [];
    for (const p of list) {
      const idx = nextUnits.findIndex(u => u.id === p.id);
      if (idx >= 0) {
        const r = mergeUnitFromProtocol(nextUnits[idx], p, protectRuntime);
        nextUnits[idx] = r.unit;
        conflicts.push(...r.conflicts);
        updated++;
      } else {
        const r = mergeUnitFromProtocol(undefined, p, false);
        nextUnits.push(r.unit);
        newIds.push(p.id);
        added++;
      }
      // next 标记仅兼容旧卡流（AI 权威、每楼结算驱动回合）；面板权威模式下回合由掷先攻·开战按钮与面板推进
      if (p.next && get().rules.authorityMode === 'ai-legacy') nextActorId = p.id;
    }

    // 战前：surprise 标记 → 惊讶名单（开战掷先攻时劣势/首轮跳过）
    if (!get().battleActive) {
      const surprisedIds = list.filter(p => p.surprised).map(p => p.id);
      if (surprisedIds.length > 0) {
        set({ turn: { ...get().turn, surprisedIds } });
        const names = surprisedIds.map(id => nextUnits.find(u => u.id === id)?.name ?? id);
        get().logEvent({ type: 'note', text: `😮 惊讶方：${names.join('、')}（先攻劣势）`, level: 'info' });
      }
    }

    // 自动配装：所有仍为瘦数据的单位（新入库 + 之前未配装的） ← 暂存敌卡 / 角色名单 / 图鉴 / 预设
    let finalUnits = nextUnits;
    const attachIds = nextUnits.filter(u => u.dataSource === 'ai-parsed').map(u => u.id);
    if (attachIds.length > 0) {
      const s = get();
      const att = attachLibraryData(nextUnits, attachIds, {
        staged: s.stagedStatblocks,
        bestiary: s.bestiary,
        sheets: s.rosterSheets,
      });
      finalUnits = att.units;
      for (const r of att.reports) {
        get().logEvent({ type: 'unit-add', text: r, level: 'info' });
      }
    }

    // 增援入场掷先攻（2024：战斗中途加入的生物在加入时掷先攻；配装后敏捷已知）
    const wasBattleActive = get().battleActive;
    if (wasBattleActive && newIds.length > 0) {
      const { rules } = get();
      const reinforceUnits = finalUnits.filter(u => newIds.includes(u.id) && u.hp > 0 && !u.deathSaves?.dead);
      const needsRoll = rules.authorityMode !== 'ai-legacy'
        ? reinforceUnits // 面板权威：入场必掷
        : reinforceUnits.filter(u => !list.some(p => p.id === u.id && p.init !== undefined)); // 兼容模式：AI 给了就用
      if (needsRoll.length > 0) {
        const { rolls, initById } = rollInitiativeForUnits(needsRoll, rules, []);
        finalUnits = finalUnits.map(u => {
          const rolled = initById.get(u.id);
          return rolled !== undefined ? { ...u, init: rolled, initRolled: true } : u;
        });
        for (const r of rolls) {
          const u = needsRoll.find(x => x.id === r.id);
          get().logEvent({ type: 'unit-add', actorId: r.id, text: `🆕 增援入场：${u?.name ?? r.id} —— 掷先攻 ${r.detail}`, level: 'info' });
        }
      }
    }

    // 无 next 标记且不在战斗中：战前集结态（掷先攻·开战按钮可用，PHB：位置→掷先攻→行动）
    // 有 next 标记（旧卡流）或战斗进行中：直接进入/延续战斗态
    set({ units: finalUnits, battleActive: nextActorId !== null || wasBattleActive });

    // 更新回合状态
    if (nextActorId) {
      // 兼容模式：next 标记驱动当前行动者（旧卡每楼结算流）
      const order = buildInitiativeOrder(finalUnits, get().rules, 0);
      const idx = order.indexOf(nextActorId);
      set({
        turn: {
          ...get().turn,
          order,
          currentUnitId: nextActorId,
          turnIndex: idx >= 0 ? idx : 0,
          ended: false,
          round: get().turn.round > 0 ? get().turn.round : 1,
        },
        units: finalUnits.map(u => (u.id === nextActorId ? { ...u, hasActed: false } : u)),
      });
    } else if (wasBattleActive) {
      // 战斗进行中：重建顺序但保持当前行动者（增援按先攻值插入序列，不打断当前回合）
      set({ turn: rebuildOrderKeepActor(finalUnits, get().rules, get().turn, Date.now() % 100000) });
    }

    // 面板权威冲突警告：AI 过期数值已被拦截
    if (conflicts.length > 0) {
      const FIELD_CN: Record<MergeRuntimeConflict['field'], string> = { hp: 'HP', pos: '位置', init: '先攻' };
      const parts = conflicts.map(c => {
        const u = finalUnits.find(x => x.id === c.id);
        return `${u?.name ?? c.id}（${FIELD_CN[c.field]} AI:${c.aiValue} ≠ 面板:${c.panelValue}）`;
      });
      get().logEvent({
        type: 'note',
        text: `🛡️ 战斗进行中：AI 数据为过期快照，${parts.length} 处数值不一致已保留面板结算值 —— ${parts.join('；')}`,
        level: 'crit',
      });
    }

    // 记录快照 + diff
    const snap = snapshotFromParsed(list, source);
    const prevSnap = findPrevSnapshot(snap.ts);
    const diff = diffSnapshots(prevSnap, snap);
    appendHistory(snap);
    set({ history: loadHistory(), lastDiff: diff });

    // diff 摘要日志（面板权威模式下 diff 反映 AI 声称的变化，仅作对照，不代表面板数值）
    const summary = diff.unitDiffs
      .filter(d => d.hpDelta !== 0 || d.isNew || d.died || d.revived || d.posDelta)
      .map(d => {
        const u = nextUnits.find(x => x.id === d.id);
        const parts: string[] = [];
        if (d.isNew) parts.push('登场');
        if (d.hpDelta < 0) parts.push(`HP${d.hpDelta}`);
        if (d.hpDelta > 0) parts.push(`HP+${d.hpDelta}`);
        if (d.died) parts.push('倒地');
        if (d.revived) parts.push('苏醒');
        if (d.posDelta) parts.push('移动');
        return `${u?.name ?? d.id}: ${parts.join(' ')}`;
      });
    if (summary.length > 0) {
      get().logEvent({ type: 'note', text: `📥 同步战斗快照 —— ${summary.join('；')}`, level: 'info' });
    }
    persist(get(), true); // 协议导入属权威写入，穿透只读锁
    return { added, updated };
  },

  importDmMessage: (text, source = 'import', depth = null) => {
    // 哈希链门控（仅嵌入自动导入；手动粘贴 = 用户显式意图，始终应用）
    if (source === 'embed') {
      const s0 = get();
      const hash = fnv1a(text);
      const verdict = shouldApplyImport(s0.importChain, hash, depth);
      if (!verdict.apply) {
        if (verdict.reason === 'duplicate') {
          get().logEvent({ type: 'note', text: ` ↩️ 本楼数据已同步过（哈希 ${hash}），跳过重复导入`, level: 'info' });
        } else {
          get().logEvent({ type: 'note', text: ` ↩️ 本楼为较早楼层（深度 ${depth}），已由更新的面板接管，跳过导入`, level: 'info' });
        }
        return [];
      }
      // 嵌入导入前先对齐共享存储（非领导者面板可能内存过期），再把本条哈希入链
      if (get().readOnly) {
        get().hydrateFromPersisted();
      }
      set({ importChain: appendChain(get().importChain, hash, depth) });
    }
    const parsed = parseDmMessage(text);
    // 1) 变量更新 → 变量树累积 → 角色名单同步
    if (parsed.patches.length > 0) {
      const s = get();
      const tree: VarTree = JSON.parse(JSON.stringify(s.varTree ?? {}));
      const res = applyPatches(tree, parsed.patches);
      set({ varTree: tree });
      const names = get().syncRosterFromTree();
      get().logEvent({
        type: 'note',
        text: `📥 变量同步：${res.applied} 条补丁 · 名单 ${names.length} 人${names.length > 0 ? `（${names.join('、')}）` : ''}`,
        level: 'info',
      });
      if (res.errors.length > 0) {
        get().logEvent({ type: 'note', text: `⚠️ ${res.errors.length} 条补丁应用失败：${res.errors[0]}`, level: 'bad' });
      }
    }
    // 2) 敌卡块 → 遭遇暂存区（<battle> 触发时自动配装）
    if (parsed.statblockBlocks.length > 0) {
      let total = 0;
      const warnings: string[] = [];
      for (const block of parsed.statblockBlocks) {
        const r = parseEncounterDefs(block);
        total += r.defs.length;
        warnings.push(...r.warnings);
        if (r.defs.length > 0) get().stageStatblockDefs(r.defs);
      }
      if (total > 0) {
        get().logEvent({ type: 'note', text: `📋 遭遇暂存：${total} 张敌卡已就绪 —— <battle> 触发时自动配装`, level: 'info' });
      }
      if (warnings.length > 0) {
        get().logEvent({ type: 'note', text: `⚠️ 敌卡解析警告：${warnings.slice(0, 3).join('；')}`, level: 'bad' });
      }
    }
    // 3) 战斗块 → 合并 + 自动配装
    if (parsed.latestBattle) {
      get().importBattleBlock(text, source);
    }
    // 检定卡片转为日志（战斗进行中：DM 叙事性检定仅记录，不作为结算依据）
    for (const c of parsed.checks) {
      const f = c.fields;
      const who = f['发动者'] ?? f['发动技能'] ?? '?';
      const target = f['目标'] ?? '';
      const action = f['行动'] ?? '';
      const outcome = f['判定结果'] ?? '';
      get().logEvent({
        type: 'check',
        text: `🎯 ${who}${action ? ` · ${action}` : ''}${target ? ` → ${target}` : ''}：${outcome}`,
        level: outcome.includes('大成功') ? 'crit' : outcome.includes('大失败') ? 'bad' : outcome.includes('成功') ? 'good' : 'info',
        data: { fields: f },
      });
    }
    persist(get(), true); // 协议导入属权威写入，穿透只读锁
    return parsed.checks;
  },

  generateExportBlock: (withNext = true) => {
    const units = get().units.filter(u => !u.deathSaves?.dead);
    return generateBattleBlock(units.map(u => ({
      id: u.id,
      init: u.init,
      hp: Math.max(0, u.hp),
      maxHp: u.maxHp,
      pos: u.pos,
      attitude: u.attitude,
      statuses: u.statuses,
      portrait: u.portrait,
      next: withNext && u.id === get().turn.currentUnitId,
    })));
  },

  exportWarReport: () => {
    const s = get();
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      battleName: s.battleName,
      units: s.units,
      obstacles: s.obstacles,
      mapConfig: s.mapConfig,
      turn: s.turn,
      events: s.events,
      rules: s.rules,
    }, null, 2);
  },

  importWarReport: (json) => {
    try {
      const data = JSON.parse(json);
      if (!data.units || !Array.isArray(data.units)) return false;
      set({
        units: data.units,
        obstacles: data.obstacles ?? [],
        mapConfig: data.mapConfig ?? get().mapConfig,
        turn: data.turn ?? get().turn,
        events: data.events ?? [],
        rules: data.rules ? { ...get().rules, ...normalizeRules(data.rules) } : get().rules,
        battleName: data.battleName ?? '导入战报',
        battleActive: true,
      });
      engineSetRules(get().rules);
      persist(get());
      return true;
    } catch {
      return false;
    }
  },

  // ---------------- 数据层：名单 / 图鉴 / 暂存 ----------------

  syncRosterFromTree: () => {
    const sheets = charSheetsFromTree(get().varTree ?? {});
    set({ rosterSheets: sheets });
    saveRoster({ tree: get().varTree ?? {}, sheets });
    return sheets.map(s => s.name);
  },

  stageStatblockDefs: (defs, replace = false) => {
    const cur = replace ? [] : [...(get().stagedStatblocks ?? [])];
    for (const d of defs) {
      const idx = cur.findIndex(x => x.name === d.name);
      if (idx >= 0) cur[idx] = d;
      else cur.push(d);
    }
    set({ stagedStatblocks: cur });
    persist(get());
  },

  clearStagedStatblocks: () => {
    set({ stagedStatblocks: [] });
    persist(get());
  },

  bestiaryUpsert: (def) => {
    const cur = [...(get().bestiary ?? [])];
    const idx = cur.findIndex(x => x.id === def.id || x.name === def.name);
    if (idx >= 0) cur[idx] = def;
    else cur.push(def);
    set({ bestiary: cur });
    saveBestiary(cur);
    persist(get());
  },

  bestiaryRemove: (id) => {
    const cur = (get().bestiary ?? []).filter(x => x.id !== id);
    set({ bestiary: cur });
    saveBestiary(cur);
    persist(get());
  },

  addUnitFromStatblock: (def, hostile = true) => {
    const existing = get().units;
    const count = existing.filter(u => u.name.startsWith(def.name)).length;
    const unit = unitFromStatblock(def, count, hostile);
    const col = hostile ? get().mapConfig.width - 2 - Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
    const row = 1 + Math.floor(Math.random() * Math.max(1, get().mapConfig.height - 2));
    unit.pos = { x: col * 5, y: row * 5 };
    set({ units: [...get().units, unit] });
    get().logEvent({ type: 'unit-add', actorId: unit.id, text: `${unit.name} 登场（CR ${def.cr} · HP ${def.hp} · AC ${def.ac} · ${def.attacks.length} 动作）`, level: 'info' });
    persist(get());
  },

  addUnitFromSheet: (name, isPlayer = false) => {
    const sheet = get().rosterSheets.find(s => s.name === name);
    if (!sheet) return;
    const existing = get().units;
    const count = existing.filter(u => u.name.startsWith(sheet.name)).length;
    const unit = unitFromCharSheet(sheet, {
      isPlayer,
      init: 10 + sheet.initMod,
    });
    if (count > 0) { unit.id = `${sheet.name}${count + 1}`; unit.name = unit.id; }
    const col = 1 + Math.floor(Math.random() * 2);
    const row = 1 + Math.floor(Math.random() * Math.max(1, get().mapConfig.height - 2));
    unit.pos = { x: col * 5, y: row * 5 };
    if (!isPlayer) unit.playerControlled = false; // 队友默认 AI 托管，可随时切换
    set({ units: [...get().units, unit] });
    get().logEvent({
      type: 'unit-add', actorId: unit.id,
      text: `🧙 ${unit.name} 登场（Lv.${sheet.level} · HP ${unit.hp}/${unit.maxHp} · AC ${unit.ac} · 武器×${sheet.weapons.length}${sheet.spells.some(s => s.matched) ? ` · 法术×${sheet.spells.filter(s => s.matched).length}` : ''}）`,
      level: 'good',
    });
    persist(get());
  },

  rosterRemove: (name) => {
    const sheets = (get().rosterSheets ?? []).filter(s => s.name !== name);
    const tree = { ...(get().varTree ?? {}) };
    if (tree['角色列表'] && typeof tree['角色列表'] === 'object') {
      const list = { ...(tree['角色列表'] as Record<string, unknown>) };
      delete list[name];
      tree['角色列表'] = list;
    }
    set({ rosterSheets: sheets, varTree: tree });
    saveRoster({ tree, sheets });
    persist(get());
  },

  generateEncounterText: () => generateEncounterBlock(get().stagedStatblocks ?? []),

  generateBattleResult: () => {
    const s = get();
    return generateBattleResultBlock({
      battleName: s.battleName,
      turn: s.turn,
      battleActive: s.battleActive,
      units: s.units,
      rosterSheets: s.rosterSheets ?? [],
    });
  },

  setReadOnly: (v) => set({ readOnly: v }),

  hydrateFromPersisted: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      set({
        units: data.units ?? [],
        obstacles: data.obstacles ?? [],
        mapConfig: data.mapConfig ?? get().mapConfig,
        turn: data.turn ?? get().turn,
        events: data.events ?? [],
        rules: data.rules ? { ...get().rules, ...normalizeRules(data.rules) } : get().rules,
        battleActive: data.battleActive ?? false,
        battleName: data.battleName ?? get().battleName,
        playerTargetId: data.playerTargetId ?? null,
        multiAttackQueue: null,
        varTree: data.varTree ?? get().varTree,
        rosterSheets: data.rosterSheets ?? get().rosterSheets,
        stagedStatblocks: data.stagedStatblocks ?? [],
        importChain: data.importChain ?? get().importChain,
      });
      engineSetRules(get().rules);
      return true;
    } catch {
      return false;
    }
  },

  // ---------------- 统一行动结算 ----------------

  /** 多重攻击击杀后续打：不重复消耗动作经济/法术位；射程/全掩护守卫与 castAbility 同款 */
  continueMultiAttack: (actorId, abilityId, targetId) => {
    const s = get();
    const queue = s.multiAttackQueue;
    if (!queue || queue.actorId !== actorId || queue.abilityId !== abilityId) return;
    const actor = s.units.find(u => u.id === actorId);
    const ability = actor?.aiAbilities?.find(a => a.id === abilityId);
    const target = targetId ? s.units.find(u => u.id === targetId) : undefined;
    if (!actor || !ability || !target) { set({ multiAttackQueue: null }); return; }
    if (target.hp <= 0 || target.deathSaves?.dead) {
      get().logEvent({ type: 'note', text: `⛔ ${target.name} 已倒下——请选择存活目标`, level: 'bad' });
      return; // 保留队列，等待重选
    }
    const dist = unitDistance(actor, target, s.mapConfig.diagonal);
    if (dist > ability.range + 5) {
      get().logEvent({ type: 'note', text: `⛔ 超出射程：${target.name} 距离 ${dist} 尺 > ${ability.range} 尺（可先移动再续打）`, level: 'bad' });
      return; // 保留队列
    }
    const coverPre = estimateCover(actor, target, s.obstacles, buildBlockedCells(s.obstacles));
    if (coverPre.cover === 'full') {
      get().logEvent({ type: 'note', text: `⛔ ${target.name} 处于全掩护——无法被直接指定为攻击目标（2024 规则）`, level: 'bad' });
      return; // 保留队列
    }
    set({ multiAttackQueue: null });
    get().logEvent({
      type: 'attack', actorId, targetId: target.id,
      text: `${actor.name} 续打【${ability.name}】×${queue.remaining}（多重攻击余量） → ${target.name}${coverPre.bonus > 0 ? `（目标${coverPre.cover === 'half' ? '半身' : '3/4'}掩护 +${coverPre.bonus}）` : ''}`,
      level: 'info',
    });
    runMultiAttackSequence(get, set, actorId, ability, target.id, queue.remaining);
  },

  clearMultiAttackQueue: () => set({ multiAttackQueue: null }),

  castAbility: (actorId, abilityId, targetId, opts = {}) => {
    const s = get();
    const actor = s.units.find(u => u.id === actorId);
    if (!actor) return;
    const ability = (actor.aiAbilities ?? []).find(a => a.id === abilityId);
    if (!ability) {
      get().logEvent({ type: 'note', text: `⚠️ 未找到动作：${abilityId}`, level: 'bad' });
      return;
    }
    const target = targetId ? s.units.find(u => u.id === targetId) : undefined;
    const isCurrentActor = s.battleActive && s.turn.currentUnitId === actorId;

    // 失能检查
    const agg = aggregateEffects(actor.statuses);
    if (agg.noActions) {
      get().logEvent({ type: 'note', text: `⛔ ${actor.name} 失能，无法行动`, level: 'bad' });
      return;
    }

    // 动作经济
    const cost: 'action' | 'bonus' = ability.bonusAction ? 'bonus' : 'action';
    if (isCurrentActor && !opts.ignoreEconomy) {
      if (cost === 'action' && actor.actionEconomy.action) {
        get().logEvent({ type: 'note', text: `⛔ ${actor.name} 的动作已用尽`, level: 'bad' });
        return;
      }
      if (cost === 'bonus' && actor.actionEconomy.bonus) {
        get().logEvent({ type: 'note', text: `⛔ ${actor.name} 的附赠动作已用尽`, level: 'bad' });
        return;
      }
    }

    // 法术位检查
    const slotLevel = ability.spellLevel ?? 0;
    if (slotLevel > 0) {
      const slot = actor.spellSlots?.[slotLevel];
      if (!slot || slot.current <= 0) {
        get().logEvent({ type: 'note', text: `⛔ ${actor.name} 的 ${slotLevel} 环法术位不足`, level: 'bad' });
        return;
      }
    }

    // 目标与射程
    const needsTarget = ability.kind === 'melee' || ability.kind === 'ranged' || ability.kind === 'save' || ability.kind === 'heal';
    if (needsTarget && !target) {
      get().logEvent({ type: 'note', text: `⛔【${ability.name}】需要选择目标`, level: 'bad' });
      return;
    }
    if (needsTarget && target) {
      const dist = unitDistance(actor, target, s.mapConfig.diagonal);
      if (dist > ability.range) {
        get().logEvent({ type: 'note', text: `⛔ 超出射程：${target.name} 距离 ${dist} 尺 > ${ability.range} 尺`, level: 'bad' });
        return;
      }
    }
    if (ability.kind === 'save-aoe' && !target && !opts.originPos) {
      get().logEvent({ type: 'note', text: `⛔【${ability.name}】需要选择 AoE 落点目标`, level: 'bad' });
      return;
    }
    // 2024 全掩护：目标不能被攻击或伤害法术直接指定（借机/传奇/AI 攻击路径有同款守卫）
    if (target && (ability.kind === 'melee' || ability.kind === 'ranged')) {
      const coverPre = estimateCover(actor, target, s.obstacles, buildBlockedCells(s.obstacles));
      if (coverPre.cover === 'full') {
        get().logEvent({ type: 'note', text: `⛔ ${target.name} 处于全掩护——无法被直接指定为攻击目标（2024 规则）`, level: 'bad' });
        return;
      }
    }

    const prevActionUsed = actor.actionEconomy.action;

    switch (ability.kind) {
      case 'melee':
      case 'ranged': {
        if (!target) return;
        const times = Math.max(1, ability.multiAttack ?? 1);
        const cover = estimateCover(actor, target, s.obstacles, buildBlockedCells(s.obstacles));
        get().logEvent({
          type: 'attack', actorId, targetId: target.id,
          text: `${actor.name} 发动【${ability.name}】${times > 1 ? `×${times}（多重攻击）` : ''} → ${target.name}${cover.bonus > 0 ? `（目标${cover.cover === 'half' ? '半身' : '3/4'}掩护 +${cover.bonus}）` : ''}`,
          level: 'info',
        });
        runMultiAttackSequence(get, set, actorId, ability, target.id, times);
        break;
      }
      case 'heal': {
        if (!target) return;
        const r = rollFormula(ability.dice);
        set({ lastRoll: { id: uid(), formula: ability.dice, result: r, note: `${ability.name} 治疗` } });
        get().logEvent({
          type: 'heal', actorId, targetId: target.id,
          text: `💚 ${actor.name} 施放【${ability.name}】治疗 ${target.name} ${r.total} 点`,
          level: 'good',
        });
        get().healUnit(target.id, r.total);
        break;
      }
      case 'save': {
        if (!target) return;
        const dmgRoll = rollFormula(ability.dice);
        if (!ability.saveAbility) {
          // 自动命中型（如魔法飞弹）
          set({ lastRoll: { id: uid(), formula: ability.dice, result: dmgRoll, note: ability.name } });
          get().logEvent({
            type: 'attack', actorId, targetId: target.id,
            text: `🔮 ${actor.name} 施放【${ability.name}】—— 自动命中 ${target.name}，伤害 ${dmgRoll.total}`,
            level: 'crit',
          });
          const appliedAuto = get().damageUnit(target.id, dmgRoll.total, { type: ability.damageType, source: actorId });
          // 受伤专注检定（法术伤害同样打断专注；用类型修正后的实际扣血）
          get().concentrationAfterDamage(target.id, appliedAuto);
        } else {
          const r = resolveSave(target, {
            ability: ability.saveAbility,
            dc: ability.saveDc ?? 13,
            halfOnSuccess: ability.halfOnSuccess,
            sourceDamage: dmgRoll.total,
          });
          set({ lastRoll: { id: uid(), formula: '豁免', result: r.check.dice, note: ability.name } });
          const passed = r.check.outcome.includes('success');
          get().logEvent({
            type: 'save', actorId, targetId: target.id,
            text: `${actor.name} 施放【${ability.name}】→ ${target.name} ${ability.saveAbility.toUpperCase()} 豁免 [${r.check.dice.rawD20}]=${r.check.total} vs DC${ability.saveDc ?? 13} —— ${passed ? (r.halfApplied ? `成功（半伤 ${r.damageTaken}）` : '成功（完全抵抗）') : `失败！${r.damageTaken > 0 ? `受到 ${r.damageTaken} 伤害` : ''}${ability.applyStatus ? `，获得【${ability.applyStatus}】` : ''}`}`,
            level: passed ? 'info' : 'bad',
          });
          const appliedSave = r.damageTaken > 0
            ? get().damageUnit(target.id, r.damageTaken, { type: ability.damageType, source: actorId })
            : 0;
          get().concentrationAfterDamage(target.id, appliedSave);
          if (!passed && ability.applyStatus) {
            set({ units: get().units.map(u => (u.id === target.id ? { ...u, statuses: [...new Set([...u.statuses, ability.applyStatus!])] } : u)) });
          }
        }
        break;
      }
      case 'save-aoe': {
        if (!ability.aoe) {
          get().logEvent({ type: 'note', text: `⚠️【${ability.name}】缺少 AoE 定义`, level: 'bad' });
          return;
        }
        const origin = opts.originPos ?? target?.pos ?? actor.pos;
        const angle = opts.angle ?? (target ? Math.atan2(target.pos.y - actor.pos.y, target.pos.x - actor.pos.x) : 0);
        const template: AoeTemplate = { id: uid(), kind: ability.aoe.kind, size: ability.aoe.size, origin, angle, color: 'rgba(240,120,40,0.35)', label: ability.name };
        const affected = aoeCells(template, get().units).affectedUnitIds.filter(id => id !== actorId);
        get().addAoeTemplate({ kind: template.kind, size: template.size, origin: template.origin, angle: template.angle, color: template.color, label: template.label });
        const dmgRoll = rollFormula(ability.dice);
        set({ lastRoll: { id: uid(), formula: ability.dice, result: dmgRoll, note: `${ability.name} 伤害` } });
        get().logEvent({
          type: 'attack', actorId,
          text: `🔥 ${actor.name} 施放【${ability.name}】！伤害 ${dmgRoll.total} —— 波及 ${affected.length} 个单位`,
          level: 'crit',
        });
        for (const tid of affected) {
          const t = get().units.find(u => u.id === tid);
          if (!t || t.hp <= 0 || t.deathSaves?.dead) continue;
          if (ability.saveAbility) {
            const r = resolveSave(t, {
              ability: ability.saveAbility,
              dc: ability.saveDc ?? 13,
              halfOnSuccess: ability.halfOnSuccess,
              sourceDamage: dmgRoll.total,
            });
            get().logEvent({
              type: 'save', actorId: tid,
              text: `${t.name} ${ability.saveAbility.toUpperCase()} 豁免 [${r.check.dice.rawD20}]=${r.check.total} vs DC${ability.saveDc ?? 13} —— ${r.check.outcome.includes('success') ? (r.halfApplied ? `成功（半伤 ${r.damageTaken}）` : '成功') : `失败（受到 ${r.damageTaken} 伤害）`}`,
              level: r.check.outcome.includes('success') ? 'good' : 'bad',
            });
            const appliedAoeSave = r.damageTaken > 0
              ? get().damageUnit(tid, r.damageTaken, { type: ability.damageType, source: actorId })
              : 0;
            get().concentrationAfterDamage(tid, appliedAoeSave);
            if (!r.check.outcome.includes('success') && ability.applyStatus) {
              set({ units: get().units.map(u => (u.id === tid ? { ...u, statuses: [...new Set([...u.statuses, ability.applyStatus!])] } : u)) });
            }
          } else if (dmgRoll.total > 0) {
            const appliedAoeAuto = get().damageUnit(tid, dmgRoll.total, { type: ability.damageType, source: actorId });
            get().concentrationAfterDamage(tid, appliedAoeAuto);
          }
        }
        break;
      }
    }

    // ---- 消耗：动作经济 + 法术位 + 状态 + 专注 ----
    set({
      units: get().units.map(u => {
        if (u.id !== actorId) return u;
        let next: BattleUnit = { ...u };
        if (isCurrentActor && !opts.ignoreEconomy) {
          const eco = { ...next.actionEconomy };
          if (cost === 'bonus') {
            eco.bonus = true;
            if (!prevActionUsed) eco.action = false; // performAttack 误置动作 → 附赠动作恢复
          } else {
            eco.action = true;
          }
          next.actionEconomy = eco;
        }
        if (slotLevel > 0 && next.spellSlots?.[slotLevel] && next.spellSlots[slotLevel].current > 0) {
          next.spellSlots = {
            ...next.spellSlots,
            [slotLevel]: { ...next.spellSlots[slotLevel], current: next.spellSlots[slotLevel].current - 1 },
          };
        }
        if (ability.kind === 'melee' || ability.kind === 'ranged') {
          // 攻击暴露隐藏位置 / 消耗协助优势
          next.statuses = next.statuses.filter(st => st !== 'hiding' && st !== 'helped');
        }
        if (ability.concentration) next.concentration = ability.name;
        return next;
      }),
    });
    if (ability.concentration) {
      if (actor.concentration && actor.concentration !== ability.name) {
        get().logEvent({ type: 'concentration', actorId, text: `${actor.name} 的旧专注【${actor.concentration}】被【${ability.name}】取代`, level: 'info' });
      }
      get().logEvent({ type: 'concentration', actorId, text: `${actor.name} 开始专注：${ability.name}`, level: 'info' });
    }
    if (slotLevel > 0) {
      const u2 = get().units.find(u => u.id === actorId);
      if (u2?.spellSlots?.[slotLevel]) {
        get().logEvent({ type: 'spell-slot', actorId, text: `${actor.name} 消耗 ${slotLevel} 环法术位（余 ${u2.spellSlots[slotLevel].current}/${u2.spellSlots[slotLevel].max}）`, level: 'info' });
      }
    }
    if (actor.attitude === 0 && target && (ability.kind === 'melee' || ability.kind === 'ranged')) {
      set({ playerTargetId: target.id });
    }
    persist(get());
  },

  playerAction: (kind, unitId, targetId) => {
    const s = get();
    const unit = s.units.find(u => u.id === unitId);
    if (!unit || unit.hp <= 0) return;
    const isCurrent = s.battleActive && s.turn.currentUnitId === unitId;
    const consume = (field: 'action' | 'bonus') => {
      set({ units: get().units.map(u => (u.id === unitId ? { ...u, actionEconomy: { ...u.actionEconomy, [field]: true } } : u)) });
    };
    const addSelfStatus = (st: string) => {
      set({ units: get().units.map(u => (u.id === unitId ? { ...u, statuses: [...new Set([...u.statuses, st])] } : u)) });
    };
    const needAction = () => {
      if (isCurrent && unit.actionEconomy.action) {
        get().logEvent({ type: 'note', text: `⛔ ${unit.name} 的动作已用尽`, level: 'bad' });
        return false;
      }
      return true;
    };

    switch (kind) {
      case 'dash': {
        if (!needAction()) return;
        const spd = effectiveSpeed(unit);
        set({
          units: get().units.map(u => (u.id === unitId
            ? { ...u, actionEconomy: { ...u.actionEconomy, movementUsed: u.actionEconomy.movementUsed - spd } }
            : u)),
        });
        get().logEvent({ type: 'note', actorId: unitId, text: `💨 ${unit.name} 冲刺！本回合移动力翻倍（+${spd} 尺）`, level: 'info' });
        if (isCurrent) consume('action');
        break;
      }
      case 'dodge': {
        if (!needAction()) return;
        addSelfStatus('dodging');
        get().logEvent({ type: 'status-add', actorId: unitId, text: `🌀 ${unit.name} 闪避 —— 本回合对自身的攻击有劣势`, level: 'good' });
        if (isCurrent) consume('action');
        break;
      }
      case 'disengage': {
        if (!needAction()) return;
        addSelfStatus('disengaging');
        get().logEvent({ type: 'status-add', actorId: unitId, text: `🏃 ${unit.name} 脱离 —— 本回合移动不触发借机攻击`, level: 'info' });
        if (isCurrent) consume('action');
        break;
      }
      case 'hide': {
        if (!needAction()) return;
        // 隐匿是敏捷检定（D20 Test）：2024 力竭 -2/级；保留裸骰 20 自动成功、裸骰 1 自动失败
        const exPenalty = exhaustionPenalty(unit.statuses);
        const bonus = (unit.stealthBonus ?? abilityMod(unit.abilities?.dex ?? 10)) - exPenalty;
        const enemies = s.units.filter(u => u.attitude === 2 && u.hp > 0 && !u.deathSaves?.dead);
        const dc = enemies.length > 0
          ? Math.max(...enemies.map(e => 10 + abilityMod(e.abilities?.wis ?? 10)))
          : 10;
        const r = rollFormula('1d20', { bonus });
        const judged = judgeCheck(r, dc);
        const ok = judged.outcome === 'success' || judged.outcome === 'critical-success';
        const exNote = exPenalty ? `（力竭-${exPenalty}）` : '';
        const critNote = judged.outcome === 'critical-success' ? '（裸20自动成功）' : judged.outcome === 'critical-failure' ? '（裸1自动失败）' : '';
        set({ lastRoll: { id: uid(), formula: `1d20${bonus >= 0 ? '+' + bonus : bonus}`, result: r, note: '隐匿检定' } });
        if (ok) {
          addSelfStatus('hiding');
          get().logEvent({ type: 'check', actorId: unitId, text: `🕳️ ${unit.name} 隐匿 [${r.rawD20}]+${bonus}=${r.total}${exNote} ≥ DC${dc}${critNote} —— 成功隐藏！下次攻击有优势`, level: 'good' });
        } else {
          get().logEvent({ type: 'check', actorId: unitId, text: `${unit.name} 隐匿 [${r.rawD20}]+${bonus}=${r.total}${exNote} < DC${dc}${critNote} —— 失败，未能隐藏`, level: 'bad' });
        }
        if (isCurrent) consume('action');
        break;
      }
      case 'help': {
        const ally = targetId ? s.units.find(u => u.id === targetId) : null;
        if (!ally || ally.id === unitId) {
          get().logEvent({ type: 'note', text: '⛔ 协助需要选择一名友方目标', level: 'bad' });
          return;
        }
        if (!needAction()) return;
        set({ units: get().units.map(u => (u.id === ally.id ? { ...u, statuses: [...new Set([...u.statuses, 'helped'])] } : u)) });
        get().logEvent({ type: 'status-add', actorId: ally.id, text: `🤝 ${unit.name} 协助 ${ally.name} —— 其下次攻击有优势`, level: 'good' });
        if (isCurrent) consume('action');
        break;
      }
      case 'ready': {
        if (!needAction()) return;
        get().logEvent({ type: 'note', actorId: unitId, text: `⏳ ${unit.name} 预备动作 —— 已记录（触发条件请手动结算）`, level: 'info' });
        if (isCurrent) consume('action');
        break;
      }
      case 'potion': {
        // 房规 potionBonusAction（设置面板可切）：喝药消耗附赠动作；附赠不可用时回退动作
        const useBonus = get().rules.potionBonusAction;
        const r = rollFormula('2d4+2');
        if (isCurrent) {
          if (useBonus) {
            if (unit.actionEconomy.bonus) {
              get().logEvent({ type: 'note', text: `⛔ ${unit.name} 的附赠动作已用尽——回退为标准动作喝药`, level: 'info' });
              if (unit.actionEconomy.action) {
                get().logEvent({ type: 'note', text: `⛔ ${unit.name} 的动作也已用尽，无法喝药`, level: 'bad' });
                return;
              }
              consume('action');
            } else {
              consume('bonus');
            }
          } else if (unit.actionEconomy.action) {
            get().logEvent({ type: 'note', text: `⛔ ${unit.name} 的动作已用尽`, level: 'bad' });
            return;
          } else {
            consume('action');
          }
        }
        set({ lastRoll: { id: uid(), formula: '2d4+2', result: r, note: '治疗药水' } });
        get().logEvent({ type: 'heal', actorId: unitId, text: `🧪 ${unit.name} 饮用治疗药水${useBonus ? '（房规·附赠动作）' : ''}，回复 ${r.total} 点`, level: 'good' });
        get().healUnit(unitId, r.total);
        break;
      }
    }
    persist(get());
  },

  // ---------------- 其他 ----------------

  logEvent: (e) => {
    const ev: BattleEvent = {
      id: uid(),
      ts: Date.now(),
      round: get().turn.round,
      type: e.type,
      actorId: e.actorId,
      targetId: e.targetId,
      text: e.text,
      data: e.data,
      level: e.level ?? 'info',
    };
    set({ events: [...get().events, ev].slice(-300) });
  },

  setRules: (patch) => {
    const rules = { ...get().rules, ...normalizeRules(patch) };
    set({ rules });
    // 同步引擎结算单例（combat.ts 等纯函数模块读 rules.ts 的 activeRules；
    // 此前缺失这一步，设置面板里的 minDamageOne 等房规从未真正作用于结算）
    engineSetRules(rules);
    persist(get());
  },

  setBattleName: (name) => {
    set({ battleName: name });
    persist(get());
  },

  setEmbedMode: (v) => set({ embedMode: v }),
  clearLastRoll: () => set({ lastRoll: null }),
  clearHistory: () => {
    try { localStorage.removeItem('dnd-battle-history'); } catch { /* noop */ }
    set({ history: [], lastDiff: null });
  },
  computeLastDiff: (ts) => {
    const prev = findPrevSnapshot(ts);
    const history = loadHistory();
    const current = history.find(h => h.ts === ts);
    if (current) {
      set({ lastDiff: diffSnapshots(prev, current) });
    }
  },
}));
