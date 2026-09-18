/**
 * 战报生成器（结算权威 = 前端）
 *
 * 战斗结束后（或进行中），把前端结算结果导出为 <battleresult> 文本块，
 * 用户将其粘贴回酒馆，AI DM 据此叙述战后剧情并应用变量更新——
 * AI 不再自行结算战斗，数值一律以本战报为准。
 */
import type { BattleUnit, TurnState } from './types';
import type { CharSheet } from './sheetbridge';
import { matchSheetForName } from './sheetbridge';
import { conditionName } from './conditions';

export interface ReportInput {
  battleName: string;
  turn: TurnState;
  battleActive: boolean;
  units: BattleUnit[];
  rosterSheets: CharSheet[];
}

export interface SuggestedPatch {
  op: 'replace';
  path: string;
  value: string | number | boolean;
  note: string;
}

/** 单位存活状态描述 */
function unitState(u: BattleUnit): string {
  if (u.deathSaves?.dead) return '阵亡';
  if (u.hp <= 0) return u.deathSaves?.stable ? '伤势稳定（昏迷）' : '倒地（死亡豁免中）';
  return '存活';
}

/** 判定胜负：以在场存活单位的态度分布为准 */
export function judgeOutcome(units: BattleUnit[]): { text: string; winner: 0 | 1 | 2 | null } {
  const alive = units.filter(u => u.hp > 0 && !u.deathSaves?.dead);
  const friendly = alive.filter(u => u.attitude !== 2);
  const hostile = alive.filter(u => u.attitude === 2);
  if (hostile.length === 0 && friendly.length > 0) return { text: '玩家方胜利（敌人已全部倒下/溃逃）', winner: 0 };
  if (friendly.length === 0 && hostile.length > 0) return { text: '敌方获胜（玩家方全员倒下）', winner: 2 };
  if (alive.length === 0) return { text: '同归于尽（双方全灭）', winner: null };
  return { text: '尚未分出胜负', winner: null };
}

/** 为匹配角色名单的友方单位生成建议变量补丁（只写确定存在的路径） */
export function suggestPatches(units: BattleUnit[], sheets: CharSheet[]): SuggestedPatch[] {
  const patches: SuggestedPatch[] = [];
  for (const u of units) {
    if (u.attitude === 2) continue; // 只回写我方
    const sheet = matchSheetForName(u.name, sheets);
    if (!sheet) continue;
    const hp = Math.max(0, u.hp);
    if (hp !== sheet.hp) {
      patches.push({
        op: 'replace',
        path: `/角色列表/${sheet.name}/生命值/当前`,
        value: hp,
        note: `${sheet.name} HP ${sheet.hp} → ${hp}`,
      });
    }
  }
  return patches;
}

/** 我方资源消耗摘要（名单角色附带法术位对比；非名单友方的倒地/阵亡/状态也一并列出） */
export function resourceSummary(units: BattleUnit[], sheets: CharSheet[]): string[] {
  const lines: string[] = [];
  for (const u of units) {
    if (u.attitude === 2) continue;
    const sheet = matchSheetForName(u.name, sheets);
    const parts: string[] = [];
    if (sheet?.spellSlots && u.spellSlots) {
      const spent: string[] = [];
      for (const [lv, s] of Object.entries(u.spellSlots)) {
        const origin = sheet.spellSlots[Number(lv)];
        if (origin && s.current !== origin.current) {
          spent.push(`${lv}环 ${s.current}/${s.max}（战前 ${origin.current}）`);
        }
      }
      if (spent.length > 0) parts.push(`法术位：${spent.join('、')}`);
    }
    if (u.hp <= 0 && !u.deathSaves?.dead) parts.push('倒地昏迷，需救助');
    if (u.deathSaves?.dead) parts.push('阵亡');
    if (u.statuses.length > 0) {
      parts.push(`残留状态：${u.statuses.map(s => conditionName(s)).join('、')}`);
    }
    if (parts.length > 0) lines.push(`- ${u.name}：${parts.join('；')}`);
  }
  return lines;
}

