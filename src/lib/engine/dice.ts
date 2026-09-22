/**
 * 骰子引擎：公式解析 + 掷骰
 * 支持: d20 / 2d6+3 / 1d8+2d4+1 / 2d20kh1(优势) / 2d20kl1(劣势) / 4d6dl1
 */
import type { DieRoll, DiceResult, RollMode } from './types';

// ---------- 随机数源（加密安全，可注入便于测试） ----------
let rngSource: () => number = () => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 0x100000000;
  }
  return Math.random();
};

export function setRng(fn: () => number) {
  rngSource = fn;
}

export function rollDie(sides: number): number {
  if (sides <= 1) return 1;
  return Math.floor(rngSource() * sides) + 1;
}

// ---------- 公式解析 ----------

interface DiceTerm {
  count: number;
  sides: number;
  /** kh{n}=保留高n个 kl{n}=保留低n个 dl{n}=弃低n个 dh{n}=弃高n个 */
  keep?: { mode: 'kh' | 'kl' | 'dl' | 'dh'; n: number };
  tag?: string;
}

interface ParsedFormula {
  terms: DiceTerm[];
  modifier: number;
}

/** 解析骰子公式，非法输入抛错（全角容错 + 前缀提取） */
export function parseFormula(formula: string): ParsedFormula {
  // 全角归一：１ｄ８＋３ → 1d8+3（ｄ U+FF44 在全角区段内一并转换）
  const normalized = formula.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ');
  let cleaned = normalized.replace(/\s+/g, '').toLowerCase() || '1d20';
  // 允许 kh/kl/dl/dh 保留语法字母；不匹配时尝试提取前缀公式（"1d8+3 挥砍" → "1d8+3"）
  if (!/^[0-9dklh+-]*$/.test(cleaned) || cleaned.length === 0) {
    const lead = cleaned.match(/^[0-9dklh+-]+/);
    if (lead && /[d]/.test(lead[0]) || lead && /^\d+$/.test(lead[0])) {
      cleaned = lead[0];
    } else {
      throw new Error(`无法解析的骰子公式: ${formula}`);
    }
  }
  const terms: DiceTerm[] = [];
  let modifier = 0;

  // 拆分符号: +d20+3-2d4
  const tokens = cleaned.match(/[+-]?[^+-]+/g) ?? [];
  for (const token of tokens) {
    const sign = token.startsWith('-') ? -1 : 1;
    const body = token.replace(/^[+-]/, '');
    if (!body) continue;
    if (body.includes('d')) {
      const m = body.match(/^(\d*)d(\d+)(?:(kh|kl|dl|dh)(\d+))?$/);
      if (!m) throw new Error(`非法骰子项: ${token}（应为 NdM 或 NdMkh1 格式）`);
      const count = Math.min(Math.max(parseInt(m[1] || '1', 10), 1), 100);
      const sides = Math.min(Math.max(parseInt(m[2], 10), 1), 1000);
      const keep = m[3]
        ? { mode: m[3] as 'kh' | 'kl' | 'dl' | 'dh', n: Math.min(Math.max(parseInt(m[4], 10), 1), count) }
        : undefined;
      terms.push({ count, sides, keep, tag: sign < 0 ? 'penalty' : undefined });
      if (sign < 0) {
        // 负骰子：掷出后按负数计入（罕见，如 -1d4 减速效果）
        terms[terms.length - 1].count = count;
        // 用 marker 处理
        (terms[terms.length - 1] as DiceTerm & { negative?: boolean }).negative = true;
      }
    } else {
      const num = parseInt(body, 10);
      if (Number.isNaN(num)) throw new Error(`非法数值: ${token}`);
      modifier += sign * num;
    }
  }
  return { terms, modifier };
}

// ---------- 掷骰 ----------

export interface RollOptions {
  mode?: RollMode;
  /** 附加到总和的额外加值（技能熟练等），会并入 modifier */
  bonus?: number;
  /** 标记（weapon/rider），用于 2024 重击只翻倍武器骰 */
  tags?: Record<number, string>;
  label?: string;
  /** 外部注入的裸骰值（对接酒馆 <dices> 协议时使用），按消耗顺序 */
  forcedRolls?: number[];
}

