/**
 * 敌卡（Statblock）系统：敌人数据的设计、解析、暂存与配装
 * - StatblockDef：完整敌人数据卡（AC/六维/动作表/抗性/AI 档案）
 * - parseEncounterDefs：解析 <encounter>/<statblock> 块（AI 输出，中英字段容错）
 * - matchStatblockForName：按名字模糊匹配（"哥布林弓手2" → "哥布林弓手"）
 * - unitFromStatblock / applyStatblockToUnit：卡 → 战斗单位（新登场 / 补全已有单位）
 * - 图鉴持久化：localStorage 'dnd-bestiary-v1'
 */
import type {
  Abilities, AbilityKey, AIProfile, AiAbility, AiAbilityKind, AoeShapeKind,
  BattleUnit, DamageType, Size,
} from './types';
import { AI_PROFILE_META, SIZE_META } from './types';
import { resolveStatus, normalizeWidth } from './protocol';
import type { MonsterPreset } from './presets';

// ============ 中文映射表 ============

export const DAMAGE_TYPE_CN: Record<string, DamageType> = {
  '挥砍': 'slashing', ' slashing': 'slashing', '斩': 'slashing',
  '穿刺': 'piercing', 'piercing': 'piercing',
  '钝击': 'bludgeoning', 'bludgeoning': 'bludgeoning', '敲击': 'bludgeoning',
  '火焰': 'fire', '火': 'fire', 'fire': 'fire',
  '冷冻': 'cold', '寒冷': 'cold', '冰': 'cold', 'cold': 'cold',
  '强酸': 'acid', '酸': 'acid', 'acid': 'acid',
  '闪电': 'lightning', '电': 'lightning', 'lightning': 'lightning',
  '雷鸣': 'thunder', '雷': 'thunder', 'thunder': 'thunder',
  '毒素': 'poison', '毒': 'poison', 'poison': 'poison',
  '光耀': 'radiant', '光辉': 'radiant', 'radiant': 'radiant',
  '黯蚀': 'necrotic', '死灵': 'necrotic', 'necrotic': 'necrotic',
  '心灵': 'psychic', '精神': 'psychic', 'psychic': 'psychic',
  '力场': 'force', 'force': 'force',
};

export const DAMAGE_TYPE_TO_CN: Record<DamageType, string> = {
  slashing: '挥砍', piercing: '穿刺', bludgeoning: '钝击',
  fire: '火焰', cold: '冷冻', acid: '强酸', lightning: '闪电', thunder: '雷鸣',
  poison: '毒素', radiant: '光耀', necrotic: '黯蚀', psychic: '心灵', force: '力场',
};

const ABILITY_CN: Record<string, AbilityKey> = {
  '力量': 'str', 'str': 'str', 'strength': 'str',
  '敏捷': 'dex', 'dex': 'dex', 'dexterity': 'dex',
  '体质': 'con', 'con': 'con', 'constitution': 'con',
  '智力': 'int', 'int': 'int', 'intelligence': 'int',
  '感知': 'wis', 'wis': 'wis', 'wisdom': 'wis',
  '魅力': 'cha', 'cha': 'cha', 'charisma': 'cha',
};

const SIZE_CN: Record<string, Size> = {
  '微型': 'tiny', 'tiny': 'tiny',
  '小型': 'small', 'small': 'small',
  '中型': 'medium', 'medium': 'medium',
  '大型': 'large', 'large': 'large',
  '巨型': 'huge', 'huge': 'huge',
  '超巨型': 'gargantuan', 'gargantuan': 'gargantuan', '巨无霸': 'gargantuan',
};

const PROFILE_CN: Record<string, AIProfile> = {
  '残暴': 'aggressive', 'aggressive': 'aggressive', '莽夫': 'aggressive',
  '战术': 'tactical', 'tactical': 'tactical',
  '游击': 'skirmisher', 'skirmisher': 'skirmisher',
  '远程': 'ranged', 'ranged': 'ranged',
  '防御': 'defensive', 'defensive': 'defensive', '守卫': 'defensive',
  '懦弱': 'cowardly', 'cowardly': 'cowardly',
  '辅助': 'support', 'support': 'support', '治疗': 'support',
  '爆发': 'blaster', 'blaster': 'blaster',
};

