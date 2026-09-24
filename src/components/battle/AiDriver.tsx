'use client';

/**
 * AI 回合驱动器 + 战斗控制条
 *
 * AiDriver（无 UI）：battleActive 且当前行动者为 AI 单位时，按 aiSpeed 节流
 * 循环执行 takeAiStep()（自调度：每步后重新计时，不依赖 React 重渲染）。
 * 玩家操控单位（含玩家本人、切换了操控的队友）回合自动暂停等待手动操作。
 * 多面板共存时仅领导者驱动（否则同一 AI 回合被执行多次）。
 *
 * BattleControls：AI 自动开关 / 速度档位 / 单步执行 / 当前回合横幅 / 战报导出。
 */
import React, { useEffect, useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { isAiControlled } from '@/lib/engine/ai';
import { AI_PROFILE_META } from '@/lib/engine/types';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { sendReportToHost } from '@/components/battle/EmbedBridge';
import { cn } from '@/lib/utils';
import { Bot, User, ChevronRight, Gauge, Pause, Play, ClipboardList, Check } from 'lucide-react';

export function AiDriver({ leader = true }: { leader?: boolean }) {
  const aiAutoPlay = useBattleStore(s => s.aiAutoPlay);
  const aiSpeed = useBattleStore(s => s.aiSpeed);
  const battleActive = useBattleStore(s => s.battleActive);
  const currentUnitId = useBattleStore(s => s.turn.currentUnitId);

  useEffect(() => {
    // 多面板共存：仅领导者驱动 AI，其余面板为同步视图（leader 由 page.tsx 从运行时传入）
    if (!leader) return;
    if (!aiAutoPlay || !battleActive || !currentUnitId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (cancelled) return;
      const st = useBattleStore.getState();
      if (!st.aiAutoPlay || !st.battleActive) return;
      const unit = st.units.find(u => u.id === st.turn.currentUnitId);
      if (!unit || !isAiControlled(unit)) return; // 等待玩家操控单位
      const more = st.takeAiStep();
      if (more && !cancelled) {
        timer = setTimeout(tick, st.aiSpeed);
      }
    };
    // 首步稍快（回合横幅已展示行动者）
    timer = setTimeout(tick, Math.min(300, aiSpeed));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [leader, aiAutoPlay, aiSpeed, battleActive, currentUnitId]);

  return null;
}

const SPEEDS = [
  { label: '慢', ms: 900 },
  { label: '标准', ms: 450 },
  { label: '快', ms: 220 },
  { label: '极速', ms: 80 },
];

export function BattleControls({ compact = false }: { compact?: boolean }) {
  const store = useBattleStore();
  const { battleActive, turn, units, aiAutoPlay, aiSpeed } = store;
  const current = units.find(u => u.id === turn.currentUnitId);
  const playerTurn = !!current && !isAiControlled(current);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);

  const copyReport = async () => {
    const text = store.generateBattleResult();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 嵌入沙箱无剪贴板权限时退化为弹窗手动复制
      const w = window.open('', '_blank', 'width=520,height=640');
      if (w) {
        w.document.write(`<title>战报 - 手动复制</title><pre style="white-space:pre-wrap;font:12px/1.6 monospace;padding:12px">${text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</pre>`);
        w.document.close();
      }
    }
  };

  /** 战报送回酒馆对话：嵌入模式经 postMessage 交给壳（/send + /trigger）；独立页面降级为复制 */
  const sendReport = () => {
    const text = store.generateBattleResult();
    if (sendReportToHost(text)) {
      setSent(true);
      setTimeout(() => setSent(false), 1800);
    } else {
      copyReport();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* 回合横幅 */}
      {battleActive && current && (
        <div className={cn(
          'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm',
          playerTurn
            ? 'border-amber-400/40 bg-amber-500/10'
            : 'border-red-400/30 bg-red-500/10',
        )}>
          <span className="rounded-md border border-border/50 bg-black/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            第 {turn.round} 轮
          </span>
          {playerTurn ? (
            <User className="h-4 w-4 text-amber-300" />
          ) : (
            <Bot className="h-4 w-4 text-red-300" />
          )}
          <span className="font-bold" style={{ color: current.isPlayer ? '#f5c542' : current.attitude === 2 ? '#ff8a75' : '#7fe0a0' }}>
            {current.name}
          </span>
          {current.aiProfile && (
            <span className="text-[11px] text-muted-foreground" title={AI_PROFILE_META[current.aiProfile]?.desc}>
              [{AI_PROFILE_META[current.aiProfile]?.label ?? current.aiProfile}]
            </span>
          )}
          {playerTurn ? (
            <span className="text-[11px] text-amber-200/80">
              轮到你了 —— 拖拽地图移动 · 右侧攻击面板结算 · 完成后「下一回合」
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">AI 行动中…</span>
          )}
          <div className="grow" />
          {playerTurn && (
            <Button size="sm" className="h-7 gap-1 bg-primary text-[11px] text-primary-foreground" onClick={() => store.nextTurn()}>
              结束回合 <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* AI 控制 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/40 bg-black/30 px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch checked={aiAutoPlay} onCheckedChange={v => store.setAiAutoPlay(v)} />
          <span className="flex items-center gap-1 font-medium">
            {aiAutoPlay ? <Play className="h-3.5 w-3.5 text-emerald-400" /> : <Pause className="h-3.5 w-3.5 text-amber-400" />}
            AI 自动行动
          </span>
        </label>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Gauge className="h-3.5 w-3.5" />
          {SPEEDS.map(sp => (
            <button
              key={sp.ms}
              onClick={() => store.setAiSpeed(sp.ms)}
              className={cn(
                'rounded-md border px-2 py-0.5 transition-colors',
                aiSpeed === sp.ms
                  ? 'border-primary bg-primary/90 text-primary-foreground'
                  : 'border-transparent hover:bg-white/10',
              )}
            >
              {sp.label}
            </button>
          ))}
        </div>
        <div className="grow" />
        {!aiAutoPlay && battleActive && current && !playerTurn && (
          <Button size="sm" variant="secondary" className="h-7 gap-1 text-[11px]" onClick={() => store.takeAiStep()}>
            <Bot className="h-3.5 w-3.5" />AI 单步
          </Button>
        )}
        <Button
          size="sm"
          className="h-7 gap-1 bg-amber-600/90 text-[11px] text-white hover:bg-amber-600"
          onClick={sendReport}
          disabled={units.length === 0}
          title="一键把 <battleresult> 战报送回酒馆对话并触发 DM 战后叙述（无法回传时自动降级为复制）"
        >
          {sent ? <Check className="h-3.5 w-3.5" /> : <ClipboardList className="h-3.5 w-3.5" />}
          {sent ? '已送回对话' : '战报送回对话'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1 text-[11px]"
          onClick={copyReport}
          disabled={units.length === 0}
          title="仅复制 <battleresult> 文本到剪贴板（手动粘贴的备选方式）"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardList className="h-3.5 w-3.5" />}
          {copied ? '已复制' : '复制战报'}
        </Button>
        {!compact && (
          <span className="text-[11px] text-muted-foreground">
            队友操控：单位详情卡 / 先攻条中切换 👤/🤖
          </span>
        )}
      </div>
    </div>
  );
}
