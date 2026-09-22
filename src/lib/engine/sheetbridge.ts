/**
 * 角色数据桥：把酒馆 <UpdateVariable>（MVU JSONPatch）转成可战斗的角色单位
 * 链路：DM 消息 → JSONPatch 流 → 变量树（持久缓存）→ 角色卡 CharSheet → 战斗单位
 * 字段映射基于【D&D 2024版】卡实际变量结构：
 *   /角色列表/{名}/生命值.{当前,最大,临时}、护甲等级.总值、先攻.加值、等级、属性.{力量..魅力}
 *   /施法/法术位.{1环..9环}.{当前,最大}、/施法/法术书.{法术名}
 *   /物品/武器.{武器名}.{伤害公式,伤害类型,映射属性,魔法加值,熟练,已装备,属性特征}
 *   /状态.{名}.{存在}、/熟练配置.技能.隐匿
 */
import type {
  Abilities, AbilityKey, AiAbility, BattleUnit, DamageType, SpellSlots,
} from './types';
import { abilityMod, proficiencyBonus, formatMod } from './rules';
import { DAMAGE_TYPE_CN, DAMAGE_TYPE_TO_CN, stripInstanceSuffix } from './statblocks';

// ============ 变量树 ============

export type VarTree = Record<string, unknown>;

export interface PatchApplyResult {
  applied: number;
  errors: string[];
}

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function parsePath(path: string): string[] {
  const segs = path.split('/').filter(Boolean);
  // 反原型污染：拒绝危险路径段（/a/__proto__/x 会沿原型链走到 Object.prototype）
  for (const s of segs) {
    if (FORBIDDEN_SEGMENTS.has(s)) throw new Error(`非法路径段: ${s}`);
  }
  return segs;
}

/** 路径游走：取/建 seg 对应的子节点；`-` 段 = 数组追加新元素（卡片真实语义：/冒险日志/-/记录） */
function ensureNode(parent: unknown, key: string, nextIsDash: boolean): unknown {
  if (Array.isArray(parent)) {
    if (key === '-') { parent.push({}); return parent[parent.length - 1]; }
    const i = /^\d+$/.test(key) ? parseInt(key, 10) : NaN;
    if (!Number.isNaN(i)) {
      if (!parent[i]) parent[i] = {};
      return parent[i];
    }
    return undefined;
  }
  if (parent && typeof parent === 'object') {
    const o = parent as Record<string, unknown>;
    if (o[key] === undefined || typeof o[key] !== 'object' || o[key] === null) {
      o[key] = nextIsDash ? [] : {};
    }
    return o[key];
  }
  return undefined;
}

/** RFC6902 子集 + MVU delta 扩展；`-` 段表示数组追加；原地修改 tree */
export function applyPatches(tree: VarTree, patches: Array<{ op: string; path: string; value?: unknown }>): PatchApplyResult {
  const errors: string[] = [];
  let applied = 0;
  for (const p of patches) {
    try {
      const segs = parsePath(p.path);
      if (segs.length === 0) { errors.push(`空路径: ${p.path}`); continue; }
      // 游走到倒数第二层
      let node: unknown = tree;
      let ok = true;
      for (let i = 0; i < segs.length - 1; i++) {
        node = ensureNode(node, segs[i], segs[i + 1] === '-');
        if (node === undefined) { ok = false; break; }
      }
      if (!ok || node === null || node === undefined) { errors.push(`路径不可达: ${p.path}`); continue; }
      const last = segs[segs.length - 1];

      switch (p.op) {
        case 'replace':
        case 'insert':
        case 'add': { // RFC6902 标准 add：数组同 insert/追加，对象同 replace
          if (Array.isArray(node)) {
            if (last === '-') { node.push(p.value); applied++; break; }
            const i = /^\d+$/.test(last) ? parseInt(last, 10) : NaN;
            if (Number.isNaN(i)) { errors.push(`数组路径非法: ${p.path}`); break; }
            if (p.op === 'insert') node.splice(i, 0, p.value);
            else node[i] = p.value;
          } else if (typeof node === 'object') {
            (node as Record<string, unknown>)[last] = p.value;
          } else { errors.push(`目标非容器: ${p.path}`); break; }
          applied++;
          break;
        }
        case 'delta': {
          const po = node as Record<string, unknown>;
          const cur = typeof po[last] === 'number' ? (po[last] as number) : 0;
          const d = typeof p.value === 'number' ? p.value : parseFloat(String(p.value));
          if (Number.isNaN(d)) { errors.push(`delta 非数值: ${p.path}`); break; }
          po[last] = cur + d;
          applied++;
          break;
        }
        case 'remove':
        case 'delete': { // delete 非标准但常见变体
          if (Array.isArray(node) && /^\d+$/.test(last)) node.splice(parseInt(last, 10), 1);
          else if (typeof node === 'object') delete (node as Record<string, unknown>)[last];
          else { errors.push(`目标非容器: ${p.path}`); break; }
          applied++;
          break;
        }
        case 'move': {
          if (typeof p.value !== 'string') { errors.push(`move 缺目标: ${p.path}`); break; }
          const srcSegs = parsePath(p.value);
          let srcParent: unknown = tree;
          let sok = true;
          for (let i = 0; i < srcSegs.length - 1; i++) {
            srcParent = ensureNode(srcParent, srcSegs[i], srcSegs[i + 1] === '-');
            if (srcParent === undefined) { sok = false; break; }
          }
          const srcLast = srcSegs[srcSegs.length - 1];
          if (!sok || !srcParent || typeof srcParent !== 'object' || !(srcLast in (srcParent as object))) {
            errors.push(`move 源不存在: ${p.value}`);
            break;
          }
          const sp = srcParent as Record<string, unknown>;
          const val = sp[srcLast];
          delete sp[srcLast];
          (node as Record<string, unknown>)[last] = val;
          applied++;
          break;
        }
        default:
          errors.push(`未知操作: ${p.op}`);
      }
    } catch (e) {
      errors.push(`${p.op} ${p.path}: ${String(e)}`);
    }
  }
  return { applied, errors };
}

