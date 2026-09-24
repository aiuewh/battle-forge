/**
 * 协议层：酒馆卡数据协议双向转换
 *  - <battle> 管道格式（解析 + 生成）
 *  - <battlecheck> / <dice> 检定块解析
 *  - <UpdateVariable> JSONPatch (delta/replace/insert/remove) 解析
 *  - <dices> 骰子池解析
 */

// ============ <battle> 解析 ============

export interface ParsedBattleUnit {
  id: string;
  init?: number;
  hp?: { current: number; max?: number };
  pos?: { x: number; y: number };
  statuses: string[];
  portrait?: string;
  attitude: 0 | 1 | 2;
  next: boolean;
  /** 被伏击/突袭标记（2024：先攻劣势；2014：首轮不能行动） */
  surprised?: boolean;
  /** 未知字段原样保留（重新生成时回写） */
  extras: Array<{ key: string; value: string }>;
}

const KNOWN_KEYS = new Set(['init', 'hp', 'pos', 'status', 'portrait', 'att', 'attitude', 'next', 'surprise']);
const VALID_STATUSES = new Set([
  'blinded', 'charmed', 'deafened', 'frightened', 'grappled',
  'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned',
  'prone', 'restrained', 'stunned', 'unconscious',
]);

// ============ 通用语义容错层（第三轮自我验证） ============

/** 全角→半角归一：AI 在中文 IME 环境常输出全角数字/标点（１７／２２｜：，） */
export function normalizeWidth(s: string): string {
  return s
    .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' '); // 全角空格
}

/** 字段名中英别名（AI 漂移形态） */
const FIELD_ALIASES: Record<string, string> = {
  '先攻': 'init', 'initiative': 'init',
  '生命值': 'hp', 'health': 'hp',
  '位置': 'pos', '坐标': 'pos', 'position': 'pos',
  '阵营': 'att', '态度': 'att',
  '状态': 'status',
  '头像': 'portrait', '肖像': 'portrait',
  '惊讶': 'surprise', '突袭': 'surprise', '被突袭': 'surprise', '伏击': 'surprise', 'surprised': 'surprise',
};

/** 真值词判定（surprise:1 / surprise:是 / surprise 字段裸标记） */
function isTruthy(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === '' || v === '1' || v === 'true' || v === 'yes' || v === '是' || v === '被' || v === 'y';
}

/** 阵营语义词 → 0友/1中/2敌 */
const ATTITUDE_WORDS: Record<string, 0 | 1 | 2> = {
  '0': 0, '1': 1, '2': 2,
  '友': 0, '友方': 0, '我方': 0, '己方': 0, '玩家': 0, '盟友': 0, '队伍': 0,
  'ally': 0, 'friend': 0, 'friendly': 0, 'player': 0,
  '中': 1, '中立': 1, 'neutral': 1,
  '敌': 2, '敌方': 2, '敌人': 2, '敌对': 2, '怪物': 2, '怪兽': 2,
  'enemy': 2, 'hostile': 2, 'foe': 2, 'monster': 2,
};

/** 状态中文名 → 引擎键 */
const STATUS_CN: Record<string, string> = {
  '目盲': 'blinded', '失明': 'blinded', '盲目': 'blinded',
  '魅惑': 'charmed', '迷惑': 'charmed',
  '耳聋': 'deafened', '失聪': 'deafened',
  '惊惧': 'frightened', '恐惧': 'frightened', '害怕': 'frightened',
  '擒抱': 'grappled', '抓抱': 'grappled',
  '失能': 'incapacitated',
  '隐形': 'invisible', '隐身': 'invisible',
  '麻痹': 'paralyzed', '瘫痪': 'paralyzed',
  '石化': 'petrified',
  '中毒': 'poisoned',
  '倒地': 'prone', '俯卧': 'prone',
  '束缚': 'restrained', '受缚': 'restrained',
  '震慑': 'stunned',
  '昏迷': 'unconscious', '失去意识': 'unconscious',
  '力竭': 'exhaustion', '枯竭': 'exhaustion',
};

