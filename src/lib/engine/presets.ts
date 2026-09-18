/**
 * 怪物快速预设（2024 怪物图鉴常用条目，数值为快速开团参考，可编辑）
 * 每个预设附带 AI 战术档案（aiProfile）与动作表（abilities），供行动逻辑引擎使用
 */
import type { BattleUnit, Size, Abilities, AIProfile, AiAbility, MapObstacle } from './types';

export interface MonsterPreset {
  name: string;
  cr: number;
  size: Size;
  ac: number;
  hp: number;
  speed: number;
  abilities: Abilities;
  resistances?: BattleUnit['resistances'];
  immunities?: BattleUnit['immunities'];
  vulnerabilities?: BattleUnit['vulnerabilities'];
  note?: string;
  /** AI 战术档案 */
  aiProfile?: AIProfile;
  /** AI 动作表（省略则从 attack 推导） */
  aiAbilities?: AiAbility[];
  attack?: { name: string; bonus: number; damage: string; type: 'slashing' | 'piercing' | 'bludgeoning' | 'fire' | 'poison' | 'cold' | 'lightning' | 'necrotic' | 'psychic' | 'radiant' | 'acid' | 'thunder' | 'force' };
}

const A = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Abilities =>
  ({ str, dex, con, int, wis, cha });

const atk = (id: string, name: string, bonus: number, damage: string, type: AiAbility['damageType'], extra: Partial<AiAbility> = {}): AiAbility => ({
  id, name, kind: 'melee', attackBonus: bonus, dice: damage, damageType: type, range: 5, multiAttack: 1, ...extra,
});

