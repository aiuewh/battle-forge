'use client';

/**
 * D&D 2024 战斗引擎 · Battle Forge
 * 独立模式：完整仪表盘（地图 + 先攻 + 引擎工具）
 * 嵌入模式（?embed=1）：紧凑战斗面板（酒馆 iframe 嵌入）
 */
import React, { useEffect, Suspense } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { BattleWorkspace } from '@/components/battle/BattleWorkspace';
import { AiDriver } from '@/components/battle/AiDriver';
import { MonsterPicker } from '@/components/battle/MonsterPicker';
import { ImportPanel } from '@/components/battle/ImportExportPanel';
import { EncounterBriefing } from '@/components/battle/EncounterBriefing';
import { useEmbedBridge, useAppRuntime, isEmbedded } from '@/components/battle/EmbedBridge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Swords, Dices, Users, ClipboardPaste, Share2, Settings2, Trash2, Zap,
  BookOpenText, Github, Map as MapIcon, Play, UserCog, Skull, Eye,
} from 'lucide-react';

const subscribeNoop = () => () => { /* 不订阅：仅用于水合检测 */ };

function BattleForgeInner() {
  const store = useBattleStore();
  // 水合检测（服务端 false → 客户端 true，无 setState）
  const hydrated = React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  // 挂载后：嵌入检测 + 恢复本地存档（外部系统同步，安全）
  useEffect(() => {
    const embedded = isEmbedded();
    const s = useBattleStore.getState();
    s.setEmbedMode(embedded);
    s.load();
  }, []);

  // 多面板运行时：领导者选举（AI 驱动与存储写入仅限领导者；其余为同步视图）
  const runtime = useAppRuntime(store.embedMode);
  // Register the panel before announcing readiness to the host.
  useEmbedBridge(store.embedMode);

  // AI 回合驱动器（独立/嵌入两模式共用，仅领导者驱动）
  const embed = store.embedMode;
  const driver = <AiDriver leader={runtime.isLeader} />;

  if (!hydrated) {
    return (
      <div className="dnd-theme flex min-h-screen items-center justify-center">
        <div className="font-display animate-pulse text-lg gold-text">⚔ 正在点燃火把…</div>
      </div>
    );
  }

  // Embedded and standalone battles share the same canvas/HUD workspace.
  if (embed) return <div className="dnd-theme battle-embed-shell"><EncounterBriefing compact /><BattleWorkspace compact />{driver}</div>;

  // ============ 独立模式（完整仪表盘） ============
  return (
    <div className="dnd-theme flex min-h-screen flex-col">
      {/* 头部 */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-black/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" />
            <h1 className="font-display text-base font-bold gold-text md:text-lg">Battle Forge</h1>
            <span className="hidden text-[11px] text-muted-foreground md:inline">D&D 2024 战斗引擎</span>
          </div>
          <input
            className="w-36 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm text-foreground/90 hover:border-border/50 focus:border-primary/50 focus:outline-none md:w-48"
            value={store.battleName}
            onChange={e => store.setBattleName(e.target.value)}
            title="战斗名称"
          />
          <div className="grow" />
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full border border-border/50 bg-black/30 px-2 py-0.5">
              {store.units.length} 单位
            </span>
            <span className="rounded-full border border-border/50 bg-black/30 px-2 py-0.5">
              {store.battleActive ? `第 ${store.turn.round} 轮` : '待战'}
            </span>
            <button
              className="flex items-center gap-1 rounded-full border border-border/50 px-2 py-0.5 transition-colors hover:border-primary/60 hover:text-primary"
              onClick={() => { if (confirm('清空当前战斗并重新开始？')) { store.reset(); } }}
              title="新战斗"
            >
              <Trash2 className="h-3 w-3" />新战斗
            </button>
          </div>
        </div>
      </header>

      {/* 主体 */}
      <main className="mx-auto w-full max-w-7xl grow px-3 py-4 md:px-4">
        {store.units.length === 0 ? (
          /* 空状态欢迎页 */
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 py-8">
            <div className="text-center">
              <div className="font-display text-4xl font-black gold-text md:text-5xl">⚔ Battle Forge</div>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                D&D 2024 战术战斗前端 —— 2.5D 等距地图 · 先攻引擎 · 完整规则结算 · 敌我 AI 行动逻辑 · 酒馆协议互通。
                粘贴 DM 输出的 <code className="rounded bg-black/40 px-1 text-primary">&lt;battle&gt;</code> 数据即刻开战，或一键载入演示遭遇。
              </p>
              <div className="mt-4">
                <Button
                  className="gap-2 bg-primary text-primary-foreground hover:bg-primary/85"
                  onClick={() => store.loadDemoBattle()}
                >
                  <Play className="h-4 w-4" />载入演示遭遇：哥布林营地突袭
                </Button>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  2.5D 地图（绿球=友方 · 红四棱锥=敌方 · 灰立方=掩体）+ 完整 AI 行动逻辑：
                  牧师/法师默认 AI 托管（治疗优先/AoE 无友伤），可随时切换玩家操控；敌方按战术档案行动（游击拉扯/远程拉距/残暴冲锋/低血士气检定）。
                </p>
              </div>
            </div>
            <div className="grid w-full max-w-3xl gap-3 md:grid-cols-2">
              {/* 战前敌情简报（有暂存敌卡且未开战时显示） */}
              {store.stagedStatblocks.length > 0 && (
                <div className="md:col-span-2">
                  <EncounterBriefing />
                </div>
              )}
              <div className="rounded-xl parchment-panel-strong p-4">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-primary">
                  <ClipboardPaste className="h-4 w-4" />从酒馆导入
                </div>
                <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                  把 AI DM 回复中的 <code className="text-primary">&lt;battle&gt;</code> 块整段粘贴进来，
                  自动解析单位、先攻、位置与状态。
                </p>
                <ImportPanel />
              </div>
              <div className="rounded-xl parchment-panel-strong p-4">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-primary">
                  <Users className="h-4 w-4" />手动开团
                </div>
                <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                  从怪物预设库添加敌人（2024 怪物图鉴常用条目），自动计算遭遇难度预算。
                </p>
                <MonsterPicker />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <BookOpenText className="h-3.5 w-3.5" />
              内置规则：优势/劣势 · 重击（2024仅武器骰）· 抗性/易伤/免疫 · 死亡豁免 · 专注豁免 · 掩护 · 擒抱逃脱 DC · 巢穴/传奇动作
            </div>
          </div>
        ) : (
          <BattleWorkspace />
        )}
      </main>

      {/* 页脚 */}
      <footer className="mt-auto border-t border-border/40 bg-black/50 py-3">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><Github className="h-3 w-3" />可部署至 GitHub Pages，作为酒馆战斗面板外挂</span>
          <span>数据自动保存在浏览器本地</span>
          <span className="text-primary/70">Battle Forge · D&D 2024</span>
        </div>
      </footer>
      {driver}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={
      <div className="dnd-theme flex min-h-screen items-center justify-center">
        <div className="font-display animate-pulse text-lg gold-text">⚔ 载入中…</div>
      </div>
    }>
      <BattleForgeInner />
    </Suspense>
  );
}