const KIND_CN: Record<string, AiAbilityKind> = {
  'melee': 'melee', '近战': 'melee', '近战武器': 'melee',
  'ranged': 'ranged', '远程': 'ranged', '远程武器': 'ranged',
  'save-aoe': 'save-aoe', 'aoe': 'save-aoe', '范围豁免': 'save-aoe', '范围': 'save-aoe', '豁免范围': 'save-aoe',
  'save': 'save', '单体豁免': 'save', '控制': 'save',
  'heal': 'heal', '治疗': 'heal',
};

const AOSE_SHAPE_CN: Record<string, AoeShapeKind> = {
  'circle': 'circle', '圆': 'circle', '圆形': 'circle', '球': 'sphere', 'sphere': 'sphere', '球形': 'sphere',
  'cylinder': 'cylinder', '圆柱': 'cylinder', '圆柱体': 'cylinder',
  'cone': 'cone', '锥': 'cone', '锥形': 'cone',
  'line': 'line', '线': 'line', '线形': 'line', '直线': 'line',
  'cube': 'cube', '立方': 'cube', '立方体': 'cube',
  'square': 'square', '方': 'square', '方形': 'square',
};

// ============ 敌卡定义 ============

export interface StatblockDef {
  id: string;
  name: string;
  size: Size;
  cr: number;
  ac: number;
  hp: number;
  speed: number;
  abilities: Abilities;
  attacks: AiAbility[];
  resistances: DamageType[];
  immunities: DamageType[];
  vulnerabilities: DamageType[];
  aiProfile: AIProfile;
  note?: string;
}

/** 预设 → 敌卡 */
export function statblockFromPreset(p: MonsterPreset): StatblockDef {
  const attacks: AiAbility[] = p.aiAbilities
    ? p.aiAbilities.map(a => ({ ...a }))
    : p.attack
      ? [{
          id: 'atk', name: p.attack.name, kind: 'melee',
          attackBonus: p.attack.bonus, dice: p.attack.damage,
          damageType: p.attack.type, range: 5, multiAttack: 1,
        }]
      : [];
  return {
    id: `sb-${p.name}`,
    name: p.name,
    size: p.size,
    cr: p.cr,
    ac: p.ac,
    hp: p.hp,
    speed: p.speed,
    abilities: { ...p.abilities },
    attacks,
    resistances: [...(p.resistances ?? [])],
    immunities: [...(p.immunities ?? [])],
    vulnerabilities: [...(p.vulnerabilities ?? [])],
    aiProfile: p.aiProfile ?? 'tactical',
    note: p.note,
  };
}

/** 现有单位 → 敌卡（编辑后存入图鉴） */
export function statblockFromUnit(u: BattleUnit): StatblockDef {
  return {
    id: `sb-${u.name}`,
    name: u.name,
    size: u.size,
    cr: u.cr ?? 1,
    ac: u.ac,
    hp: u.maxHp,
    speed: u.speed,
    abilities: u.abilities ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    attacks: (u.aiAbilities ?? []).map(a => ({ ...a })),
    resistances: [...u.resistances],
    immunities: [...u.immunities],
    vulnerabilities: [...u.vulnerabilities],
    aiProfile: u.aiProfile ?? 'tactical',
    note: u.notes,
  };
}

/** 敌卡 → 新战斗单位（位置由调用方摆放） */
export function unitFromStatblock(def: StatblockDef, idx = 0, hostile = true, pos = { x: 0, y: 0 }): BattleUnit {
  const suffix = idx > 0 ? String(idx + 1) : '';
  const id = `${def.name}${suffix}`;
  return {
    id,
    name: id,
    dataSource: 'statblock',
    init: 10,
    initMod: Math.floor(((def.abilities.dex ?? 10) - 10) / 2),
    hp: def.hp,
    maxHp: def.hp,
    tempHp: 0,
    ac: def.ac,
    speed: def.speed,
    pos,
    attitude: hostile ? 2 : 0,
    statuses: [],
    isPlayer: false,
    playerControlled: !hostile,
    size: def.size,
    cr: def.cr,
    abilities: { ...def.abilities },
    resistances: [...def.resistances],
    immunities: [...def.immunities],
    vulnerabilities: [...def.vulnerabilities],
    actionEconomy: { action: false, bonus: false, reaction: false, movementUsed: 0 },
    hasActed: false,
    aiProfile: def.aiProfile,
    aiAbilities: def.attacks.map(a => ({ ...a })),
    notes: def.note ?? '',
  };
}