export const MONSTER_PRESETS: MonsterPreset[] = [
  {
    name: '哥布林', cr: 0.25, size: 'small', ac: 15, hp: 7, speed: 30, abilities: A(8, 15, 10, 10, 8, 8),
    note: '灵巧撤退/镍尔斩', aiProfile: 'skirmisher',
    aiAbilities: [atk('scimitar', '弯刀', 4, '1d6+2', 'slashing')],
  },
  {
    name: '哥布林弓手', cr: 0.5, size: 'small', ac: 13, hp: 10, speed: 30, abilities: A(8, 15, 10, 10, 8, 8),
    note: '短弓 80 尺；被近身则后退射击', aiProfile: 'ranged',
    aiAbilities: [atk('shortbow', '短弓', 4, '1d6+2', 'piercing', { kind: 'ranged', range: 80 })],
  },
  {
    name: '哥布林头目', cr: 1, size: 'small', ac: 17, hp: 21, speed: 30, abilities: A(10, 14, 10, 10, 8, 10),
    note: '双斧/指挥怒吼', aiProfile: 'tactical',
    aiAbilities: [atk('battleaxe', '战斧', 4, '1d6+2', 'slashing', { multiAttack: 2 })],
  },
  {
    name: '兽人', cr: 0.5, size: 'medium', ac: 13, hp: 15, speed: 30, abilities: A(16, 12, 16, 8, 11, 10),
    note: '残暴攻击(重击可推开)', aiProfile: 'aggressive',
    aiAbilities: [atk('greataxe', '巨斧', 5, '1d12+3', 'slashing')],
  },
  {
    name: '强盗', cr: 0.125, size: 'medium', ac: 12, hp: 11, speed: 30, abilities: A(12, 12, 11, 10, 10, 10),
    aiProfile: 'tactical',
    aiAbilities: [atk('scimitar', '弯刀', 3, '1d6+1', 'slashing')],
  },
  {
    name: '骷髅', cr: 0.25, size: 'medium', ac: 13, hp: 13, speed: 30, abilities: A(10, 14, 15, 6, 8, 5),
    vulnerabilities: ['bludgeoning'], aiProfile: 'aggressive',
    aiAbilities: [atk('shortsword', '短剑', 4, '1d6+2', 'piercing')],
  },
  {
    name: '僵尸', cr: 0.25, size: 'medium', ac: 8, hp: 22, speed: 20, abilities: A(13, 6, 16, 3, 6, 5),
    immunities: ['poison'], note: '不死坚韧性：HP 归 0 时体质豁免 DC 5+伤害', aiProfile: 'aggressive',
    aiAbilities: [atk('slam', '挥击', 3, '1d6+1', 'bludgeoning')],
  },
  {
    name: '豺狼人', cr: 0.5, size: 'medium', ac: 12, hp: 22, speed: 30, abilities: A(14, 12, 12, 7, 10, 7),
    aiProfile: 'aggressive',
    aiAbilities: [atk('spear', '长矛', 4, '1d6+2', 'piercing', { kind: 'ranged', range: 20 })],
  },
  {
    name: '大地精', cr: 1, size: 'medium', ac: 18, hp: 22, speed: 30, abilities: A(13, 11, 12, 10, 10, 9),
    aiProfile: 'tactical',
    aiAbilities: [atk('battleaxe', '战斧', 4, '1d8+2', 'slashing')],
  },
  {
    name: '狼', cr: 0.25, size: 'medium', ac: 13, hp: 11, speed: 40, abilities: A(12, 15, 12, 3, 12, 6),
    note: '群体战术：同伴在场时攻击优势', aiProfile: 'aggressive',
    aiAbilities: [atk('bite', '撕咬', 4, '1d4+2', 'piercing', { multiAttack: 1 })],
  },
  {
    name: '棕熊', cr: 1, size: 'large', ac: 11, hp: 22, speed: 40, abilities: A(18, 10, 16, 2, 13, 7),
    note: '熊抱：命中后擒抱 DC 14', aiProfile: 'aggressive',
    aiAbilities: [atk('claw', '爪击', 6, '1d8+4', 'piercing', { multiAttack: 2 })],
  },
  {
    name: '食人魔', cr: 2, size: 'large', ac: 11, hp: 59, speed: 40, abilities: A(19, 8, 16, 5, 7, 7),
    aiProfile: 'aggressive',
    aiAbilities: [atk('greatclub', '大棒', 6, '2d8+4', 'bludgeoning', { multiAttack: 2 })],
  },
  {
    name: '食尸鬼', cr: 1, size: 'medium', ac: 12, hp: 22, speed: 30, abilities: A(13, 15, 10, 7, 10, 6),
    immunities: ['poison'], note: '豁免失败麻痹', aiProfile: 'aggressive',
    aiAbilities: [atk('claw', '爪击', 4, '2d4+2', 'slashing', { multiAttack: 2 })],
  },
  {
    name: '幽灵', cr: 1, size: 'medium', ac: 11, hp: 22, speed: 40, abilities: A(7, 13, 10, 10, 12, 17),
    resistances: ['bludgeoning', 'piercing', 'slashing'], immunities: ['poison', 'necrotic'], aiProfile: 'tactical',
    aiAbilities: [atk('withering', '枯萎之触', 4, '3d6', 'necrotic')],
  },
  {
    name: '巨蝎', cr: 3, size: 'large', ac: 15, hp: 52, speed: 40, abilities: A(15, 16, 13, 1, 9, 3),
    note: '附加 2d10 毒伤(体质 DC12)', aiProfile: 'aggressive',
    aiAbilities: [
      atk('sting', '毒螫', 5, '1d10+3', 'piercing', { multiAttack: 2 }),
      { id: 'venom', name: '蝎毒', kind: 'melee', attackBonus: 5, dice: '2d10', damageType: 'poison', range: 5, saveAbility: 'con', saveDc: 12, note: '附加毒伤' },
    ],
  },
  {
    name: '巨蜘蛛', cr: 1, size: 'large', ac: 14, hp: 26, speed: 30, abilities: A(14, 16, 12, 2, 11, 4),
    note: '附加 2d8 毒(体质 DC11)', aiProfile: 'skirmisher',
    aiAbilities: [
      atk('bite', '毒咬', 5, '1d8+3', 'piercing'),
      { id: 'venom', name: '蛛毒', kind: 'melee', attackBonus: 5, dice: '2d8', damageType: 'poison', range: 5, saveAbility: 'con', saveDc: 11, note: '附加毒伤' },
    ],
  },
  {
    name: '鹰马骑兵', cr: 1, size: 'large', ac: 13, hp: 26, speed: 60, abilities: A(16, 13, 13, 2, 12, 8),
    aiProfile: 'skirmisher',
    aiAbilities: [atk('dive', '俯冲爪', 5, '1d8+3', 'slashing')],
  },
  {
    name: '双足飞龙', cr: 2, size: 'large', ac: 13, hp: 59, speed: 30, abilities: A(18, 12, 16, 5, 10, 7),
    note: '附加 2d6 毒(体质 DC14)', aiProfile: 'aggressive',
    aiAbilities: [
      atk('bite', '毒咬', 6, '1d6+4', 'piercing', { multiAttack: 2 }),
      { id: 'venom', name: '飞龙毒', kind: 'melee', attackBonus: 6, dice: '2d6', damageType: 'poison', range: 5, saveAbility: 'con', saveDc: 14, note: '附加毒伤' },
    ],
  },
  {
    name: '地精萨满', cr: 1, size: 'small', ac: 10, hp: 21, speed: 30, abilities: A(8, 14, 10, 14, 10, 10),
    note: '施法者：燃烧之手/火球', aiProfile: 'ranged',
    aiAbilities: [
      atk('firebolt', '火焰箭', 4, '2d6', 'fire', { kind: 'ranged', range: 120 }),
      { id: 'burning-hands', name: '燃烧之手', kind: 'save-aoe', dice: '3d6', damageType: 'fire', range: 15, aoe: { kind: 'cone', size: 15 }, saveAbility: 'dex', saveDc: 13, halfOnSuccess: true, note: '15尺锥形' },
    ],
  },
  {
    name: '石像鬼', cr: 2, size: 'medium', ac: 15, hp: 52, speed: 30, abilities: A(15, 11, 16, 6, 11, 7),
    resistances: ['bludgeoning', 'piercing', 'slashing'], immunities: ['poison'], aiProfile: 'defensive',
    aiAbilities: [atk('claw', '爪击', 4, '1d6+2', 'slashing', { multiAttack: 2 })],
  },
  {
    name: '土元素', cr: 5, size: 'large', ac: 17, hp: 126, speed: 30, abilities: A(20, 8, 20, 5, 10, 5),
    vulnerabilities: ['thunder'], resistances: ['piercing', 'slashing'], immunities: ['poison'], aiProfile: 'aggressive',
    aiAbilities: [atk('slam', '重拳', 8, '2d8+5', 'bludgeoning', { multiAttack: 2 })],
  },
  {
    name: '火元素', cr: 5, size: 'large', ac: 13, hp: 102, speed: 50, abilities: A(10, 17, 16, 6, 10, 7),
    resistances: ['bludgeoning', 'piercing', 'slashing'], immunities: ['fire', 'poison'], aiProfile: 'aggressive',
    aiAbilities: [atk('touch', '灼烧', 6, '2d6+3', 'fire', { multiAttack: 2 })],
  },
  {
    name: '死灵法师', cr: 9, size: 'medium', ac: 12, hp: 90, speed: 30, abilities: A(11, 16, 16, 20, 14, 16),
    resistances: ['cold', 'lightning', 'necrotic'], note: '传奇动作×3', aiProfile: 'ranged',
    aiAbilities: [
      atk('ray', '致死射线', 9, '8d8', 'necrotic', { kind: 'ranged', range: 120 }),
      { id: 'fireball', name: '火球术', kind: 'save-aoe', dice: '8d6', damageType: 'fire', range: 150, aoe: { kind: 'sphere', size: 20 }, saveAbility: 'dex', saveDc: 17, halfOnSuccess: true, note: '半径20尺球体' },
    ],
  },
  {
    name: '成年红火龙', cr: 14, size: 'huge', ac: 19, hp: 212, speed: 40, abilities: A(27, 10, 23, 12, 15, 21),
    immunities: ['fire'], note: '火息 18d6(敏捷DC19半伤)·传奇抗性·传奇动作×3·巢穴动作', aiProfile: 'aggressive',
    aiAbilities: [
      atk('bite', '撕咬', 14, '2d10+8', 'piercing', { multiAttack: 3 }),
      { id: 'breath', name: '火息', kind: 'save-aoe', dice: '18d6', damageType: 'fire', range: 60, aoe: { kind: 'cone', size: 60 }, saveAbility: 'dex', saveDc: 19, halfOnSuccess: true, note: '60尺锥形' },
    ],
  },
  {
    name: '成年蓝水龙', cr: 14, size: 'huge', ac: 19, hp: 200, speed: 40, abilities: A(25, 10, 21, 16, 15, 20),
    immunities: ['lightning'], note: '闪息 12d10(体质DC19半伤)', aiProfile: 'aggressive',
    aiAbilities: [
      atk('bite', '撕咬', 13, '2d10+7', 'piercing', { multiAttack: 3 }),
      { id: 'breath', name: '闪息', kind: 'save-aoe', dice: '12d10', damageType: 'lightning', range: 60, aoe: { kind: 'line', size: 90 }, saveAbility: 'con', saveDc: 19, halfOnSuccess: true, note: '90尺直线' },
    ],
  },
  {
    name: '巫妖', cr: 21, size: 'medium', ac: 17, hp: 180, speed: 30, abilities: A(11, 16, 16, 20, 14, 16),
    resistances: ['cold', 'lightning', 'necrotic'], immunities: ['poison'], note: '传奇抗性·传奇动作×3·巢穴动作', aiProfile: 'ranged',
    aiAbilities: [
      atk('touch', '麻痹之触', 12, '3d6+6', 'cold', { multiAttack: 1 }),
      { id: 'fireball', name: '火球术', kind: 'save-aoe', dice: '10d6', damageType: 'fire', range: 150, aoe: { kind: 'sphere', size: 20 }, saveAbility: 'dex', saveDc: 19, halfOnSuccess: true },
      { id: 'blight', name: '枯萎术', kind: 'save-aoe', dice: '8d8', damageType: 'necrotic', range: 30, aoe: { kind: 'sphere', size: 10 }, saveAbility: 'con', saveDc: 19, halfOnSuccess: true },
    ],
  },
];