/** 单条状态词解析（英文键 > 中文键 > exhaustion 前缀）；导出供敌卡层复用 */
export function resolveStatus(word: string): string | null {
  const k = word.toLowerCase();
  if (VALID_STATUSES.has(k)) return k;
  if (k.startsWith('exhaustion')) return 'exhaustion';
  if (/^exhaustion[\s-]*\d+$/.test(k)) return 'exhaustion';
  const cn = STATUS_CN[word] ?? STATUS_CN[k];
  if (cn) return cn;
  // 中文「力竭2/力竭-2」形态
  if (/^力竭[\s\-]?\d*$/.test(word)) return 'exhaustion';
  return null;
}

/** 解析 <battle> 块内容（不含标签） */
export function parseBattleBlock(raw: string): ParsedBattleUnit[] {
  const units: ParsedBattleUnit[] = [];
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  for (const lineRaw of lines) {
    // 全角归一：｜１７／：等 → 半角（AI 在中文输入法环境的高频漂移）
    const line = normalizeWidth(lineRaw);
    const parts = line.split('|').map(p => p.trim()).filter(p => p.length > 0);
    if (parts.length === 0) continue;
    const [idRaw, ...fields] = parts;
    if (!idRaw) continue; // 无 ID 行跳过
    // 标签残留清理：未闭合的 <battle>艾尔玛|… 会经管道回退路径进来，把标签拼进单位 ID
    const id = idRaw.replace(/^(?:<\/?[A-Za-z_][A-Za-z0-9_]*>\s*)+/, '').trim();
    if (!id) continue;
    // 无 ID 行防御：首词是已知字段名（如 "init 18" / "hp 24/30" 开头的行）不是单位
    const firstWord = id.split(/\s+/)[0].toLowerCase();
    if (KNOWN_KEYS.has(firstWord) || KNOWN_KEYS.has(FIELD_ALIASES[firstWord] ?? '')) continue;
    const unit: ParsedBattleUnit = {
      id, statuses: [], attitude: 1, next: false, extras: [],
    };
    for (const f of fields) {
      // 键值分割：空格分隔 > 冒号分隔（init:17 / init：17）；中文字段名归一（先攻→init）
      const sp = f.indexOf(' ');
      let key = (sp === -1 ? f : f.slice(0, sp)).toLowerCase();
      let value = sp === -1 ? '' : f.slice(sp + 1).trim();
      const ci = key.indexOf(':');
      if (ci !== -1) {
        value = [key.slice(ci + 1), value].filter(Boolean).join(' ');
        key = key.slice(0, ci);
      } else if (value.startsWith(':')) {
        value = value.slice(1).trim();
      }
      key = FIELD_ALIASES[key] ?? key;
      switch (key) {
        case 'init': {
          const n = parseInt(value, 10);
          if (!Number.isNaN(n)) unit.init = n;
          break;
        }
        case 'hp': {
          // 允许负当前 HP（奄奄一息/已死），但 max 必须为正——否则 hp -5/30 会把 max 也写成 -5
          const m = value.match(/^(-\d+|\d+)\s*\/\s*(\d+)$/);
          if (m) {
            const max = parseInt(m[2], 10);
            unit.hp = { current: parseInt(m[1], 10), max: max > 0 ? max : Math.abs(parseInt(m[1], 10)) || 1 };
          } else {
            // 区间字符串 "18-24"：取均值（与卡内协议承诺及敌卡侧解析一致）
            const rm = value.match(/^(\d+)\s*[-—~]\s*(\d+)$/);
            if (rm) {
              const avg = Math.round((parseInt(rm[1], 10) + parseInt(rm[2], 10)) / 2);
              unit.hp = { current: avg, max: Math.max(1, avg) };
            } else {
              const n = parseInt(value, 10);
              if (!Number.isNaN(n)) unit.hp = { current: n, max: Math.max(1, Math.abs(n)) };
            }
          }
          break;
        }
        case 'pos': {
          // 容忍括号形态 pos (0,15)（归一后已是半角括号）
          const v = value.replace(/^\((.*)\)$/, '$1').trim();
          const m = v.match(/^(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)$/);
          // 反 DoS：坐标钳制 ±10000 尺（2000 格；合法地图 ≤ ±500 尺，恶意 99999999 会让渲染层画千万格地面）
          if (m) unit.pos = {
            x: Math.max(-10000, Math.min(10000, parseFloat(m[1]))),
            y: Math.max(-10000, Math.min(10000, parseFloat(m[2]))),
          };
          break;
        }
        case 'status': {
          for (const s of value.split(/[,，\/\s]+/).filter(Boolean)) {
            const st = resolveStatus(s);
            if (st && !unit.statuses.includes(st)) unit.statuses.push(st);
          }
          break;
        }
        case 'portrait': {
          if (value) unit.portrait = value;
          break;
        }
        case 'att': case 'attitude': {
          const n = parseInt(value, 10);
          if (n >= 0 && n <= 2) unit.attitude = n as 0 | 1 | 2;
          else {
            // 语义词：敌/敌方/我方/玩家/中立/ally/hostile…
            const w = ATTITUDE_WORDS[value.toLowerCase()] ?? ATTITUDE_WORDS[value];
            if (w !== undefined) unit.attitude = w;
          }
          break;
        }
        case 'next': {
          unit.next = true;
          break;
        }
        case 'surprise': {
          // 2024 惊讶：被突袭者先攻劣势；容错 surprise / surprise:1 / 惊讶:是 形态
          unit.surprised = isTruthy(value);
          break;
        }
        default:
          unit.extras.push({ key, value });
      }
    }
    units.push(unit);
  }
  return units;
}

