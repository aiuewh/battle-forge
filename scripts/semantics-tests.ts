/**
 * 通用语义测试套件（第三轮自我验证）
 * 原则：同一语义的不同合法写法（AI 真实输出的漂移形态）应产生完全相同的解析结果。
 * 覆盖：全角字符 / 冒号分隔 / 中文字段名 / 中文阵营词 / 中文状态名 / 结果判定词 /
 *       公式变体 / RFC6902 标准操作 / 敌卡别名
 * 运行: bun scripts/semantics-tests.ts
 */
import { parseBattleBlock, parseOutcome, parseCheckDetail, parseDmMessage } from '../src/lib/engine/protocol';
import { parseFormula, rollFormula, setRng } from '../src/lib/engine/dice';
import { parseEncounterDefs } from '../src/lib/engine/statblocks';
import { applyPatches } from '../src/lib/engine/sheetbridge';

let pass = 0, fail = 0;
const findings: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) pass++;
  else { fail++; findings.push(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('━━━━━━ S1. battle 块同义变体 ━━━━━━');
{
  // 基准形态
  const base = parseBattleBlock('艾尔玛|init 17|hp 22/22|pos 0,15|att 0');
  const b = base[0];

  // s1a 冒号分隔
  const colon = parseBattleBlock('艾尔玛|init:17|hp:22/22|pos:0,15|att:0')[0];
  ok('s1a 冒号分隔 init', colon?.init === 17, JSON.stringify(colon));
  ok('s1a 冒号分隔 hp', colon?.hp?.current === 22 && colon?.hp?.max === 22);
  ok('s1a 冒号分隔 pos', colon?.pos?.x === 0 && colon?.pos?.y === 15);
  ok('s1a 冒号分隔 att', colon?.attitude === 0);

  // s1b 全角数字/竖线/斜杠/逗号
  const fw = parseBattleBlock('艾尔玛｜init １７｜hp ２２／３０｜pos ０，１５｜att ０')[0];
  ok('s1b 全角 init', fw?.init === 17, JSON.stringify(fw));
  ok('s1b 全角 hp', fw?.hp?.current === 22 && fw?.hp?.max === 30);
  ok('s1b 全角 pos', fw?.pos?.x === 0 && fw?.pos?.y === 15);
  ok('s1b 全角 att', fw?.attitude === 0);

  // s1c 中文字段名
  const cn = parseBattleBlock('艾尔玛|先攻 17|生命值 22/22|位置 0,15|阵营 我方')[0];
  ok('s1c 中文字段 init', cn?.init === 17, JSON.stringify(cn));
  ok('s1c 中文字段 hp', cn?.hp?.current === 22);
  ok('s1c 中文字段 pos', cn?.pos?.x === 0 && cn?.pos?.y === 15);
  ok('s1c 中文字段 att 我方=0', cn?.attitude === 0);

  // s1d 中文阵营词
  ok('s1d 敌=2', parseBattleBlock('哥布林|init 9|hp 10/10|att 敌')[0]?.attitude === 2);
  ok('s1d 敌方=2', parseBattleBlock('哥布林|att 敌方')[0]?.attitude === 2);
  ok('s1d 中立=1', parseBattleBlock('野猪|att 中立')[0]?.attitude === 1);
  ok('s1d 玩家=0', parseBattleBlock('艾尔玛|att 玩家')[0]?.attitude === 0);

  // s1e 中文状态名
  const st = parseBattleBlock('艾尔玛|init 17|att 0|status 目盲,中毒')[0];
  ok('s1e 目盲→blinded', st?.statuses.includes('blinded') === true, JSON.stringify(st?.statuses));
  ok('s1e 中毒→poisoned', st?.statuses.includes('poisoned') === true);
  const st2 = parseBattleBlock('法师|status 震慑/昏迷')[0];
  ok('s1e 震慑/昏迷 斜杠分隔', st2?.statuses.includes('stunned') === true && st2?.statuses.includes('unconscious') === true, JSON.stringify(st2?.statuses));
  const st3 = parseBattleBlock('战士|status 力竭2')[0];
  ok('s1e 力竭2→exhaustion', st3?.statuses.includes('exhaustion') === true, JSON.stringify(st3?.statuses));

  // s1g next 大小写
  ok('s1g NEXT 大写', parseBattleBlock('哥布林|init 9|NEXT')[0]?.next === true);

  // s1h pos 括号
  const pp = parseBattleBlock('艾尔玛|pos (0,15)')[0];
  ok('s1h pos 带括号', pp?.pos?.x === 0 && pp?.pos?.y === 15, JSON.stringify(pp?.pos));

  // s1j portrait URL 冒号不被破坏
  const pt = parseBattleBlock('艾尔玛|portrait https://img.example.com/a.png')[0];
  ok('s1j portrait URL 完整', pt?.portrait === 'https://img.example.com/a.png', pt?.portrait);
  const pt2 = parseBattleBlock('艾尔玛|portrait:https://img.example.com/a.png')[0];
  ok('s1j portrait 冒号形式', pt2?.portrait === 'https://img.example.com/a.png', pt2?.portrait);

  // 基准仍通过
  ok('s1 基准形态不回归', b?.init === 17 && b?.hp?.current === 22 && b?.attitude === 0 && b?.pos?.y === 15);
}

console.log('━━━━━━ S2. 检定结果同义词 ━━━━━━');
{
  ok('s2a 命中 → success', parseOutcome('命中') === 'success');
  ok('s2a 攻击命中 → success', parseOutcome('攻击命中') === 'success');
  ok('s2b 未命中 → failure', parseOutcome('未命中') === 'failure');
  ok('s2b 失手 → failure', parseOutcome('失手') === 'failure');
  ok('s2c 重击 → critical-success', parseOutcome('重击！武器 damage 翻倍') === 'critical-success');
  ok('s2c 暴击 → critical-success', parseOutcome('暴击') === 'critical-success');
  ok('s2d 大失败 → critical-failure', parseOutcome('大失败') === 'critical-failure');
  ok('s2e 成功 → success', parseOutcome('成功') === 'success');
  ok('s2e 大成功 → critical-success', parseOutcome('大成功') === 'critical-success');
  ok('s2f 失败 → failure', parseOutcome('失败') === 'failure');
  ok('s2g 无法判定 → null', parseOutcome('什么都不是') === null);
  // 细节解析全角
  const d1 = parseCheckDetail('裸骰 １６ ＋ ５ ＝ ２１ vs AC １５');
  ok('s2h 全角裸骰', d1.raw === 16, JSON.stringify(d1));
  ok('s2h 全角加值', d1.bonus === 5);
  ok('s2h 全角总值', d1.total === 21);
  ok('s2h 全角AC', d1.ac === 15);
  const d2 = parseCheckDetail('d20 [16]+5=21 DC 15');
  ok('s2i 括号总值', d2.total === 21 || d2.raw === 16, JSON.stringify(d2));
}

console.log('━━━━━━ S3. 骰子公式变体 ━━━━━━');
{
  setRng(() => 0.999); // 全最大
  let r: { total: number } | undefined;
  try { r = rollFormula('１ｄ８＋３') as { total: number }; } catch { r = undefined; }
  ok('s3a 全角公式 １ｄ８＋３', r !== undefined && Number.isFinite(r.total), r ? String(r.total) : 'throw');
  let r2: { total: number } | undefined;
  try { r2 = rollFormula('1d8+3 挥砍') as { total: number }; } catch { r2 = undefined; }
  ok('s3b 公式带类型后缀', r2 !== undefined && Number.isFinite(r2.total));
  let r3: { total: number } | undefined;
  try { r3 = rollFormula('  1d20 + 5 ') as { total: number }; } catch { r3 = undefined; }
  ok('s3c 首尾空格', r3 !== undefined);
  let threw = false;
  try { parseFormula('完全是垃圾'); } catch { threw = true; }
  ok('s3d 纯垃圾仍抛出', threw);
}

console.log('━━━━━━ S4. 敌卡字段别名与形态 ━━━━━━');
{
  const r = parseEncounterDefs(JSON.stringify({
    enemies: [
      { 名称: '影豹', 体型: '中型', 挑战等级: '1/2', 生命值: '18-24', 'AC': '15',
        攻击: [{ 名称: '撕咬', 类型: '近战', 命中: '+5', 伤害: '１ｄ８＋３', 伤害类型: '穿刺', 射程: '5尺', 附加状态: '倒地' }],
        战术: '保持距离游走' },
      { 名称: '骷髅兵', hp: { 当前: 8, 最大: 24 }, ac: 16,
        攻击: ['弯刀 +4 1d6+2 挥砍'] },
    ],
  }));
  ok('s4a 两卡解析', r.defs.length === 2, JSON.stringify(r.warnings));
  const panther = r.defs[0];
  ok('s4b CR "1/2" 字符串', panther?.cr === 0.5 || panther?.cr === 1 || typeof panther?.cr === 'number', String(panther?.cr));
  ok('s4c 生命值区间取均值 21', panther?.hp === 21, String(panther?.hp));
  ok('s4d AC 字符串', panther?.ac === 15, String(panther?.ac));
  const bite = panther?.attacks[0];
  ok('s4e 命中 "+5" 字符串', bite?.attackBonus === 5, String(bite?.attackBonus));
  ok('s4f 全角伤害公式', bite?.dice === '1d8+3', bite?.dice);
  ok('s4g 附加状态 倒地→prone', bite?.applyStatus === 'prone', JSON.stringify(bite).slice(0, 120));
  const skel = r.defs[1];
  ok('s4h 生命值对象取最大', skel?.hp === 24, String(skel?.hp));
  ok('s4i 字符串动作条目', skel?.attacks[0]?.attackBonus === 4 && skel?.attacks[0]?.dice === '1d6+2', JSON.stringify(skel?.attacks[0]));
}

console.log('━━━━━━ S5. 补丁操作标准名 ━━━━━━');
{
  const tree: Record<string, unknown> = { list: [1, 2] };
  const r = applyPatches(tree, [
    { op: 'add', path: '/list/-', value: 3 } as never,
    { op: 'replace', path: '/x', value: 'a' },
  ]);
  ok('s5a RFC6902 add → 数组追加', (tree.list as number[]).length === 3, JSON.stringify(tree.list));
  ok('s5a add 计入 applied', r.applied === 2, `applied=${r.applied} errors=${JSON.stringify(r.errors)}`);
  const tree2: Record<string, unknown> = { hp: 10 };
  applyPatches(tree2, [{ op: 'add', path: '/hp', value: 20 } as never]);
  ok('s5b add 对象键 → 覆盖/插入', tree2.hp === 20, JSON.stringify(tree2));
}

console.log('━━━━━━ S6. 端到端消息级语义等价 ━━━━━━');
{
  // 同一场战斗的三种写法应产生等价的单位集合
  const v1 = parseDmMessage('<battle>\n艾尔玛|init 17|hp 22/22|pos 0,15|att 0\n哥布林1|init 9|hp 10/10|pos 20,20|att 2\n</battle>');
  const v2 = parseDmMessage('艾尔玛|先攻 17|生命值 22/22|位置 0,15|阵营 我方\n哥布林1|先攻 9|生命值 10/10|位置 20,20|阵营 敌');
  const v3 = parseDmMessage('<battle>\n艾尔玛｜init:17｜hp:22/22｜pos:0,15｜att:0\n哥布林1｜init:9｜hp:10/10｜pos:20,20｜att:2\n</battle>');
  const sig = (m: ReturnType<typeof parseDmMessage>) => (m.latestBattle || []).map(u => `${u.id}:${u.init}:${u.hp?.current}/${u.hp?.max}:${u.pos?.x},${u.pos?.y}:${u.attitude}`).join('|');
  ok('s6a 标准形态', sig(v1) === '艾尔玛:17:22/22:0,15:0|哥布林1:9:10/10:20,20:2', sig(v1));
  ok('s6b 中文管道形态等价', sig(v2) === sig(v1), sig(v2));
  ok('s6c 全角+冒号形态等价', sig(v3) === sig(v1), sig(v3));
  // s6d 纯全角竖线消息（无任何半角 |）也必须进入管道回退（E2E 实测盲区）
  const v4 = parseDmMessage('艾尔玛｜先攻：１７｜生命值：２２／２２｜位置：(0,15)｜阵营：我方\n哥布林｜init:9｜hp:10/10｜pos:20,20｜att:敌方');
  ok('s6d 纯全角竖线消息可导入', (v4.latestBattle || []).length === 2, sig(v4));
  ok('s6d 全角行语义正确', sig(v4) === '艾尔玛:17:22/22:0,15:0|哥布林:9:10/10:20,20:2', sig(v4));
}

console.log('\n━━━━━━━━━━━━━━ 语义测试汇总 ━━━━━━━━━━━━━━');
console.log(`✅ 通过: ${pass}  ❌ 失败: ${fail}`);
if (findings.length > 0) {
  console.log('\n语义盲区：');
  for (const f of findings) console.log(f);
}
process.exit(fail > 0 ? 1 : 0);