/** 从预设生成战斗单位 */
export function unitFromPreset(preset: MonsterPreset, index: number, hostile = true): BattleUnit {
  const suffix = index > 0 ? `${index}` : '';
  const id = `${preset.name}${suffix}`;
  const dexMod = Math.floor((preset.abilities.dex - 10) / 2);
  return {
    id,
    name: id,
    init: 10 + dexMod,
    initMod: dexMod,
    hp: preset.hp,
    maxHp: preset.hp,
    tempHp: 0,
    ac: preset.ac,
    speed: preset.speed,
    pos: { x: 0, y: 0 },
    attitude: hostile ? 2 : 0,
    statuses: [],
    isPlayer: false,
    size: preset.size,
    cr: preset.cr,
    abilities: { ...preset.abilities },
    resistances: preset.resistances ?? [],
    immunities: preset.immunities ?? [],
    vulnerabilities: preset.vulnerabilities ?? [],
    actionEconomy: { action: false, bonus: false, reaction: false, movementUsed: 0 },
    notes: preset.note,
    hasActed: false,
    aiProfile: preset.aiProfile ?? (preset.cr >= 3 ? 'aggressive' : 'tactical'),
    aiAbilities: preset.aiAbilities ? preset.aiAbilities.map(a => ({ ...a })) : deriveAbilities(preset, preset.attack),
  };
}