/** 从任意文本中提取全部 <battle> 块（取最后一个为最新状态）
 *  块体使用 tempered 扫描（不可穿越下一个 <battle> 开/闭形态）：
 *  ① 嵌套开标签（模型重复循环故障）不会把标签残留拼进单位 ID；
 *  ② 恶意大量无闭合开标签时每个起点在下一个标签处立即失败，保持线性复杂度 */
export function extractBattleBlocks(text: string): Array<{ raw: string; units: ParsedBattleUnit[] }> {
  const results: Array<{ raw: string; units: ParsedBattleUnit[] }> = [];
  const re = /<battle>((?:(?!<\/?battle[\s>])[\s\S])*?)<\/battle>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push({ raw: m[0], units: parseBattleBlock(m[1]) });
  }
  return results;
}

/** 生成 <battle> 块（从引擎单位状态） */
export function generateBattleBlock(
  units: Array<{
    id: string; init: number; hp: number; maxHp: number;
    pos: { x: number; y: number }; attitude: 0 | 1 | 2;
    statuses: string[]; portrait?: string; next?: boolean;
  }>,
): string {
  const lines = units.map(u => {
    const parts = [u.id];
    parts.push(`init ${u.init}`);
    parts.push(`hp ${u.hp}/${u.maxHp}`);
    parts.push(`pos ${Math.round(u.pos.x)},${Math.round(u.pos.y)}`);
    if (u.attitude !== 1) parts.push(`att ${u.attitude}`);
    if (u.statuses.length > 0) parts.push(`status ${u.statuses.filter(s => VALID_STATUSES.has(s)).join(',')}`);
    if (u.portrait) parts.push(`portrait ${u.portrait}`);
    if (u.next) parts.push('next');
    return parts.join('|');
  });
  return `<battle>\n${lines.join('\n')}\n</battle>`;
}

// ============ <battlecheck> / <dice> 解析 ============

export interface ParsedCheck {
  /** battlecheck | dice */
  kind: 'battlecheck' | 'dice';
  fields: Record<string, string>;
  raw: string;
}

const CHECK_FIELDS_BATTLE = ['发动者', '目标', '行动', '检定类型', '检定细节', '判定结果', '伤害结算'];
const CHECK_FIELDS_DICE = ['发动技能', '目标', '情境', '检定细节', '判定结果', '结果描述'];

function parseCheckBlock(raw: string, kind: 'battlecheck' | 'dice'): ParsedCheck | null {
  const fields: Record<string, string> = {};
  const fieldNames = kind === 'battlecheck' ? CHECK_FIELDS_BATTLE : CHECK_FIELDS_DICE;
  // 每个字段独立匹配到「下一个字段名或文本末尾」
  // 这样 AI 输出缺少中间字段时不会链式丢失前面的字段
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alt = fieldNames.map(esc).join('|');
  const re = new RegExp(`(?:^|\\n)\\s*(${alt})\\s*[:：]\\s*([\\s\\S]*?)(?=\\s*(?:\\n\\s*(?:${alt})\\s*[:：]|$))`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1];
    if (!(name in fields)) fields[name] = m[2].trim(); // 首次出现优先
  }
  return { kind, fields, raw };
}

