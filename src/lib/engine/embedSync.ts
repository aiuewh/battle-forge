/**
 * 嵌入同步层：多面板共存时的领导者选举 + 消息哈希链
 *
 * 酒馆里最近 4 条消息（maxDepth=3）可能各挂一个 Battle Forge 面板 iframe，
 * 它们共享同一 localStorage。若每个面板都跑 AI 驱动器、都应用自己的数据岛导入，
 * 会产生：① AI 一回合被执行多次；② 旧楼层 iframe 后加载时用过期数据覆盖新状态。
 *
 * 方案：
 * - 领导者选举：所有面板实例把自己的 {id, depth, 心跳时间} 写入共享注册表，
 *   深度最小（最新楼层）者为领导者；只有领导者执行 AI 驱动与应用数据导入。
 * - 哈希链：importDmMessage 的原始文本哈希入链，重复导入（刷新/重挂载）自动跳过；
 *   初始竞态窗口内只允许更小深度的导入覆盖更大深度。
 */

/** FNV-1a 32 位哈希（足够区分相邻消息，碰撞概率可忽略） */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ============ 领导者选举 ============

const PANELS_KEY = 'bf-embed-panels';
const HEARTBEAT_MS = 1200;
const EXPIRE_MS = 4000;

export interface PanelEntry {
  id: string;
  /** 楼层深度（0=最新）；独立模式=0 */
  depth: number | null;
  at: number;
}

interface PanelsReg {
  [id: string]: PanelEntry;
}

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* 沙箱无存储时静默 */ }
}

function readReg(): PanelsReg {
  const reg = safeGet<PanelsReg>(PANELS_KEY, {});
  const now = Date.now();
  const out: PanelsReg = {};
  for (const [id, e] of Object.entries(reg)) {
    if (e && typeof e.at === 'number' && now - e.at < EXPIRE_MS) out[id] = e;
  }
  return out;
}

/** 面板实例：注册心跳 + 领导者状态订阅 */
export class EmbedPanel {
  readonly id: string;
  private depth: number | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(isLeader: boolean) => void>();
  private _isLeader = false;

  constructor(depth: number | null) {
    this.id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    this.depth = depth;
  }

  get isLeader(): boolean {
    return this._isLeader;
  }

  private beat(): void {
    const reg = readReg();
    reg[this.id] = { id: this.id, depth: this.depth, at: Date.now() };
    safeSet(PANELS_KEY, reg);
    const entries = Object.values(reg).sort((a, b) => {
      const da = a.depth ?? 999;
      const db = b.depth ?? 999;
      if (da !== db) return da - db;
      return a.at - b.at;
    });
    const next = entries.length > 0 && entries[0].id === this.id;
    if (next !== this._isLeader) {
      this._isLeader = next;
      for (const fn of this.listeners) fn(next);
    }
  }

  start(): void {
    if (this.timer) return;
    this.beat();
    this.timer = setInterval(() => this.beat(), HEARTBEAT_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      const reg = readReg();
      delete reg[this.id];
      safeSet(PANELS_KEY, reg);
    } catch { /* noop */ }
  }

  /** 更新楼层深度（bootstrap 探测成功后回填） */
  setDepth(depth: number | null): void {
    this.depth = depth;
  }

  onLeaderChange(fn: (isLeader: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

// ============ 哈希链导入门控 ============

export interface HashChainState {
  /** 已应用的导入哈希（最近 64 条） */
  appliedHashes: string[];
  /** 最近一次应用的导入（深度用于初始竞态排序） */
  lastImport: { hash: string; depth: number | null } | null;
}

export function emptyChain(): HashChainState {
  return { appliedHashes: [], lastImport: null };
}

export function chainContains(chain: HashChainState, hash: string): boolean {
  return chain.appliedHashes.includes(hash);
}

export function appendChain(chain: HashChainState, hash: string, depth: number | null): HashChainState {
  const hashes = [...chain.appliedHashes, hash].slice(-64);
  return { appliedHashes: hashes, lastImport: { hash, depth } };
}

/**
 * 是否应当应用一次嵌入导入（幂等 + 竞态安全）
 * - 哈希已在链中 → 跳过（刷新/重挂载的重复导入）
 * - 深度门控无条件生效：新哈希仅当深度 ≤ 上次深度（新消息总在深度 0 到达）时应用；
 *   深度未知（null，沙箱探测失败环境）按 0 参与排序，避免新消息被饿死。
 *   旧楼层 iframe 持有的过期 payload（深度更深）永不覆写领导者状态。
 */
export function shouldApplyImport(
  chain: HashChainState,
  hash: string,
  depth: number | null,
): { apply: boolean; reason: 'duplicate' | 'stale-depth' | 'ok' } {
  if (chainContains(chain, hash)) return { apply: false, reason: 'duplicate' };
  const last = chain.lastImport;
  if (last) {
    if (last.hash === '') return { apply: true, reason: 'ok' };
    const dNew = depth ?? 0; // 未知深度视为最新候选（探测降级环境不被饿死）
    const dOld = last.depth ?? 0;
    if (dNew > dOld) return { apply: false, reason: 'stale-depth' };
    return { apply: true, reason: 'ok' };
  }
  return { apply: true, reason: 'ok' };
}
