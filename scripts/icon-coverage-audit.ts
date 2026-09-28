/**
 * 怪物库徽章覆盖审计：枚举 MONSTER_PRESETS，按「显式族类 → 名字关键词 → 兜底」
 * 解析族类，再按名字二级映射（哥布林/兽人），输出每类的徽章归属与覆盖状态。
 * 运行：npx tsx scripts/icon-coverage-audit.ts
 */
import { MONSTER_PRESETS } from '../src/lib/engine/presets';
import { resolveCreatureKind, CREATURE_META } from '../src/lib/engine/creatures';

const GOBLIN_NAME = /哥布林|地精|狗头人|小鬼|goblin|hobgoblin|kobold|\bimp\b/i;
const ORC_NAME = /兽人|半兽人|食人魔|巨魔|\borc\b|\borgre\b|\btroll\b/i;

/** emblem3d 已接管的全部族类（含二级映射 tier）——全部有 3D 徽章，无红四棱锥兜底 */
const ICON_KINDS = new Set([
  'dragon', 'wyvern', 'demon', 'undead', 'fey',
  'cultist', 'beast', 'construct', 'humanoid', 'generic',
  'goblin', 'orc',
]);

const rows = new Map<string, { icon: string; presets: string[] }>();
let uncovered = 0;

for (const p of MONSTER_PRESETS) {
  const kind = resolveCreatureKind(p.creatureType, p.name);
  let icon: string = kind;
  if (kind === 'humanoid') {
    if (GOBLIN_NAME.test(p.name)) icon = 'goblin';
    else if (ORC_NAME.test(p.name)) icon = 'orc';
  }
  const covered = ICON_KINDS.has(icon);
  if (!covered) uncovered++;
  const label = icon === 'goblin' ? '哥布林(野怪)' : icon === 'orc' ? '兽人(野怪)' : CREATURE_META[kind]?.label ?? kind;
  const row = rows.get(label) ?? { icon, presets: [] };
  row.presets.push(p.name + (covered ? '' : ' ⚠未覆盖'));
  rows.set(label, row);
}

console.log('怪物库徽章覆盖表（共 ' + MONSTER_PRESETS.length + ' 个预设）：');
for (const [label, r] of rows) {
  console.log('  ' + label.padEnd(10) + ' ← ' + r.presets.join('、'));
}
console.log(uncovered === 0
  ? '\n✅ 全部预设均落入已有 3D 徽章（无红四棱锥兜底残留）'
  : '\n⚠ ' + uncovered + ' 个预设未覆盖');