function getNum(o: unknown, ...keys: string[]): number | undefined {
  if (!o || typeof o !== 'object') return undefined;
  const rec = o as Record<string, unknown>;
  for (const k of keys) {
    if (typeof rec[k] === 'number') return rec[k] as number;
    if (typeof rec[k] === 'string') {
      const m = (rec[k] as string).match(/-?\d+(?:\.\d+)?/);
      if (m) return parseFloat(m[0]);
    }
  }
  return undefined;
}

function getStr(o: unknown, ...keys: string[]): string | undefined {
  if (!o || typeof o !== 'object') return undefined;
  const rec = o as Record<string, unknown>;
  for (const k of keys) {
    if (typeof rec[k] === 'string' && (rec[k] as string).trim()) return (rec[k] as string).trim();
  }
  return undefined;
}

// ============ 角色卡 ============

export interface WeaponDef {
  name: string;
  formula: string;          // "1d8"
  damageType?: DamageType;
  ability: AbilityKey;      // 映射属性
  magicBonus: number;
  proficient: boolean;
  equipped: boolean;
  versatile?: string;       // "两用(1d10)"
  ranged: boolean;
  range: number;
  /** 2024 武器精通词条（Graze/Topple/Push/Vex/Sap/Slow/Nick/Cleave） */
  mastery?: string;
}

export interface SpellDef {
  name: string;
  level: number;            // 0=戏法
  prepared: boolean;
  matched: boolean;         // 是否匹配到内置法术库（可自动结算）
  ability?: Omit<AiAbility, 'id'>; // 匹配到的机制
}

export interface CharSheet {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  tempHp: number;
  ac: number;
  initMod: number;
  speed: number;
  abilities: Abilities;
  spellSlots?: SpellSlots;
  weapons: WeaponDef[];
  spells: SpellDef[];
  statuses: string[];       // 映射为引擎状态 key
  stealthBonus?: number;
  /** 豁免熟练属性（来自 熟练配置.豁免，装配时折算为 saveBonuses） */
  saveProficiencies?: Set<AbilityKey>;
  /** 伤害抗性/免疫/易伤（来自变量 抗性/免疫/易伤 字段） */
  resistances: DamageType[];
  immunities: DamageType[];
  vulnerabilities: DamageType[];
  notes?: string;
  /** 首次同步时间 / 更新时间 */
  syncedAt: number;
}

/** 武器精通词条归一（中英文 → 标准 key；引擎自动结算 Graze/Topple/Push） */
const MASTERY_CN: Record<string, string> = {
  'graze': 'Graze', '擦掠': 'Graze', '擦伤': 'Graze',
  'cleave': 'Cleave', '横扫': 'Cleave', '顺势斩': 'Cleave',
  'topple': 'Topple', '失衡': 'Topple', '摔绊': 'Topple',
  'vex': 'Vex', '侵扰': 'Vex', '扰乱': 'Vex',
  'nick': 'Nick', '迅击': 'Nick',
  'sap': 'Sap', '削弱': 'Sap',
  'slow': 'Slow', '缓速': 'Slow',
  'push': 'Push', '推离': 'Push',
};