/** 敌卡补全已有单位（保留 id/pos/init/HP 等运行时字段；默认值字段会被覆盖） */
export function applyStatblockToUnit(unit: BattleUnit, def: StatblockDef): BattleUnit {
  const thin = unit.dataSource === undefined || unit.dataSource === 'ai-parsed';
  return {
    ...unit,
    ac: thin || unit.ac === 13 ? def.ac : unit.ac,
    maxHp: def.hp > unit.maxHp ? def.hp : unit.maxHp,
    size: def.size,
    cr: def.cr,
    abilities: unit.abilities ?? { ...def.abilities },
    resistances: unit.resistances.length > 0 ? unit.resistances : [...def.resistances],
    immunities: unit.immunities.length > 0 ? unit.immunities : [...def.immunities],
    vulnerabilities: unit.vulnerabilities.length > 0 ? unit.vulnerabilities : [...def.vulnerabilities],
    speed: unit.speed === 30 ? def.speed : unit.speed,
    aiProfile: unit.aiProfile ?? def.aiProfile,
    aiAbilities: def.attacks.map(a => ({ ...a })),
    notes: unit.notes || def.note || unit.notes,
    dataSource: 'statblock',
    reach: unit.reach ?? (def.size === 'large' ? 10 : 5),
  };
}

// ============ 名字匹配 ============

/** 去掉名字尾部的实例编号："哥布林弓手 2"/"哥布林弓手2"/"哥布林弓手·二" → "哥布林弓手" */
export function stripInstanceSuffix(name: string): string {
  return name
    .replace(/[\s·\-_]*(\d+|[一二三四五六七八九十]+)$/, '')
    .replace(/[\s·\-_]*[A-Za-z]$/, '')
    .trim();
}

/** 在卡池中为单位名找最佳匹配（最长前缀优先；精确 > 前缀 > 去后缀） */
export function matchStatblockForName(name: string, defs: StatblockDef[]): StatblockDef | null {
  if (defs.length === 0) return null;
  const n = name.trim();
  // 1. 精确
  let best = defs.find(d => d.name === n);
  if (best) return best;
  // 2. 名字以卡名开头（哥布林弓手2 → 哥布林弓手），取最长卡名
  let bestLen = 0;
  for (const d of defs) {
    if (n.startsWith(d.name) && d.name.length > bestLen) { best = d; bestLen = d.name.length; }
  }
  if (best) return best;
  // 3. 卡名以单位名开头（单位"哥布林" 匹配卡"哥布林"，含单卡场景）或去后缀后再匹配
  const stripped = stripInstanceSuffix(n);
  if (stripped !== n) return matchStatblockForName(stripped, defs);
  for (const d of defs) {
    if (d.name.startsWith(n) && d.name.length > bestLen) { best = d; bestLen = d.name.length; }
  }
  return best ?? null;
}

// ============ <encounter> 块解析（AI 输出容错） ============

export interface EncounterParseResult {
  defs: StatblockDef[];
  warnings: string[];
}