/** 敌方摘要：按敌卡名聚合（哥布林1/哥布林2 → 哥布林×2） */
export function enemySummary(units: BattleUnit[]): string[] {
  const enemies = units.filter(u => u.attitude === 2);
  const groups = new Map<string, { total: number; dead: number; aliveHp: string[] }>();
  for (const e of enemies) {
    const base = e.name.replace(/\d+$/, '') || e.name;
    const g = groups.get(base) ?? { total: 0, dead: 0, aliveHp: [] };
    g.total++;
    if (e.deathSaves?.dead || e.hp <= 0) g.dead++;
    else {
      g.aliveHp.push(`${e.name} HP ${Math.max(0, e.hp)}/${e.maxHp}${e.statuses.length > 0 ? ` [${e.statuses.map(s => conditionName(s)).join(',')}]` : ''}`);
    }
    groups.set(base, g);
  }
  const lines: string[] = [];
  for (const [name, g] of groups) {
    if (g.dead === g.total) lines.push(`- ${name}×${g.total}：全灭`);
    else {
      const rest = g.total - g.dead;
      lines.push(`- ${name}：${g.dead}/${g.total} 阵亡；存活 ${rest}（${g.aliveHp.join('、')}）`);
    }
  }
  return lines;
}

/** 生成 <battleresult> 战报块（粘贴回酒馆） */
export function generateBattleResultBlock(input: ReportInput): string {
  const { battleName, turn, battleActive, units, rosterSheets } = input;
  const outcome = judgeOutcome(units);
  const friendly = units.filter(u => u.attitude !== 2);
  const enemies = units.filter(u => u.attitude === 2);
  const patches = suggestPatches(units, rosterSheets);
  const resources = resourceSummary(units, rosterSheets);
  const enemyLines = enemySummary(units);

  const L: string[] = [];
  L.push('<battleresult>');
  L.push(`战斗名称: ${battleName}`);
  L.push(`战斗状态: ${battleActive ? `进行中（第 ${turn.round} 轮，当前行动：${units.find(u => u.id === turn.currentUnitId)?.name ?? '—'}）` : '已结束'}`);
  L.push(`战斗结果: ${outcome.text}`);
  L.push(`我方参战: ${friendly.length} 人；敌方参战: ${enemies.length} 单位`);

  L.push('');
  L.push('【我方状态】');
  if (friendly.length === 0) L.push('- （无我方单位记录）');
  for (const u of friendly) {
    const hp = Math.max(0, u.hp);
    L.push(`- ${u.name}：HP ${hp}/${u.maxHp}［${unitState(u)}］${u.statuses.length > 0 ? ` 状态：${u.statuses.map(s => conditionName(s)).join('、')}` : ''}`);
  }

  L.push('');
  L.push('【敌方状态】');
  if (enemyLines.length === 0) L.push('- （无敌方单位记录）');
  else L.push(...enemyLines);

  if (resources.length > 0) {
    L.push('');
    L.push('【我方资源消耗与残留】');
    L.push(...resources);
  }

  L.push('');
  L.push('【建议变量更新】（数值以前端结算为准，请据此输出你的 <UpdateVariable> 补丁，法术位与状态请按你的变量协议同步）');
  if (patches.length > 0) {
    L.push('<JSONPatch>');
    L.push(JSON.stringify(patches.map(p => ({ op: p.op, path: p.path, value: p.value })), null, 2));
    L.push('</JSONPatch>');
  } else {
    L.push('（我方生命值无变化，无需补丁）');
  }

  if (battleActive) {
    L.push('');
    L.push('【注意】战斗仍在进行——请勿替任何单位行动或结算，仅简短渲染当前战况氛围，等待玩家在前端面板继续操作。');
  } else {
    L.push('');
    L.push('【注意】战斗已在前端面板结算完毕——请以上述数值为唯一事实，叙述战后剧情（伤亡、搜刮战利品、经验值奖励、后续走向），并应用建议的变量更新。不得更改或重算任何数值。');
  }
  L.push('</battleresult>');
  return L.join('\n');
}