/** 提取全部 <battlecheck> 块 */
export function extractBattleChecks(text: string): ParsedCheck[] {
  const out: ParsedCheck[] = [];
  const re = /<battlecheck>([\s\S]*?)<\/battlecheck>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const c = parseCheckBlock(m[1], 'battlecheck');
    if (c && Object.keys(c.fields).length > 0) out.push(c);
  }
  return out;
}

/** 提取全部 <dice> 块 */
export function extractDiceChecks(text: string): ParsedCheck[] {
  const out: ParsedCheck[] = [];
  const re = /<dice>([\s\S]*?)<\/dice>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const c = parseCheckBlock(m[1], 'dice');
    if (c && Object.keys(c.fields).length > 0) out.push(c);
  }
  return out;
}

/** 解析检定细节中的数值：裸骰、加值、总值、DC/AC（全角容错） */
export function parseCheckDetail(detail: string): {
  raw?: number; bonus?: number; total?: number; dc?: number; ac?: number;
} {
  const out: { raw?: number; bonus?: number; total?: number; dc?: number; ac?: number } = {};
  const d = normalizeWidth(detail);
  const raw = d.match(/裸骰[^\d]*(\d+)/) || d.match(/raw\s*(\d+)/i);
  if (raw) out.raw = parseInt(raw[1], 10);
  const bonus = d.match(/[+＋]\s*(\d+)/);
  if (bonus) out.bonus = parseInt(bonus[1], 10);
  const total = d.match(/(?:总值|总计)[^\d]*(\d+)/) || d.match(/=\s*(\d+)/) || d.match(/\[\s*(\d+)\s*\]/);
  if (total) out.total = parseInt(total[1], 10);
  const dc = d.match(/DC\s*(\d+)/i);
  if (dc) out.dc = parseInt(dc[1], 10);
  const ac = d.match(/AC\s*(\d+)/i);
  if (ac) out.ac = parseInt(ac[1], 10);
  return out;
}

/** 判定结果文字 → 结果类型（同义词扩展：命中/未命中/重击/暴击/失手/miss/hit） */
export function parseOutcome(text: string): 'critical-success' | 'success' | 'failure' | 'critical-failure' | null {
  const t = normalizeWidth(text);
  // 大成功类（先判，避免被「成功」提前命中）
  if (t.includes('大成功') || t.includes('重击') || t.includes('暴击') && !t.includes('失败') || /critical\s*success/i.test(t)) return 'critical-success';
  // 大失败类
  if (t.includes('大失败') || t.includes('暴击失败') || /critical\s*failure/i.test(t)) return 'critical-failure';
  // 未命中类（先于「命中」，因为包含「命中」二字）
  if (t.includes('未命中') || t.includes('失手') || t.includes('没有命中') || /\bmiss(ed|es)?\b/i.test(t)) return 'failure';
  // 成功类
  if (t.includes('命中') || t.includes('成功') || /\bsuccess\b|\bhit\b/i.test(t)) return 'success';
  // 失败类
  if (t.includes('失败') || /\bfailure\b|\bfail\b/i.test(t)) return 'failure';
  return null;
}

// ============ <UpdateVariable> JSONPatch 解析 ============

export interface ParsedPatch {
  op: 'replace' | 'delta' | 'insert' | 'remove' | 'move' | 'add' | 'delete';
  path: string;
  value?: unknown;
}

/** 提取全部 JSONPatch 操作（支持 delta 扩展操作） */
export function extractJsonPatches(text: string): ParsedPatch[] {
  const patches: ParsedPatch[] = [];
  // 匹配 <JSONPatch>...</JSONPatch> 或 <JSONPatch> 内的数组
  const blockRe = /<JSONPatch>([\s\S]*?)<\/JSONPatch>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    try {
      // 提取 JSON 数组（容错：截取第一个 [ 到最后一个 ]）
      const body = m[1];
      const start = body.indexOf('[');
      const end = body.lastIndexOf(']');
      if (start === -1 || end === -1) continue;
      const arr = JSON.parse(body.slice(start, end + 1));
      if (Array.isArray(arr)) {
        for (const p of arr) {
          if (p && typeof p.op === 'string' && typeof p.path === 'string') {
            patches.push({ op: p.op as ParsedPatch['op'], path: p.path, value: p.value });
          }
        }
      }
    } catch {
      // 忽略解析失败
    }
  }
  return patches;
}