/** 容错 JSON 解析：接受尾逗号、中文引号、代码块围栏、前后杂文本 */
export function lenientJsonParse(raw: string): unknown | null {
  let text = raw.trim();
  // 剥 ```json 围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  // 截取第一个 { 或 [ 到最后一个 } 或 ]
  const start = Math.min(
    ...[text.indexOf('{'), text.indexOf('[')].filter(i => i >= 0).concat([Number.MAX_SAFE_INTEGER]),
  );
  if (start === Number.MAX_SAFE_INTEGER) return null;
  const endCurly = text.lastIndexOf('}');
  const endSquare = text.lastIndexOf(']');
  const end = Math.max(endCurly, endSquare);
  text = text.slice(start, end + 1);
  // 尾逗号 / 中文引号 / 中文冒号
  text = text.replace(/，/g, ',').replace(/：/g, ':').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  text = text.replace(/,\s*([}\]])/g, '$1');
  for (let i = 0; i < 3; i++) {
    try {
      return JSON.parse(text);
    } catch {
      // 再修一轮：单引号键名
      try {
        return JSON.parse(text.replace(/'([^']+)'\s*:/g, '"$1":').replace(/:\s*'([^']*)'/g, ': "$1"'));
      } catch { /* 继续 */ }
      // 最后手段：砍掉末尾一个字符重试（处理多余标点）
      if (text.length > 2) text = text.slice(0, -1).replace(/[,\s]+$/, '') + (endCurly > endSquare ? '}' : ']');
      else return null;
    }
  }
  return null;
}

function toNum(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = v.match(/-?\d+(?:\.\d+)?/);
    if (m) return parseFloat(m[0]);
  }
  return fallback;
}

function toDamageType(v: unknown): DamageType | undefined {
  if (typeof v !== 'string') return undefined;
  return DAMAGE_TYPE_CN[v.trim().toLowerCase()] ?? DAMAGE_TYPE_CN[v.trim()] ?? DAMAGE_TYPE_CN[v.trim().split('')[0]];
}