/** 无显式动作表时：从基础攻击推导（多重攻击按 CR） */
export function deriveAbilities(preset: MonsterPreset, attack?: MonsterPreset['attack']): AiAbility[] {
  if (!attack) {
    return [{
      id: 'unarmed', name: '徒手打击', kind: 'melee',
      attackBonus: 2 + Math.floor((preset.abilities.str - 10) / 2),
      dice: '1d4', damageType: 'bludgeoning', range: 5, multiAttack: 1,
    }];
  }
  const isRanged = /弓|箭|射线|射击/.test(attack.name);
  const multi = preset.cr >= 1.5 ? 2 : 1;
  return [{
    id: attack.name, name: attack.name, kind: isRanged ? 'ranged' : 'melee',
    attackBonus: attack.bonus, dice: attack.damage, damageType: attack.type,
    range: isRanged ? 80 : 5, multiAttack: multi,
  }];
}

// ============ 演示遭遇：哥布林营地突袭 ============

export interface DemoBattleData {
  units: Array<Partial<BattleUnit> & { id: string }>;
  obstacles: MapObstacle[];
  battleName: string;
}

/** 生成演示战斗：玩家(战士) + 牧师/法师队友(可切换操控) vs 哥布林小队
 *  坐标约定：单位 pos 为英尺（cell×5），障碍 cells 为格坐标 */