/** 掷一个完整公式 */
export function rollFormula(formula: string, opts: RollOptions = {}): DiceResult {
  const mode = opts.mode ?? 'normal';
  let parsed: ParsedFormula;
  try {
    parsed = parseFormula(formula);
  } catch (e) {
    throw e;
  }

  const rolls: DieRoll[] = [];
  let forcedIndex = 0;
  let sum = 0;
  let rawD20: number | undefined;

  for (const term of parsed.terms) {
    const negative = (term as DiceTerm & { negative?: boolean }).negative === true;
    // d20 优势/劣势自动变成 2d20kh1/kl1
    const isD20 = term.sides === 20;
    let count = term.count;
    let keep = term.keep;
    if (isD20 && mode !== 'normal' && !keep && count === 1) {
      count = 2;
      keep = { mode: mode === 'advantage' ? 'kh' : 'kl', n: 1 };
    }

    const termRolls: DieRoll[] = [];
    for (let i = 0; i < count; i++) {
      const value = opts.forcedRolls && forcedIndex < opts.forcedRolls.length
        ? opts.forcedRolls[forcedIndex++]
        : rollDie(term.sides);
      termRolls.push({ sides: term.sides, value, kept: true, tag: term.tag });
    }

    // keep/drop 标记
    if (keep) {
      const sorted = [...termRolls].sort((a, b) => a.value - b.value);
      let dropped: DieRoll[];
      if (keep.mode === 'kh') dropped = sorted.slice(0, Math.max(0, count - keep.n));
      else if (keep.mode === 'kl') dropped = sorted.slice(keep.n);
      else if (keep.mode === 'dl') dropped = sorted.slice(0, keep.n);
      else dropped = sorted.slice(Math.max(0, count - keep.n));
      for (const d of dropped) d.kept = false;
    }

    for (const r of termRolls) {
      if (r.kept) {
        sum += negative ? -r.value : r.value;
        if (isD20 && rawD20 === undefined) rawD20 = r.value;
      }
      rolls.push(r);
    }
  }

  const modifier = parsed.modifier + (opts.bonus ?? 0);
  const total = sum + modifier;
  return {
    formula,
    rolls,
    modifier,
    total,
    rawD20,
    mode,
  };
}

/** 快捷：单次 d20 检定 */
export function rollD20(mode: RollMode = 'normal', bonus = 0, forced?: number[]): DiceResult {
  return rollFormula('1d20', { mode, bonus, forcedRolls: forced });
}

/** 格式化骰子结果为可读文本：2d20kh1 [17, ~4~] +5 = 22 */
export function formatDice(d: DiceResult): string {
  const parts = d.rolls.map(r => (r.kept ? r.value : `弃${r.value}`));
  const keptTotal = d.rolls.filter(r => r.kept).reduce((s, r) => s + r.value, 0);
  let s = `${d.formula}`;
  if (d.mode !== 'normal' && d.rolls.length > 1) s += `(${d.mode === 'advantage' ? '优势' : '劣势'})`;
  s += ` [${parts.join(', ')}]`;
  if (d.modifier !== 0) s += d.modifier > 0 ? ` +${d.modifier}` : ` ${d.modifier}`;
  s += ` = ${d.total}`;
  if (d.rolls.some(r => !r.kept) && keptTotal !== d.total - d.modifier) s += '';
  return s;
}

// ---------- 结果判定 ----------

export function judgeCheck(d20: DiceResult, target: number | null): {
  outcome: 'critical-success' | 'success' | 'failure' | 'critical-failure';
} {
  const raw = d20.rawD20 ?? d20.rolls.find(r => r.sides === 20 && r.kept)?.value;
  // 2024 规则：优劣势取保留骰判定——优势 [20,15] 保留 20 即裸20（自动成功/重击），劣势 [20,1] 保留 1 即裸1
  const critSuccess = raw === 20;
  const critFailure = raw === 1;
  if (critSuccess) return { outcome: 'critical-success' };
  if (critFailure) return { outcome: 'critical-failure' };
  if (target === null) return { outcome: 'success' };
  return { outcome: d20.total >= target ? 'success' : 'failure' };
}

export const OUTCOME_META = {
  'critical-success': { label: '大成功', color: '#f5c542', cls: 'text-amber-300' },
  'success': { label: '成功', color: '#7dc95e', cls: 'text-green-400' },
  'failure': { label: '失败', color: '#c95e5e', cls: 'text-red-400' },
  'critical-failure': { label: '大失败', color: '#e64545', cls: 'text-red-500 font-bold' },
} as const;