function toDamageList(v: unknown): DamageType[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,，、/|]+/);
  const out: DamageType[] = [];
  for (const item of arr) {
    const t = toDamageType(item);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 解析一条动作（中英字段别名全兼容） */
function parseAttack(raw: unknown, idx: number, warnings: string[]): AiAbility | null {
  if (typeof raw === 'string') {
    // "长弓|+4|1d8+1|穿刺|80尺" 或 "弯刀 +4 1d6+2 挥砍"（空格分隔）
    const parts = raw.split(/[|,，]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      return parseAttack({ name: parts[0], attackBonus: parts[1], dice: parts[2], damageType: parts[3], range: parts[4] }, idx, warnings);
    }
    const ws = raw.split(/\s+/).map(s => s.trim()).filter(Boolean);
    if (ws.length >= 3) {
      // 弯刀 +4 1d6+2 挥砍 [5尺] [多次攻击2]
      return parseAttack({ name: ws[0], attackBonus: ws[1], dice: ws[2], damageType: ws[3], range: ws[4], 多次攻击: ws[5] }, idx, warnings);
    }
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? o['名称'] ?? `动作${idx + 1}`);
  const kindStr = String(o.kind ?? o['类型'] ?? o['动作类型'] ?? '').trim();
  const rangeRaw = o.range ?? o['射程'] ?? o['触及'] ?? o['距离'] ?? 5;
  let range = toNum(rangeRaw, 5);
  if (typeof rangeRaw === 'string' && /尺|ft/i.test(rangeRaw)) range = toNum(rangeRaw, 5);
  const hasAoe = o.aoe ?? o['范围'] ?? o['AoE'] ?? o['波及'];
  const save = o.save ?? o['豁免'] ?? o['豁免详情'];
  let saveAbility: AbilityKey | undefined;
  let saveDc: number | undefined;
  let halfOnSuccess = o.halfOnSuccess === true || o['半伤豁免'] === true || o['豁免半伤'] === true;
  if (typeof save === 'string') {
    const am = save.match(/(力量|敏捷|体质|智力|感知|魅力|str|dex|con|int|wis|cha)/i);
    const dm = save.match(/DC\s*(\d+)/i);
    if (am) saveAbility = ABILITY_CN[am[1].toLowerCase()] ?? ABILITY_CN[am[1]];
    if (dm) saveDc = parseInt(dm[1], 10);
  } else if (save && typeof save === 'object') {
    const so = save as Record<string, unknown>;
    const ab = so.ability ?? so['属性'];
    if (typeof ab === 'string') saveAbility = ABILITY_CN[ab.toLowerCase()] ?? ABILITY_CN[ab];
    saveDc = toNum(so.dc ?? so.DC ?? so['DC'], 13);
    halfOnSuccess = halfOnSuccess || so.halfOnSuccess === true || so.half === true || so['半伤'] === true;
  }
  if (o.saveDc !== undefined) saveDc = toNum(o.saveDc, 13);
  if (o['豁免DC'] !== undefined) saveDc = toNum(o['豁免DC'], 13);
  if (typeof o.saveAbility === 'string') saveAbility = ABILITY_CN[o.saveAbility.toLowerCase()] ?? ABILITY_CN[o.saveAbility];
  if (typeof o['豁免属性'] === 'string') saveAbility = ABILITY_CN[o['豁免属性'].toLowerCase()] ?? ABILITY_CN[o['豁免属性']];

  // AoE
  let aoe: AiAbility['aoe'] | undefined;
  if (hasAoe) {
    if (typeof hasAoe === 'string') {
      const sm = hasAoe.match(/(\d+)\s*尺/);
      const shape = AOSE_SHAPE_CN[hasAoe.replace(/\d+|尺|半/g, '').trim()] ?? 'circle';
      aoe = { kind: shape, size: sm ? parseInt(sm[1], 10) : 20 };
    } else if (typeof hasAoe === 'object') {
      const ao = hasAoe as Record<string, unknown>;
      const shapeStr = String(ao.kind ?? ao['形状'] ?? 'circle');
      aoe = {
        kind: AOSE_SHAPE_CN[shapeStr.toLowerCase()] ?? AOSE_SHAPE_CN[shapeStr] ?? 'circle',
        size: toNum(ao.size ?? ao['尺寸'] ?? ao['半径'], 20),
      };
    }
  }

  // 环阶/专注/附赠/附加状态（法术型动作）
  const spellLevel = o.spellLevel !== undefined ? toNum(o.spellLevel, 0)
    : o['环阶'] !== undefined ? toNum(o['环阶'], 0) : undefined;
  const concentration = o.concentration === true || o['专注'] === true || o['需要专注'] === true;
  const bonusAction = o.bonusAction === true || o['附赠动作'] === true;
  // 附加状态：英文键直用；中文名（倒地/麻痹/力竭…）归一为引擎键，未知值原样保留（至少可见）
  const applyStatusRaw = typeof o.applyStatus === 'string' ? o.applyStatus
    : Array.isArray(o.applyStatus) && typeof o.applyStatus[0] === 'string' ? o.applyStatus[0]
    : typeof o['附加状态'] === 'string' ? o['附加状态']
    : Array.isArray(o['附加状态']) && typeof o['附加状态'][0] === 'string' ? o['附加状态'][0]
    : undefined;
  const applyStatus = applyStatusRaw !== undefined ? (resolveStatus(applyStatusRaw) ?? applyStatusRaw) : undefined;

  // kind 推导：显式 > AoE/豁免暗示
  let kind: AiAbilityKind;
  const isHeal = /治疗|回复|heal/i.test(name) || o.heal === true || o['治疗'] === true;
  if (kindStr && KIND_CN[kindStr.toLowerCase()] !== undefined) kind = KIND_CN[kindStr.toLowerCase()];
  else if (kindStr && KIND_CN[kindStr] !== undefined) kind = KIND_CN[kindStr];
  else if (isHeal) kind = 'heal';
  else if (aoe) kind = 'save-aoe';
  else if (saveAbility && o.dice === undefined && o['伤害'] === undefined && o.damage === undefined) kind = 'save';
  else if (saveAbility) kind = 'save-aoe'; // 有豁免又有伤害 → 按范围豁免处理（单体亦兼容）
  else kind = range > 5 ? 'ranged' : 'melee';

  // 公式全角归一（１ｄ８＋３ → 1d8+3），存储层保持半角规范形
  const dice = normalizeWidth(String(o.dice ?? o.damage ?? o['伤害'] ?? o['伤害公式'] ?? (isHeal ? '1d8' : '1d6')));
  const ab = o.attackBonus ?? o['命中'] ?? o['命中加值'] ?? o['加值'] ?? o['攻击加值'];
  const attackBonus = ab !== undefined ? toNum(ab, 0) : undefined;
  const multiAttack = o.multiAttack !== undefined ? toNum(o.multiAttack, 1)
    : o['多次攻击'] !== undefined ? toNum(o['多次攻击'], 1) : 1;

  return {
    id: `a${idx}-${name}`,
    name,
    kind,
    attackBonus,
    dice,
    damageType: toDamageType(o.damageType ?? o['伤害类型']),
    range,
    aoe,
    saveAbility,
    saveDc,
    halfOnSuccess,
    multiAttack,
    spellLevel,
    concentration,
    bonusAction,
    applyStatus,
    note: typeof o.note === 'string' ? o.note : typeof o['描述'] === 'string' ? o['描述'] : undefined,
  };
}

function parseAbilities(raw: unknown): Abilities {
  const fallback: Abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  const out: Abilities = { ...fallback };
  for (const [k, v] of Object.entries(o)) {
    const key = ABILITY_CN[k.toLowerCase()] ?? ABILITY_CN[k];
    if (key) out[key] = toNum(v, 10);
  }
  return out;
}

/** 解析一条敌卡定义（中英字段别名） */
function parseDef(raw: unknown, warnings: string[]): StatblockDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? o['名称'] ?? o.id ?? '').trim();
  if (!name) {
    warnings.push('一张敌卡缺少名称，已跳过');
    return null;
  }
  const sizeRaw = String(o.size ?? o['体型'] ?? '中型').trim();
  const size = SIZE_CN[sizeRaw.toLowerCase()] ?? SIZE_CN[sizeRaw] ?? 'medium';
  const hpRaw = o.hp ?? o['生命值'] ?? o.HP ?? 10;
  let hp = toNum(hpRaw, 10);
  if (hpRaw && typeof hpRaw === 'object') {
    const h = hpRaw as Record<string, unknown>;
    hp = toNum(h.max ?? h['最大'] ?? h.average ?? h['均值'], 10);
  } else if (typeof hpRaw === 'string' && /\d+\s*[-~]\s*\d+/.test(hpRaw)) {
    const [a, b] = hpRaw.match(/\d+/g)!.map(Number);
    hp = Math.round((a + b) / 2);
  }
  const profileRaw = String(o.aiProfile ?? o['战术'] ?? o['档案'] ?? o.profile ?? '').trim();
  const aiProfile = (PROFILE_CN[profileRaw.toLowerCase()] ?? PROFILE_CN[profileRaw] ?? 'tactical') as AIProfile;

  const attacksRaw = o.attacks ?? o['攻击'] ?? o['动作'] ?? o.actions ?? o.abilities_list ?? [];
  const attackList = Array.isArray(attacksRaw) ? attacksRaw : attacksRaw ? [attacksRaw] : [];
  const attacks: AiAbility[] = [];
  attackList.forEach((a, i) => {
    const parsed = parseAttack(a, i, warnings);
    if (parsed) attacks.push(parsed);
  });
  if (attacks.length === 0) {
    warnings.push(`「${name}」没有可用动作，已补默认徒手打击`);
    attacks.push({ id: 'a0-unarmed', name: '徒手打击', kind: 'melee', attackBonus: 2, dice: '1d4', damageType: 'bludgeoning', range: 5, multiAttack: 1 });
  }

  const crRaw = o.cr ?? o['挑战等级'] ?? o.CR ?? 1;
  const cr = toNum(crRaw, 1);

  return {
    id: `sb-${name}`,
    name,
    size,
    cr,
    ac: toNum(o.ac ?? o.AC ?? o['护甲等级'] ?? o['护甲'] ?? 13, 13),
    hp,
    speed: toNum(o.speed ?? o['速度'] ?? 30, 30),
    abilities: parseAbilities(o.abilities ?? o['属性'] ?? o['六维']),
    attacks,
    resistances: toDamageList(o.resistances ?? o['抗性']),
    immunities: toDamageList(o.immunities ?? o['免疫']),
    vulnerabilities: toDamageList(o.vulnerabilities ?? o['易伤']),
    aiProfile,
    note: typeof (o.note ?? o['备注'] ?? o['描述']) === 'string' ? String(o.note ?? o['备注'] ?? o['描述']) : undefined,
  };
}

