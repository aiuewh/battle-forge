'use client';

/**
 * D&D 2024 战斗引擎 · Battle Forge
 * 独立模式：完整仪表盘（地图 + 先攻 + 引擎工具）
 * 嵌入模式（?embed=1）：紧凑战斗面板（酒馆 iframe 嵌入）
 */
import React, { useEffect, useMemo, useState, Suspense } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { BattleMapIso } from '@/components/battle/BattleMapIso';
import { AiDriver, BattleControls } from '@/components/battle/AiDriver';
import { InitiativeBar } from '@/components/battle/InitiativeBar';
import { UnitDetailCard } from '@/components/battle/UnitDetailCard';
import { DiceRoller } from '@/components/battle/DiceRoller';
import { BattleLog } from '@/components/battle/BattleLog';
import { MonsterPicker } from '@/components/battle/MonsterPicker';
import { ImportPanel, ExportPanel } from '@/components/battle/ImportExportPanel';
import { AttackPanel } from '@/components/battle/AttackPanel';
import { SettingsPanel } from '@/components/battle/SettingsPanel';
import { ActionBar } from '@/components/battle/ActionBar';
import { RosterPanel } from '@/components/battle/RosterPanel';
import { EnemyDesigner } from '@/components/battle/EnemyDesigner';
import { EncounterBriefing } from '@/components/battle/EncounterBriefing';
import { useEmbedBridge, useAppRuntime, isEmbedded } from '@/components/battle/EmbedBridge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

  useEmbedBridge(store.embedMode);

  // 多面板运行时：领导者选举（AI 驱动与存储写入仅限领导者；其余为同步视图）
  const runtime = useAppRuntime(store.embedMode);

  // AI 回合驱动器（独立/嵌入两模式共用，仅领导者驱动）
  const embed = store.embedMode;
  const driver = <AiDriver leader={runtime.isLeader} />;

  // 非领导者同步视图徽标（多面板共存时提示操作入口在最新楼层面板）
  const followerBadge = runtime.ready && !runtime.isLeader ? (
    <div className="flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-[11px] text-sky-200">
      <Eye className="h-3.5 w-3.5" />
      同步视图 —— 本楼面板为只读镜像，战斗操作与 AI 驱动由最新楼层面板执行
    </div>
  ) : null;

  // 选中单位：用户点选 > 当前回合行动者
  const detailUnitId = store.selectedId ?? store.turn.currentUnitId;

  if (!hydrated) {
    return (
      <div className="dnd-theme flex min-h-screen items-center justify-center">
        <div className="font-display animate-pulse text-lg gold-text">⚔ 正在点燃火把…</div>
      </div>
    );
  }

  // ============ 嵌入模式 ============
  if (embed) {
    return (
      <div className="dnd-theme embed-compact p-2 md:p-3">
        <div className="flex flex-col gap-2.5">
          {/* 非领导者同步视图徽标 */}
          {followerBadge}
          {/* 战前敌情简报（暂存敌卡 + 未开战） */}
          <EncounterBriefing compact />
          {/* 顶部条 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-bold gold-text">⚔ 战斗面板</span>
            <span className="rounded-md border border-border/50 bg-black/30 px-2 py-0.5 text-[11px] text-muted-foreground">
              第 {store.turn.round} 轮 · {store.units.filter(u => u.attitude === 2 && !u.deathSaves?.dead).length} 敌
            </span>
            <div className="grow" />
            {store.battleActive && (
              <Button size="sm" className="h-7 gap-1 bg-primary text-[11px] text-primary-foreground" onClick={() => store.nextTurn()}>
                下一回合
              </Button>
            )}
          </div>
          {/* 地图 + 先攻 */}
          <div className="grid gap-2.5 md:grid-cols-[1fr_260px]">
            <div className="flex flex-col gap-2">
              <BattleControls />
              <div className="rounded-xl parchment-panel p-2.5">
                <ActionBar compact />
              </div>
              <BattleMapIso compact />
            </div>
            <div className="flex flex-col gap-2.5">
              <InitiativeBar compact />
              {detailUnitId && <UnitDetailCard unitId={detailUnitId} compact />}
            </div>
          </div>
        </div>
        {driver}
      </div>
    );
  }

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
          /* 战斗仪表盘 */
          <div className="flex flex-col gap-3">
            {followerBadge}
            <EncounterBriefing />
            <div className="grid gap-3 lg:grid-cols-[280px_1fr_300px]">
            {/* 左列：先攻 + 单位详情 */}
            <div className="flex flex-col gap-3 order-2 lg:order-1">
              <div className="rounded-xl parchment-panel p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <MapIcon className="h-3.5 w-3.5" />先攻条
                </div>
                <InitiativeBar />
              </div>
              <div className="hidden lg:block">
                <UnitDetailCard unitId={detailUnitId} />
              </div>
            </div>

            {/* 中列：控制条 + 行动栏 + 地图 + 日志 */}
            <div className="flex flex-col gap-3 order-1 lg:order-2">
              <BattleControls />
              <div className="rounded-xl parchment-panel p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <UserCog className="h-3.5 w-3.5" />行动栏
                </div>
                <ActionBar />
              </div>
              <BattleMapIso />
              <div className="rounded-xl parchment-panel p-3">
                <BattleLog />
              </div>
              <div className="lg:hidden">
                <UnitDetailCard unitId={detailUnitId} compact />
              </div>
            </div>

            {/* 右列：工具 Tabs */}
            <div className="order-3">
              <Tabs defaultValue="attack" className="flex flex-col gap-2">
                <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-lg bg-black/40 p-1">
                  <TabsTrigger value="attack" className="gap-1 py-1.5 text-[11px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <Zap className="h-3.5 w-3.5" />攻击
                  </TabsTrigger>
                  <TabsTrigger value="dice" className="gap-1 py-1.5 text-[11px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <Dices className="h-3.5 w-3.5" />骰子
                  </TabsTrigger>
                  <TabsTrigger value="add" className="gap-1 py-1.5 text-[11px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <Users className="h-3.5 w-3.5" />单位
                  </TabsTrigger>
                  <TabsTrigger value="roster" className="gap-1 py-1.5 text-[11px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <UserCog className="h-3.5 w-3.5" />角色
                  </TabsTrigger>
                  <TabsTrigger value="enemy" className="gap-1 py-1.5 text-[11px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <Skull className="h-3.5 w-3.5" />敌卡
                  </TabsTrigger>
                  <TabsTrigger value="io" className="gap-1 py-1.5 text-[11px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <Share2 className="h-3.5 w-3.5" />导入导出
                  </TabsTrigger>
                  <TabsTrigger value="settings" className="col-span-3 gap-1 py-1.5 text-[11px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <Settings2 className="h-3.5 w-3.5" />规则与设置
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="attack" className="mt-0">
                  <div className="rounded-xl parchment-panel p-3">
                    <AttackPanel defaultAttackerId={store.turn.currentUnitId} />
                  </div>
                </TabsContent>
                <TabsContent value="dice" className="mt-0">
                  <div className="rounded-xl parchment-panel p-3">
                    <DiceRoller />
                  </div>
                </TabsContent>
                <TabsContent value="add" className="mt-0">
                  <div className="rounded-xl parchment-panel p-3">
                    <MonsterPicker />
                  </div>
                </TabsContent>
                <TabsContent value="roster" className="mt-0">
                  <div className="rounded-xl parchment-panel p-3">
                    <RosterPanel />
                  </div>
                </TabsContent>
                <TabsContent value="enemy" className="mt-0">
                  <div className="rounded-xl parchment-panel p-3">
                    <EnemyDesigner />
                  </div>
                </TabsContent>
                <TabsContent value="io" className="mt-0">
                  <div className="flex flex-col gap-4 rounded-xl parchment-panel p-3">
                    <ImportPanel />
                    <ExportPanel />
                  </div>
                </TabsContent>
                <TabsContent value="settings" className="mt-0">
                  <div className="rounded-xl parchment-panel p-3">
                    <SettingsPanel />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
          </div>
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