export function buildDemoBattle(): DemoBattleData {
  const wall = (cx: number, cy: number, len: number, kind: MapObstacle['kind'] = 'full'): MapObstacle['cells'] => {
    const cells: MapObstacle['cells'] = [];
    for (let i = 0; i < len; i++) cells.push({ cx: cx + i, cy });
    return cells;
  };

  const P = (id: string, name: string, opts: Partial<BattleUnit> & { cellX: number; cellY: number }): Partial<BattleUnit> & { id: string } => ({
    id, name, attitude: 0, hp: 30, maxHp: 30, ac: 16, speed: 30, size: 'medium',
    statuses: [], isPlayer: false, hasActed: false,
    pos: { x: opts.cellX * 5, y: opts.cellY * 5 },
    actionEconomy: { action: false, bonus: false, reaction: false, movementUsed: 0 },
    abilities: A(14, 12, 14, 10, 12, 10),
    ...opts,
  });

  const units: DemoBattleData['units'] = [
    P('player', '你（战士）', {
      cellX: 3, cellY: 4, isPlayer: true, playerControlled: true, hp: 44, maxHp: 44, ac: 18, speed: 30,
      init: 14, level: 5,
      abilities: A(16, 12, 14, 8, 12, 10),
      aiAbilities: [
        atk('longsword', '长剑', 7, '1d8+4', 'slashing', { multiAttack: 2 }),
        { id: 'second-wind', name: '回气', kind: 'heal', dice: '1d10+5', range: 0, note: '附赠动作回复' },
      ],
    }),
    P('cleric', '艾拉（牧师）', {
      cellX: 2, cellY: 2, hp: 32, maxHp: 32, ac: 15, speed: 30, init: 8, level: 5, playerControlled: false,
      abilities: A(10, 10, 14, 12, 16, 12),
      aiProfile: 'support',
      aiAbilities: [
        atk('mace', '硬头锤', 5, '1d6+3', 'bludgeoning'),
        { id: 'heal-word', name: '治疗真言', kind: 'heal', dice: '2d4+3', range: 60, note: '附赠动作远程治疗' },
        { id: 'cure-wounds', name: '疗伤术', kind: 'heal', dice: '3d8+3', range: 5, note: '动作大量治疗' },
      ],
      spellSlots: { 1: { current: 4, max: 4 }, 2: { current: 3, max: 3 } },
    }),
    P('wizard', '米拉（法师）', {
      cellX: 2, cellY: 6, hp: 26, maxHp: 26, ac: 12, speed: 30, init: 12, level: 5, playerControlled: false,
      abilities: A(8, 14, 12, 18, 12, 10),
      aiProfile: 'blaster',
      aiAbilities: [
        atk('firebolt', '火焰箭', 7, '2d10', 'fire', { kind: 'ranged', range: 120 }),
        { id: 'burning-hands', name: '燃烧之手', kind: 'save-aoe', dice: '3d6', damageType: 'fire', range: 15, aoe: { kind: 'cone', size: 15 }, saveAbility: 'dex', saveDc: 15, halfOnSuccess: true, note: '15尺锥形' },
        { id: 'fireball', name: '火球术', kind: 'save-aoe', dice: '6d6', damageType: 'fire', range: 60, aoe: { kind: 'sphere', size: 20 }, saveAbility: 'dex', saveDc: 15, halfOnSuccess: true, note: '3环·半径20尺' },
      ],
      spellSlots: { 1: { current: 4, max: 4 }, 3: { current: 2, max: 2 } },
    }),
    // 敌方（右侧）
    P('goblin1', '哥布林·刀手', {
      cellX: 15, cellY: 2, attitude: 2, hp: 7, maxHp: 7, ac: 15, speed: 30, init: 15,
      size: 'small', abilities: A(8, 15, 10, 10, 8, 8), cr: 0.25, aiProfile: 'skirmisher',
      aiAbilities: [atk('scimitar', '弯刀', 4, '1d6+2', 'slashing')],
    }),
    P('goblin2', '哥布林·刀手', {
      cellX: 15, cellY: 6, attitude: 2, hp: 7, maxHp: 7, ac: 15, speed: 30, init: 11,
      size: 'small', abilities: A(8, 15, 10, 10, 8, 8), cr: 0.25, aiProfile: 'skirmisher',
      aiAbilities: [atk('scimitar', '弯刀', 4, '1d6+2', 'slashing')],
    }),
    P('goblin3', '哥布林·刀手', {
      cellX: 16, cellY: 4, attitude: 2, hp: 7, maxHp: 7, ac: 15, speed: 30, init: 9,
      size: 'small', abilities: A(8, 15, 10, 10, 8, 8), cr: 0.25, aiProfile: 'skirmisher',
      aiAbilities: [atk('scimitar', '弯刀', 4, '1d6+2', 'slashing')],
    }),
    P('archer1', '哥布林·弓手', {
      cellX: 19, cellY: 1, attitude: 2, hp: 10, maxHp: 10, ac: 13, speed: 30, init: 13,
      size: 'small', abilities: A(8, 15, 10, 10, 8, 8), cr: 0.5, aiProfile: 'ranged',
      aiAbilities: [atk('shortbow', '短弓', 4, '1d6+2', 'piercing', { kind: 'ranged', range: 80 })],
    }),
    P('archer2', '哥布林·弓手', {
      cellX: 19, cellY: 7, attitude: 2, hp: 10, maxHp: 10, ac: 13, speed: 30, init: 7,
      size: 'small', abilities: A(8, 15, 10, 10, 8, 8), cr: 0.5, aiProfile: 'ranged',
      aiAbilities: [atk('shortbow', '短弓', 4, '1d6+2', 'piercing', { kind: 'ranged', range: 80 })],
    }),
    P('orc1', '兽人·碎颅者', {
      cellX: 18, cellY: 4, attitude: 2, hp: 15, maxHp: 15, ac: 13, speed: 30, init: 10,
      abilities: A(16, 12, 16, 8, 11, 10), cr: 0.5, aiProfile: 'aggressive',
      aiAbilities: [atk('greataxe', '巨斧', 5, '1d12+3', 'slashing')],
    }),
    P('boss', '哥布林头目', {
      cellX: 20, cellY: 4, attitude: 2, hp: 21, maxHp: 21, ac: 17, speed: 30, init: 16,
      size: 'small', abilities: A(10, 14, 10, 10, 8, 10), cr: 1, aiProfile: 'tactical',
      aiAbilities: [atk('battleaxe', '双斧', 4, '1d6+2', 'slashing', { multiAttack: 2 })],
    }),
  ];

  // 地图 22×9 格：中央石墙留缺口，木箱半身掩体，敌方阵地矮墙
  const obstacles: MapObstacle[] = [
    // 中央石墙（完全掩体）：上下两段，中间 3 行缺口
    { cells: [...wall(10, 0, 1), ...wall(10, 1, 1), ...wall(10, 2, 1)], kind: 'full', label: '石墙' },
    { cells: [...wall(10, 6, 1), ...wall(10, 7, 1), ...wall(10, 8, 1)], kind: 'full', label: '石墙' },
    // 木箱（半身掩体）
    { cells: [{ cx: 7, cy: 1 }, { cx: 7, cy: 2 }, { cx: 8, cy: 1 }], kind: 'half', label: '木箱' },
    { cells: [{ cx: 7, cy: 7 }, { cx: 8, cy: 7 }], kind: 'half', label: '木箱' },
    { cells: [{ cx: 13, cy: 2 }, { cx: 13, cy: 3 }], kind: 'half', label: '木箱' },
    { cells: [{ cx: 13, cy: 6 }], kind: 'half', label: '木箱' },
    { cells: [{ cx: 14, cy: 4 }], kind: 'half', label: '木箱' },
    // 敌方阵地矮墙（3/4 掩体）
    { cells: [{ cx: 17, cy: 0 }, { cx: 17, cy: 1 }], kind: 'threeQuarters', label: '矮墙' },
    { cells: [{ cx: 17, cy: 7 }, { cx: 17, cy: 8 }], kind: 'threeQuarters', label: '矮墙' },
    { cells: [{ cx: 19, cy: 4 }], kind: 'half', label: '木箱' },
  ];

  return { units, obstacles, battleName: '哥布林营地突袭' };
}