/** 解析 <encounter>/<statblock> 块内容（对象 / 数组 / {enemies:[...]} 均可） */
export function parseEncounterDefs(raw: string): EncounterParseResult {
  const warnings: string[] = [];
  const defs: StatblockDef[] = [];
  const data = lenientJsonParse(raw);
  if (data === null) {
    warnings.push('敌卡 JSON 解析失败：内容不是合法 JSON');
    return { defs, warnings };
  }
  const collect = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const item of v) {
        const d = parseDef(item, warnings);
        if (d) defs.push(d);
      }
    } else if (v && typeof v === 'object') {
      const d = parseDef(v, warnings);
      if (d) defs.push(d);
    } else {
      // 反例：enemies 字段是字符串/数字等非容器 → 明确警告而非静默吞掉
      warnings.push(`敌卡列表不是数组或对象（${typeof v}），已忽略`);
    }
  };
  if (Array.isArray(data)) {
    collect(data);
  } else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const list = o.enemies ?? o['敌人'] ?? o.monsters ?? o['怪物'] ?? o.statblocks ?? o.units;
    if (list !== undefined) collect(list);
    else collect(data);
  }
  return { defs, warnings };
}

/** 生成 <encounter> 块（导出/给 AI 看的示例格式） */
export function generateEncounterBlock(defs: StatblockDef[]): string {
  const payload = defs.map(d => ({
    name: d.name,
    size: SIZE_META[d.size].name,
    cr: d.cr,
    ac: d.ac,
    hp: d.hp,
    speed: d.speed,
    abilities: { 力量: d.abilities.str, 敏捷: d.abilities.dex, 体质: d.abilities.con, 智力: d.abilities.int, 感知: d.abilities.wis, 魅力: d.abilities.cha },
    attacks: d.attacks.map(a => {
      const out: Record<string, unknown> = { name: a.name, kind: a.kind, range: a.range };
      if (a.attackBonus !== undefined) out.attackBonus = a.attackBonus;
      out.dice = a.dice;
      if (a.damageType) out.damageType = DAMAGE_TYPE_TO_CN[a.damageType];
      if (a.saveAbility) { out.save = `${ABILITY_LABELS[a.saveAbility]} DC${a.saveDc ?? 13}`; if (a.halfOnSuccess) out.halfOnSuccess = true; }
      if (a.aoe) out.aoe = { kind: a.aoe.kind, size: a.aoe.size };
      if ((a.multiAttack ?? 1) > 1) out.multiAttack = a.multiAttack;
      if (a.spellLevel !== undefined) out.spellLevel = a.spellLevel;
      if (a.concentration) out.concentration = true;
      if (a.bonusAction) out.bonusAction = true;
      if (a.applyStatus) out.applyStatus = a.applyStatus;
      return out;
    }),
    resistances: d.resistances.map(t => DAMAGE_TYPE_TO_CN[t]),
    immunities: d.immunities.map(t => DAMAGE_TYPE_TO_CN[t]),
    vulnerabilities: d.vulnerabilities.map(t => DAMAGE_TYPE_TO_CN[t]),
    aiProfile: AI_PROFILE_META[d.aiProfile].label,
    note: d.note ?? '',
  }));
  return `<encounter>\n${JSON.stringify(payload.length === 1 ? payload[0] : payload, null, 2)}\n</encounter>`;
}

const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力',
};

// ============ 图鉴持久化 ============

const BESTIARY_KEY = 'dnd-bestiary-v1';

export function loadBestiary(): StatblockDef[] {
  try {
    const raw = localStorage.getItem(BESTIARY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveBestiary(defs: StatblockDef[]): void {
  try {
    localStorage.setItem(BESTIARY_KEY, JSON.stringify(defs));
  } catch { /* 静默 */ }
}

/** 导出/导入单张卡的 JSON 文本 */
export function statblockToJson(def: StatblockDef): string {
  return JSON.stringify(def, null, 2);
}

export function statblockFromJson(text: string): StatblockDef | null {
  const data = lenientJsonParse(text);
  if (!data || typeof data !== 'object') return null;
  const warnings: string[] = [];
  return parseDef(data, warnings);
}
