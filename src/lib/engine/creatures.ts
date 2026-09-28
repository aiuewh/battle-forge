/**
 * 生物族类元数据（决定 2.5D 地图上敌方棋子的徽记）
 *
 * 分类优先级：
 * 1. 单位自带 creatureType（协议 type 字段 / 预设标注 / 面板手选）
 * 2. 名字关键词兜底 —— 保证 AI 即兴生成的怪物（<encounter> 里现编的名字）也有对应徽记
 *
 * 配色只描述「金属材质」，形体外轮廓在 iso/isoScene.ts 里绘制。
 */
import type { CreatureKind } from './types';

export interface CreatureMeta {
  /** 中文名（面板展示用） */
  label: string;
  /** 正面受光色 */
  face: string;
  /** 挤出侧面中调 */
  edge: string;
  /** 挤出侧面暗调（最外层） */
  edgeDark: string;
  /** 顶缘高光 */
  rim: string;
  /** 镂空（眼窝/帽内阴影）色 */
  void: string;
  /** 背光/发光色（帽中双眼、面甲灯） */
  glow: string;
}

export const CREATURE_META: Record<CreatureKind, CreatureMeta> = {
  // 赤铜（素材：大龙.svg）
  dragon:    { label: '龙类',     face: '#A2542F', edge: '#6E3419', edgeDark: '#421D0E', rim: '#E8A87A', void: '#231008', glow: '#FF6A3D' },
  // 青铜苔绿（素材：小龙.svg）
  wyvern:    { label: '飞龙',     face: '#4F7A52', edge: '#2E4A31', edgeDark: '#16281A', rim: '#9ECFA2', void: '#0E1A10', glow: '#6CE07A' },
  // 炽红（素材：恶魔.svg，细节层沿用素材原色）
  demon:     { label: '恶魔',     face: '#D44040', edge: '#8E2222', edgeDark: '#4A0D0D', rim: '#FF8A76', void: '#2A0808', glow: '#FF4D3D' },
  // 骨质青灰
  undead:    { label: '亡灵',     face: '#8E9EA3', edge: '#57676C', edgeDark: '#2A3639', rim: '#CBD8DB', void: '#10181A', glow: '#4FD1A5' },
  // 幽紫（仙灵/精灵族类；哥布林等地表野怪归 humanoid）
  fey:       { label: '精灵',     face: '#6E5AC8', edge: '#42347F', edgeDark: '#221A4E', rim: '#AFA0F5', void: '#150F33', glow: '#9C6BFF' },
  // 血红
  cultist:   { label: '邪神信徒', face: '#8B2237', edge: '#561323', edgeDark: '#2B0912', rim: '#D0607A', void: '#180309', glow: '#FF2D4D' },
  // 褐铜
  beast:     { label: '野兽',     face: '#7C5A36', edge: '#4C351D', edgeDark: '#261A0D', rim: '#C09A66', void: '#1A1108', glow: '#E08A3C' },
  // 钢蓝
  construct: { label: '构装',     face: '#4C6E88', edge: '#2D4453', edgeDark: '#15222B', rim: '#9CC0DA', void: '#0C1418', glow: '#55B6F0' },
  // 铁灰
  humanoid:  { label: '类人',     face: '#77808C', edge: '#454D57', edgeDark: '#232830', rim: '#B9C2CC', void: '#12161B', glow: '#D8E2EC' },
  // 未知（尖牙利口）
  generic:   { label: '未知族类', face: '#6B6259', edge: '#413B35', edgeDark: '#221E1A', rim: '#A79C8E', void: '#171310', glow: '#C9B79C' },
};

/** 阵亡棋子统一灰调（保留形体，褪去族类色） */
export const DEAD_CREATURE_META: CreatureMeta = {
  label: '阵亡', face: '#8A8986', edge: '#5F5E5B', edgeDark: '#3A3937',
  rim: '#B6B5B1', void: '#26251F', glow: '#8A8986',
};

/** 面板可选的族类清单（不含 generic 兜底） */
export const CREATURE_ORDER: CreatureKind[] = [
  'dragon', 'wyvern', 'demon', 'undead', 'fey', 'cultist', 'beast', 'construct', 'humanoid',
];

/**
 * 名字关键词表（按顺序匹配，先命中先返回）
 * 放在前面的族类拥有更强的判定特征，例如「兽人」应归类人而非野兽。
 */
const CREATURE_KEYWORDS: Array<[CreatureKind, RegExp]> = [
  ['wyvern',    /双足飞龙|翼龙|飞龙|wyvern/i],
  ['dragon',    /龙|竜|dragon|drake|wurm/i],
  ['undead',    /骷髅|骸骨|枯骨|骨|僵尸|丧尸|尸|幽灵|幽魂|亡魂|亡灵|亡|鬼魂|鬼怪|恶鬼|厉鬼|幽鬼|巫妖|吸血鬼|木乃伊|skeleton|zombie|ghost|lich|wight|vampire|mummy|ghoul|wraith|undead|specter|revenant/i],
  ['demon',     /恶魔|魔鬼|邪魔|妖魔|炼魔|魔裔|demon|devil|fiend|balor|glabrezu|hezrou/i],
  ['construct', /构装|魔像|石像|傀儡|机械|机甲|雕像|元素|golem|construct|automaton|elemental|mech|gargoyle/i],
  ['humanoid',  /强盗|盗贼|土匪|山贼|士兵|卫兵|骑士|战士|佣兵|雇佣|暴徒|兽人|半兽人|巨魔|食人魔|哥布林|地精|狗头人|小鬼|bandit|thief|soldier|guard|knight|warrior|mercenary|captain|orc|ogre|troll|goblin|hobgoblin|kobold|\bimp\b/i],
  ['fey',       /小妖精|仙灵|仙子|妖精|精怪|花精|树精|sprite|pixie|fey|hag|boggle/i],
  ['cultist',   /信徒|邪教|教团|祭司|牧师|术士|巫师|法师|萨满|死灵|邪神|巫妖|巫|cultist|cult|priest|cleric|wizard|sorcer|shaman|necromancer|warlock|mage|acolyte/i],
  ['beast',     /狼|熊|狮|虎|豹|犬|蛇|蛛|蝎|鲨|鸦|鹰|马|牛|猪|羊|兽|虫|蝠|bat|wolf|bear|lion|tiger|leopard|snake|spider|scorpion|shark|raven|eagle|horse|beast|dire/i],
];

/** 解析族类：明示优先，其次名字关键词，最后兜底 generic */
export function resolveCreatureKind(
  explicit: CreatureKind | undefined,
  name: string,
): CreatureKind {
  if (explicit && CREATURE_META[explicit]) return explicit;
  for (const [kind, re] of CREATURE_KEYWORDS) {
    if (re.test(name)) return kind;
  }
  return 'generic';
}