/** 解析抗性/免疫/易伤字段值（数组或顿号/逗号分隔字符串，中英文伤害类型名） */
function parseDamageTypes(raw: unknown): DamageType[] {
  const items: string[] = [];
  if (Array.isArray(raw)) items.push(...raw.map(String));
  else if (typeof raw === 'string') items.push(...raw.split(/[、,，/]/));
  const out: DamageType[] = [];
  for (const item of items) {
    const t = item.trim();
    if (!t) continue;
    const mapped = DAMAGE_TYPE_CN[t]
      ?? DAMAGE_TYPE_CN[t.toLowerCase()]
      ?? DAMAGE_TYPE_CN[t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/** 变量树里的 状态.{名} → 引擎状态 key */
const STATUS_CN: Record<string, string> = {
  '中毒': 'poisoned', '目盲': 'blinded', '失明': 'blinded', '麻痹': 'paralyzed',
  '恐慌': 'frightened', '恐惧': 'frightened', '倒地': 'prone', '昏迷': 'unconscious',
  '隐形': 'invisible', '隐身': 'invisible', '擒抱': 'grappled', '束缚': 'restrained',
  '震慑': 'stunned', '石化': 'petrified', '魅惑': 'charmed', '失聪': 'deafened',
  '失能': 'incapacitated', '力竭': 'exhaustion',
};

const ABILITY_CN_KEY: Record<string, AbilityKey> = {
  '力量': 'str', '敏捷': 'dex', '体质': 'con', '智力': 'int', '感知': 'wis', '魅力': 'cha',
};

// ============ 内置常见法术库（2024 数值，法术书名匹配后自动获得机制） ============

interface SpellTemplate {
  keys: string[];              // 匹配关键词（包含匹配）
  level: number;
  build: (mod: number, dc: number, pb: number) => Omit<AiAbility, 'id'>;
}

const COMMON_SPELLS: SpellTemplate[] = [
  {
    keys: ['火焰箭', 'fire bolt', '火栓'], level: 0,
    build: (mod) => ({ name: '火焰箭', kind: 'ranged', attackBonus: mod, dice: `1d10${formatMod(mod)}`, damageType: 'fire', range: 120, spellLevel: 0 }),
  },
  {
    keys: ['冰冻射线', 'ray of frost'], level: 0,
    build: (mod) => ({ name: '冰冻射线', kind: 'ranged', attackBonus: mod, dice: `1d8${formatMod(mod)}`, damageType: 'cold', range: 120, spellLevel: 0, note: '命中降速10尺' }),
  },
  {
    keys: ['神圣火花', 'sacred flame'], level: 0,
    build: (_mod, dc) => ({ name: '神圣火花', kind: 'save', dice: '1d8', damageType: 'radiant', range: 60, saveAbility: 'dex', saveDc: dc, spellLevel: 0, note: '目标无法借掩护加值' }),
  },
  {
    keys: ['酸液飞溅', 'acid splash'], level: 0,
    build: (_mod, dc) => ({ name: '酸液飞溅', kind: 'save-aoe', dice: '1d6', damageType: 'acid', range: 60, saveAbility: 'dex', saveDc: dc, aoe: { kind: 'sphere', size: 5 }, spellLevel: 0 }),
  },
  {
    keys: ['魔能爆', 'eldritch blast'], level: 0,
    build: (mod) => ({ name: '魔能爆', kind: 'ranged', attackBonus: mod, dice: `1d10${formatMod(mod)}`, damageType: 'force', range: 120, spellLevel: 0 }),
  },
  {
    keys: ['治疗真言', 'healing word'], level: 1,
    build: (mod) => ({ name: '治疗真言', kind: 'heal', dice: `2d4${formatMod(mod)}`, range: 60, spellLevel: 1, bonusAction: true }),
  },
  {
    keys: ['治疗术', 'cure wounds'], level: 1,
    build: (mod) => ({ name: '治疗术', kind: 'heal', dice: `2d8${formatMod(mod)}`, range: 5, spellLevel: 1 }),
  },
  {
    keys: ['魔法飞弹', 'magic missile'], level: 1,
    build: () => ({ name: '魔法飞弹', kind: 'save', dice: '3d4+3', damageType: 'force', range: 120, spellLevel: 1, note: '自动命中，无需攻击检定' }),
  },
  {
    keys: ['雷鸣波', 'thunderwave'], level: 1,
    build: (_mod, dc) => ({ name: '雷鸣波', kind: 'save-aoe', dice: '2d8', damageType: 'thunder', range: 15, saveAbility: 'con', saveDc: dc, halfOnSuccess: true, aoe: { kind: 'cube', size: 15 }, spellLevel: 1, note: '豁免失败被推开10尺' }),
  },
  {
    keys: ['燃烧之手', 'burning hands'], level: 1,
    build: (_mod, dc) => ({ name: '燃烧之手', kind: 'save-aoe', dice: '3d6', damageType: 'fire', range: 15, saveAbility: 'dex', saveDc: dc, halfOnSuccess: true, aoe: { kind: 'cone', size: 15 }, spellLevel: 1 }),
  },
  {
    keys: ['妖火', 'faerie fire'], level: 1,
    build: (_mod, dc) => ({ name: '妖火', kind: 'save', dice: '0', range: 60, saveAbility: 'dex', saveDc: dc, applyStatus: 'lit', spellLevel: 1, concentration: true, note: '范围内豁免失败者发光：对其攻击有优势' }),
  },
  {
    keys: ['护盾术', 'shield'], level: 1,
    build: () => ({ name: '护盾术', kind: 'save', dice: '0', range: 0, spellLevel: 1, bonusAction: true, note: '反应施放：AC+5 直至下回合开始（手动改 AC 或加备注）' }),
  },
  {
    keys: ['人类定身术', 'hold person'], level: 2,
    build: (_mod, dc) => ({ name: '人类定身术', kind: 'save', dice: '0', range: 60, saveAbility: 'wis', saveDc: dc, applyStatus: 'paralyzed', spellLevel: 2, concentration: true, note: '人形生物豁免失败则麻痹（每回合可重掷）' }),
  },
  {
    keys: ['隐形术', 'invisibility'], level: 2,
    build: () => ({ name: '隐形术', kind: 'save', dice: '0', range: 0, spellLevel: 2, concentration: true, applyStatus: 'invisible', note: '目标隐形' }),
  },
  {
    keys: ['蛛网术', 'web'], level: 2,
    build: (_mod, dc) => ({ name: '蛛网术', kind: 'save-aoe', dice: '0', range: 60, saveAbility: 'dex', saveDc: dc, applyStatus: 'restrained', aoe: { kind: 'cube', size: 20 }, spellLevel: 2, concentration: true }),
  },
  {
    keys: ['灼热射线', 'scorching ray'], level: 2,
    build: (mod) => ({ name: '灼热射线', kind: 'ranged', attackBonus: mod, dice: `2d6${formatMod(0)}`, damageType: 'fire', range: 120, multiAttack: 3, spellLevel: 2 }),
  },
  {
    keys: ['马友夫箭', 'melf'], level: 2,
    build: (mod) => ({ name: '马友夫强酸箭', kind: 'ranged', attackBonus: mod, dice: '4d4', damageType: 'acid', range: 90, spellLevel: 2 }),
  },
  {
    keys: ['闪电束', 'lightning bolt'], level: 3,
    build: (_mod, dc) => ({ name: '闪电束', kind: 'save-aoe', dice: '8d6', damageType: 'lightning', range: 100, saveAbility: 'dex', saveDc: dc, halfOnSuccess: true, aoe: { kind: 'line', size: 100 }, spellLevel: 3 }),
  },
  {
    keys: ['火球术', 'fireball'], level: 3,
    build: (_mod, dc) => ({ name: '火球术', kind: 'save-aoe', dice: '8d6', damageType: 'fire', range: 150, saveAbility: 'dex', saveDc: dc, halfOnSuccess: true, aoe: { kind: 'sphere', size: 20 }, spellLevel: 3 }),
  },
  {
    keys: ['飞行术', 'fly'], level: 3,
    build: () => ({ name: '飞行术', kind: 'save', dice: '0', range: 0, applyStatus: 'flying', spellLevel: 3, concentration: true, note: '目标获得 60 尺飞行速度' }),
  },
  {
    keys: ['冰风暴', 'ice storm'], level: 4,
    build: (_mod, dc) => ({ name: '冰风暴', kind: 'save-aoe', dice: '2d8+4d6', damageType: 'bludgeoning', range: 300, saveAbility: 'dex', saveDc: dc, halfOnSuccess: true, aoe: { kind: 'sphere', size: 40 }, spellLevel: 4, note: '含 4d6 冷冻伤害' }),
  },
  {
    keys: ['石肤术', 'stoneskin'], level: 4,
    build: () => ({ name: '石肤术', kind: 'save', dice: '0', range: 0, spellLevel: 4, concentration: true, note: '目标获得非魔法钝击/穿刺/挥砍抗性（手动加抗性）' }),
  },
  {
    keys: ['怪物定身术', 'hold monster'], level: 5,
    build: (_mod, dc) => ({ name: '怪物定身术', kind: 'save', dice: '0', range: 90, saveAbility: 'wis', saveDc: dc, applyStatus: 'paralyzed', spellLevel: 5, concentration: true }),
  },
  {
    keys: ['群体治疗真言', 'mass healing word'], level: 3,
    build: (mod) => ({ name: '群体治疗真言', kind: 'heal', dice: `2d4${formatMod(mod)}`, range: 60, spellLevel: 3, bonusAction: true }),
  },
];

function matchSpell(name: string): SpellTemplate | undefined {
  const lower = name.toLowerCase();
  // 最长关键词优先：避免「治疗真言」劫持「群体治疗真言」这类子串匹配
  let best: { tpl: SpellTemplate; keyLen: number } | null = null;
  for (const tpl of COMMON_SPELLS) {
    for (const k of tpl.keys) {
      if (lower.includes(k) && (!best || k.length > best.keyLen)) {
        best = { tpl, keyLen: k.length };
      }
    }
  }
  return best?.tpl;
}

// ============ 变量树 → 角色卡 ============

/** 施法属性推导：显式字段 > 智/感/魅最高者 */
function castingAbility(sheetAbilities: Abilities, casting: unknown): AbilityKey {
  const explicit = getStr(casting, '施法属性', '属性');
  if (explicit && ABILITY_CN_KEY[explicit]) return ABILITY_CN_KEY[explicit];
  const cands: Array<[AbilityKey, number]> = [
    ['int', sheetAbilities.int], ['wis', sheetAbilities.wis], ['cha', sheetAbilities.cha],
  ];
  cands.sort((a, b) => b[1] - a[1]);
  return cands[0][0];
}

/** 从变量树提取全部角色卡 */
export function charSheetsFromTree(tree: VarTree): CharSheet[] {
  // 反例防御：持久化恢复出 null/非对象时直接空名单，不抛异常
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return [];
  const list = (tree as Record<string, unknown>)['角色列表'];
  if (!list || typeof list !== 'object' || Array.isArray(list)) return [];
  const out: CharSheet[] = [];
  for (const [name, raw] of Object.entries(list as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const abilities: Abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    const abRaw = c['属性'];
    if (abRaw && typeof abRaw === 'object') {
      for (const [k, v] of Object.entries(abRaw as Record<string, unknown>)) {
        const key = ABILITY_CN_KEY[k];
        if (key && typeof v === 'number') abilities[key] = v;
      }
    }
    const level = getNum(c, '等级') ?? 1;
    const pb = proficiencyBonus(level);

    // 生命值
    const hpRaw = c['生命值'];
    const maxHp = getNum(hpRaw, '最大', '最大值') ?? getNum(c, '生命值') ?? 10;
    const hp = Math.min(maxHp, getNum(hpRaw, '当前', '当前值') ?? maxHp);
    const tempHp = getNum(hpRaw, '临时') ?? 0;

    // 护甲 / 先攻 / 速度
    const acRaw = c['护甲等级'];
    const ac = getNum(acRaw, '总值', '值') ?? (typeof acRaw === 'number' ? acRaw : 13);
    const initMod = getNum(c['先攻'], '加值', '总值') ?? abilityMod(abilities.dex);
    const speed = getNum(c, '速度') ?? 30;

    // 法术位
    const casting = c['施法'];
    let spellSlots: SpellSlots | undefined;
    if (casting && typeof casting === 'object') {
      const slotRaw = (casting as Record<string, unknown>)['法术位'];
      if (slotRaw && typeof slotRaw === 'object') {
        spellSlots = {};
        for (const [k, v] of Object.entries(slotRaw as Record<string, unknown>)) {
          const lv = parseInt(k.replace(/[^\d]/g, ''), 10);
          if (!Number.isNaN(lv) && v && typeof v === 'object') {
            const cur = getNum(v, '当前') ?? 0;
            const max = getNum(v, '最大') ?? 0;
            if (max > 0) spellSlots[lv] = { current: Math.min(cur, max), max };
          }
        }
        if (Object.keys(spellSlots).length === 0) spellSlots = undefined;
      }
    }

    // 武器 → WeaponDef
    const weapons: WeaponDef[] = [];
    const invRaw = c['物品'];
    if (invRaw && typeof invRaw === 'object') {
      const wRaw = (invRaw as Record<string, unknown>)['武器'];
      if (wRaw && typeof wRaw === 'object') {
        for (const [wName, wv] of Object.entries(wRaw as Record<string, unknown>)) {
          if (!wv || typeof wv !== 'object') continue;
          const w = wv as Record<string, unknown>;
          const formula = getStr(w, '伤害公式', '伤害') ?? '1d4';
          const dtRaw = getStr(w, '伤害类型') ?? '挥砍';
          const abRaw2 = getStr(w, '映射属性') ?? '力量';
          const wNameLower = wName.toLowerCase();
          const isRangedW = /弓|弩|镖|投石索|手雷|弓箭/.test(wName);
          const isThrown = /投掷|标枪|匕首|手斧/.test(getStr(w, '属性特征') ?? '') || /标枪/.test(wName);
          // 射程：显式 射程 字段优先（尺），否则按名称推断（接近规则值：长弓150/重弩100/其他弓弩80/投掷30）
          const rangeField = getNum(w, '射程', '射程(尺)', '射程（尺）');
          const rangeFallback = isRangedW
            ? (/长弓/.test(wName) ? 150 : /重弩/.test(wName) ? 100 : 80)
            : (isThrown ? 30 : 5);
          const masteryRaw = getStr(w, '精通', '精通词条', '专精特质')?.toLowerCase() ?? '';
          weapons.push({
            name: wName,
            formula: formula.replace(/\s/g, ''),
            damageType: DAMAGE_TYPE_CN[dtRaw] ?? DAMAGE_TYPE_CN[dtRaw.toLowerCase()] ?? 'slashing',
            ability: ABILITY_CN_KEY[abRaw2] ?? ABILITY_CN_KEY[abRaw2.toLowerCase()] ?? 'str',
            magicBonus: getNum(w, '魔法加值', '加值') ?? 0,
            proficient: w['熟练'] === true || w['熟练'] === 'true',
            equipped: w['已装备'] === true,
            versatile: getStr(w, '属性特征'),
            ranged: isRangedW,
            range: rangeField !== undefined && rangeField > 0 ? rangeField : rangeFallback,
            mastery: MASTERY_CN[masteryRaw],
          });
        }
      }
    }

    // 法术书 → SpellDef
    const spells: SpellDef[] = [];
    if (casting && typeof casting === 'object') {
      const sbRaw = (casting as Record<string, unknown>)['法术书'];
      if (sbRaw && typeof sbRaw === 'object') {
        const castKey = castingAbility(abilities, casting);
        const castMod = abilityMod(abilities[castKey]);
        const dc = 8 + pb + castMod;
        for (const [sName, sv] of Object.entries(sbRaw as Record<string, unknown>)) {
          const prepared = !!sv && typeof sv === 'object' && (sv as Record<string, unknown>)['准备中'] === true;
          const tpl = matchSpell(sName);
          spells.push({
            name: sName,
            level: tpl?.level ?? getNum(sv, '环阶', '等级') ?? 1,
            prepared,
            matched: !!tpl,
            ability: tpl ? tpl.build(castMod, dc, pb) : undefined,
          });
        }
        spells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
      }
    }

    // 状态
    const statuses: string[] = [];
    const stRaw = c['状态'];
    if (stRaw && typeof stRaw === 'object') {
      for (const [sName, sv] of Object.entries(stRaw as Record<string, unknown>)) {
        const exists = sv && typeof sv === 'object' ? (sv as Record<string, unknown>)['存在'] === true : sv === true;
        if (!exists) continue;
        const key = STATUS_CN[sName];
        if (key) statuses.push(key);
        else if (sName === '力竭') {
          const lv = getNum(sv, '等级') ?? 1;
          statuses.push(`exhaustion:${lv}`);
        }
      }
    }

    // 隐匿加值 / 豁免熟练（熟练配置.豁免.属性 = "p"/true；与 技能 同风格）
    let stealthBonus: number | undefined;
    const saveProficiencies = new Set<AbilityKey>();
    const profRaw = c['熟练配置'];
    if (profRaw && typeof profRaw === 'object') {
      const skillRaw = (profRaw as Record<string, unknown>)['技能'];
      if (skillRaw && typeof skillRaw === 'object') {
        const hide = (skillRaw as Record<string, unknown>)['隐匿'];
        if (hide !== undefined) {
          const base = abilityMod(abilities.dex);
          const s = String(hide);
          const explicit = s.match(/^([+-]?\d+)/);
          if (explicit) stealthBonus = parseInt(explicit[1], 10);
          else if (s.includes('e')) stealthBonus = base + pb * 2;
          else if (s.includes('p')) stealthBonus = base + pb;
          else if (s.includes('j')) stealthBonus = base + Math.floor(pb / 2);
          else stealthBonus = base;
        }
      }
      const saveRaw = (profRaw as Record<string, unknown>)['豁免'] ?? (profRaw as Record<string, unknown>)['豁免熟练'];
      if (saveRaw && typeof saveRaw === 'object') {
        for (const [k, v] of Object.entries(saveRaw as Record<string, unknown>)) {
          const key = ABILITY_CN_KEY[k] ?? ABILITY_CN_KEY[k.toLowerCase()] ?? (['str', 'dex', 'con', 'int', 'wis', 'cha'] as AbilityKey[]).find(a => a === k.toLowerCase());
          if (!key) continue;
          const s = String(v).toLowerCase();
          if (v === true || s === 'true' || s.includes('p') || s.includes('e')) saveProficiencies.add(key);
        }
      }
    }

    // 抗性/免疫/易伤（角色级字段，数组或顿号分隔字符串；野蛮人狂暴/种族抗性等）
    const resistances = parseDamageTypes(c['抗性']);
    const immunities = parseDamageTypes(c['免疫']);
    const vulnerabilities = parseDamageTypes(c['易伤']);

    out.push({
      name,
      level,
      hp, maxHp, tempHp,
      ac, initMod, speed,
      abilities,
      spellSlots,
      weapons,
      spells,
      statuses,
      stealthBonus,
      saveProficiencies: saveProficiencies.size > 0 ? saveProficiencies : undefined,
      resistances,
      immunities,
      vulnerabilities,
      syncedAt: Date.now(),
    });
  }
  return out;
}

// ============ 角色卡 → 战斗单位 ============

export interface SheetToUnitOptions {
  isPlayer?: boolean;
  pos?: { x: number; y: number };
  init?: number;
}

/** 角色卡 → 战斗单位（含武器与法术动作表） */
export function unitFromCharSheet(sheet: CharSheet, opts: SheetToUnitOptions = {}): BattleUnit {
  const pb = proficiencyBonus(sheet.level);
  const abilities: Abilities = { ...sheet.abilities };

  // 豁免加值：熟练属性 = 属性调整值 + 熟练加值（2024：豁免检定计入熟练）
  const saveBonuses: Partial<Record<AbilityKey, number>> = {};
  for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as AbilityKey[]) {
    saveBonuses[key] = abilityMod(abilities[key]) + (sheet.saveProficiencies?.has(key) ? pb : 0);
  }

  // 武器动作（已装备优先）
  const sorted = [...sheet.weapons].sort((a, b) => Number(b.equipped) - Number(a.equipped));
  const weaponAbilities: AiAbility[] = sorted.map((w, i) => {
    const abMod = abilityMod(abilities[w.ability] ?? 10);
    return {
      id: `w${i}-${w.name}`,
      name: w.name,
      kind: w.ranged ? 'ranged' : 'melee',
      attackBonus: abMod + (w.proficient ? pb : 0) + w.magicBonus,
      dice: `${w.formula}${formatMod(abMod + w.magicBonus)}`,
      damageType: w.damageType,
      range: w.range,
      multiAttack: 1,
      mastery: w.mastery,
      masteryMod: abMod + w.magicBonus,
      note: [
        w.versatile ? `两用：${w.versatile}` : '',
        w.equipped ? '已装备' : '',
        w.mastery ? `精通：${w.mastery}${['Graze', 'Topple', 'Push'].includes(w.mastery) ? '（命中/失手自动结算）' : '（按词条手动/叙事结算）'}` : '',
      ].filter(Boolean).join(' · ') || undefined,
    };
  });

  // 法术动作（仅匹配到机制的）
  const spellAbilities: AiAbility[] = sheet.spells
    .filter(s => s.matched && s.ability)
    .map((s, i) => ({ ...s.ability!, id: `s${i}-${s.name}` }));

  const unit: BattleUnit = {
    id: sheet.name,
    name: sheet.name,
    dataSource: 'roster',
    size: 'medium',
    init: opts.init ?? 10 + sheet.initMod,
    initMod: sheet.initMod,
    hp: sheet.hp,
    maxHp: sheet.maxHp,
    tempHp: sheet.tempHp,
    ac: sheet.ac,
    speed: sheet.speed,
    pos: opts.pos ?? { x: 0, y: 0 },
    attitude: 0,
    statuses: [...sheet.statuses],
    isPlayer: opts.isPlayer ?? false,
    playerControlled: true,
    level: sheet.level,
    abilities,
    saveBonuses,
    // 抗性/免疫/易伤：从角色变量透传（野蛮人狂暴、种族抗性、石肤术等）
    resistances: [...sheet.resistances],
    immunities: [...sheet.immunities],
    vulnerabilities: [...sheet.vulnerabilities],
    spellSlots: sheet.spellSlots ? JSON.parse(JSON.stringify(sheet.spellSlots)) : undefined,
    concentration: undefined,
    actionEconomy: { action: false, bonus: false, reaction: false, movementUsed: 0 },
    hasActed: false,
    aiProfile: 'tactical',
    aiAbilities: [...weaponAbilities, ...spellAbilities],
    stealthBonus: sheet.stealthBonus,
    notes: `Lv.${sheet.level} 角色（名单同步）${sheet.spells.length > 0 ? ` · 法术书 ${sheet.spells.length} 条（${sheet.spells.filter(s => s.matched).length} 条可自动结算）` : ''}`,
  };
  return unit;
}

/** 已有战斗单位 ← 角色卡补全（保留战场状态：HP 若差太多以卡为准） */
export function applySheetToUnit(unit: BattleUnit, sheet: CharSheet): BattleUnit {
  const fresh = unitFromCharSheet(sheet, { isPlayer: unit.isPlayer, pos: unit.pos, init: unit.init });
  const hpDrift = Math.abs(fresh.hp - unit.hp);
  return {
    ...fresh,
    // id 与战场位置/先攻保持
    id: unit.id,
    pos: unit.pos,
    init: unit.init,
    hasActed: unit.hasActed,
    actionEconomy: unit.actionEconomy,
    // 生命值：战斗中大幅偏移时以卡为准（刚同步过），小偏移保留战场值
    hp: hpDrift > 2 ? fresh.hp : unit.hp,
    maxHp: fresh.maxHp,
    statuses: unit.statuses.length > 0 ? unit.statuses : fresh.statuses,
    concentration: unit.concentration,
    deathSaves: unit.deathSaves,
    // 操控权尊重当前选择
    playerControlled: unit.playerControlled,
  };
}

/** 名字匹配角色卡（去实例后缀，与敌卡匹配同策略） */
export function matchSheetForName(name: string, sheets: CharSheet[]): CharSheet | null {
  if (sheets.length === 0) return null;
  const n = name.trim();
  let exact = sheets.find(s => s.name === n);
  if (exact) return exact;
  const stripped = stripInstanceSuffix(n);
  if (stripped !== n) exact = sheets.find(s => s.name === stripped);
  if (exact) return exact;
  // 前缀匹配（最长角色名优先）
  let best: CharSheet | null = null;
  let bestLen = 0;
  for (const s of sheets) {
    if (n.startsWith(s.name) && s.name.length > bestLen) { best = s; bestLen = s.name.length; }
  }
  return best;
}

// ============ 名单持久化 ============

const ROSTER_KEY = 'dnd-roster-v1';

export interface RosterState {
  tree: VarTree;
  sheets: CharSheet[];
}

export function loadRoster(): RosterState {
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
    if (!raw) return { tree: {}, sheets: [] };
    const data = JSON.parse(raw);
    return {
      tree: data.tree && typeof data.tree === 'object' ? data.tree : {},
      sheets: Array.isArray(data.sheets) ? data.sheets : [],
    };
  } catch {
    return { tree: {}, sheets: [] };
  }
}

export function saveRoster(state: RosterState): void {
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify({ tree: state.tree, sheets: state.sheets }));
  } catch { /* 静默 */ }
}