/** 从补丁路径提取目标角色与字段：/角色列表/艾尔玛/生命值/当前 → {char:'艾尔玛', rest:['生命值','当前']} */
export function parsePatchPath(path: string): { char: string | null; rest: string[] } {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { char: null, rest: [] };
  if (parts[0] === '角色列表' && parts.length >= 2) {
    return { char: parts[1], rest: parts.slice(2) };
  }
  return { char: null, rest: parts };
}

// ============ <dices> 骰子池解析 ============

export interface DicePool {
  d20: number[];
  d4: number[];
  d6: number[];
  d8: number[];
  d10: number[];
  d12: number[];
}

/** 解析骰子池块（{{roll:1d20}} 已被酒馆替换为数字） */
export function parseDicePool(text: string): DicePool | null {
  const m = text.match(/<dices>([\s\S]*?)<\/dices>/i);
  if (!m) return null;
  const pool: DicePool = { d20: [], d4: [], d6: [], d8: [], d10: [], d12: [] };
  const body = m[1];
  // 匹配 d20： 或 [ 1: (15) | 2: (8) ] 或 {{roll:1d20}}
  const sectionRe = /d(20|4|6|8|10|12)\s*[：:]([\s\S]*?)(?=d(?:20|4|6|8|10|12)\s*[：:]|$)/gi;
  let sm: RegExpExecArray | null;
  while ((sm = sectionRe.exec(body)) !== null) {
    const sides = `d${sm[1]}` as keyof DicePool;
    const nums = sm[2].match(/\d+\s*[:：]?\s*[\((]\s*(\d+)\s*[\))]/g) ?? [];
    for (const entry of nums) {
      const vm = entry.match(/[\((]\s*(\d+)\s*[\))]/);
      if (vm) pool[sides].push(parseInt(vm[1], 10));
    }
    // 兼容 {{roll:1d20}} 未替换形态（无值则跳过）
  }
  return pool;
}

/** 生成 <dices> 骰子池文本（用于酒馆粘贴） */
export function generateDicePool(): string {
  const gen = (n: number, key: string) => {
    const rows: string[] = [];
    for (let i = 0; i < n; i += 4) {
      const items: string[] = [];
      for (let j = i + 1; j <= Math.min(i + 4, n); j++) {
        items.push(`${j}: ({{roll:1${key}}})`);
      }
      rows.push(`[ ${items.join(' | ')} ]`);
    }
    return rows.join('\n');
  };
  return `<dices>
d20：
${gen(20, 'd20')}
d6：
${gen(8, 'd6')}
d4：
${gen(8, 'd4')}
d8：
${gen(8, 'd8')}
d10：
${gen(8, 'd10')}
d12：
${gen(8, 'd12')}
</dices>`;
}

// ============ <encounter> / <statblock> 敌卡块提取 ============

/** 提取全部敌卡块原始文本（<encounter> 与 <statblock>，内容为 JSON） */
export function extractStatblockBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /<(encounter|statblock|monster)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[2].trim();
    if (body) out.push(body);
  }
  return out;
}

// ============ 消息级总解析 ============

export interface ParsedDmMessage {
  battleBlocks: Array<{ raw: string; units: ParsedBattleUnit[] }>;
  latestBattle: ParsedBattleUnit[] | null;
  checks: ParsedCheck[];
  patches: ParsedPatch[];
  dicePool: DicePool | null;
  /** <encounter>/<statblock> 敌卡块原始 JSON 文本 */
  statblockBlocks: string[];
}

/** 一键解析整条 DM 消息（支持含标签或纯管道行） */
export function parseDmMessage(text: string): ParsedDmMessage {
  let battleBlocks = extractBattleBlocks(text);
  // 容错：无标签但直接就是管道格式行（全角｜归一后检测，否则纯全角消息无法进入回退）
  if (battleBlocks.length === 0) {
    const norm = normalizeWidth(text);
    if (/^[^\s|][^|]*\|/m.test(norm)) {
      const units = parseBattleBlock(norm);
      if (units.length > 0) battleBlocks = [{ raw: text, units }];
    }
  }
  return {
    battleBlocks,
    latestBattle: battleBlocks.length > 0 ? battleBlocks[battleBlocks.length - 1].units : null,
    checks: [...extractBattleChecks(text), ...extractDiceChecks(text)],
    patches: extractJsonPatches(text),
    dicePool: parseDicePool(text),
    statblockBlocks: extractStatblockBlocks(text),
  };
}
