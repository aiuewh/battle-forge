'use client';

/**
 * 先攻条 + 回合控制：按先攻排序、当前行动者高亮、HP 条、状态 chip
 */
import React from 'react';
import { useBattleStore } from '@/store/battleStore';
import { ATTITUDE_META } from '@/lib/engine/types';
import { CONDITIONS } from '@/lib/engine/conditions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Play, ChevronRight, ChevronLeft, Flag, RefreshCw, Skull, Hourglass, Bot, User, Dices,
} from 'lucide-react';

export function InitiativeBar({ compact = false }: { compact?: boolean }) {
  const store = useBattleStore();
  const { units, turn, battleActive } = store;

  const ordered = React.useMemo(() => {
    const orderMap = new Map(turn.order.map((id, i) => [id, i]));
    return [...units].sort((a, b) => {
      const ia = orderMap.get(a.id) ?? 999;
      const ib = orderMap.get(b.id) ?? 999;
      if (ia !== ib) return ia - ib;
      return b.init - a.init;
    });
  }, [units, turn.order]);

  return (
    <div className="flex flex-col gap-2.5">
      {/* 回合控制 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {!battleActive ? (
          <Button
            size="sm"
            className="h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/85"
            onClick={() => store.startCombat()}
            title={store.rules.authorityMode !== 'ai-legacy' ? 'PHB 战斗步骤：全员掷先攻（1d20+敏捷调整值，被惊讶者劣势）后进入第 1 轮' : '按 AI 给定先攻值开战（兼容模式）'}
          >
            {store.rules.authorityMode !== 'ai-legacy'
              ? <><Dices className="h-4 w-4" />掷先攻 · 开战</>
              : <><Play className="h-4 w-4" />开始战斗</>}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" className="h-9 w-9 p-0" onClick={() => store.prevTurn()} title="上一回合">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" className="h-9 gap-1.5 flex-1 bg-primary text-primary-foreground hover:bg-primary/85" onClick={() => store.nextTurn()}>
              下一回合 <ChevronRight className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="secondary" className="h-9 gap-1.5" onClick={() => store.rollInitiativeAll()} title="全员重掷先攻">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="destructive" className="h-9 gap-1.5" onClick={() => store.endCombat()}>
              <Flag className="h-4 w-4" />结束
            </Button>
          </>
        )}
        <div className="ml-auto rounded-md border border-border/50 bg-black/30 px-2.5 py-1 text-xs text-muted-foreground">
          {battleActive ? `第 ${turn.round} 轮` : '待战'}
        </div>
      </div>

      {/* 先攻列表 */}
      <div className={cn('log-scroll flex flex-col gap-1.5 overflow-y-auto pr-1', compact ? 'max-h-48' : 'max-h-72')}>
        {ordered.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/50 p-4 text-center text-xs text-muted-foreground">
            暂无单位 —— 从下方添加怪物或在「导入」页粘贴 &lt;battle&gt; 数据
          </div>
        )}
        {ordered.map(u => {
          const meta = ATTITUDE_META[u.attitude];
          const isCurrent = turn.currentUnitId === u.id && battleActive;
          const hpRatio = u.maxHp > 0 ? Math.max(0, u.hp) / u.maxHp : 0;
          const isDown = u.hp <= 0 || u.deathSaves?.dead;
          const hasActed = u.hasActed;
          const isSelected = store.selectedId === u.id;
          return (
            <div
              key={u.id}
              onClick={() => store.setSelectedId(isSelected ? null : u.id)}
              className={cn(
                'group relative flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 transition-all',
                isCurrent ? 'border-primary/70 bg-primary/10 turn-glow' : 'border-border/40 bg-card/60 hover:bg-card',
                isSelected && !isCurrent && 'border-sky-400/50 bg-sky-500/10',
                isDown && 'opacity-50',
                hasActed && !isCurrent && 'opacity-70',
              )}
            >
              {/* 先攻值 */}
              <div
                className="flex h-8 w-9 shrink-0 flex-col items-center justify-center rounded-md border"
                style={{ borderColor: meta.color + '55', background: meta.color + '18' }}
                title={!u.initRolled && !battleActive && store.rules.authorityMode !== 'ai-legacy' ? '待掷：开战时自动掷先攻（1d20+敏捷）' : undefined}
              >
                <span className="flex items-center gap-0.5 text-sm font-bold leading-none" style={{ color: meta.color }}>
                  {u.init}
                  {!u.initRolled && !battleActive && store.rules.authorityMode !== 'ai-legacy' && (
                    <Dices className="h-2.5 w-2.5 text-amber-300/80" />
                  )}
                </span>
                <span className="text-[8px] leading-none text-muted-foreground">先攻</span>
              </div>
              {/* 名字 + HP */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium" style={{ color: meta.color }}>{u.name}</span>
                  {isDown && <Skull className="h-3 w-3 text-red-400" />}
                  {u.concentration && (
                    <span className="status-chip border-cyan-400/40 text-cyan-300" title={`专注：${u.concentration}`}>🎯</span>
                  )}
                  {u.legendary && u.legendary.points > 0 && (
                    <span className="status-chip border-purple-400/40 text-purple-300" title={`传奇动作 ${u.legendary.points} 点`}>
                      <Hourglass className="h-2.5 w-2.5" />{u.legendary.points}
                    </span>
                  )}
                </div>
                {/* HP 条 */}
                <div className="mt-0.5 flex items-center gap-1.5">
                  <div className="hp-bar-track h-2 flex-1">
                    <div
                      className="hp-bar-fill"
                      style={{
                        width: `${hpRatio * 100}%`,
                        background: hpRatio > 0.5
                          ? 'linear-gradient(90deg,#4f9d43,#6dbf5e)'
                          : hpRatio > 0.25
                            ? 'linear-gradient(90deg,#c9973a,#e0b040)'
                            : 'linear-gradient(90deg,#b03a3a,#e05252)',
                      }}
                    />
                  </div>
                  <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground">
                    {u.hp}/{u.maxHp}
                    {u.tempHp > 0 && <span className="text-cyan-300">+{u.tempHp}</span>}
                  </span>
                </div>
              </div>
              {/* 状态 chips */}
              <div className="flex max-w-[92px] flex-wrap justify-end gap-0.5">
                {u.statuses.slice(0, compact ? 3 : 5).map(s => {
                  const def = CONDITIONS[s];
                  return (
                    <span
                      key={s}
                      className="status-chip"
                      style={{
                        borderColor: def ? def.color + '66' : 'rgba(255,255,255,0.2)',
                        color: def?.color ?? '#aaa',
                        background: 'rgba(0,0,0,0.4)',
                      }}
                      title={def ? `${def.name}：${def.brief}` : s}
                    >
                      {def?.icon ?? '❓'}
                    </span>
                  );
                })}
                {u.statuses.length > (compact ? 3 : 5) && (
                  <span className="text-[9px] text-muted-foreground">+{u.statuses.length - (compact ? 3 : 5)}</span>
                )}
              </div>
              {/* 队友操控快捷开关 */}
              {u.attitude === 0 && !u.isPlayer && u.hp > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); store.togglePlayerControl(u.id); }}
                  title={u.playerControlled ? '当前：玩家操控（点击切为 AI 托管）' : '当前：AI 托管（点击切为玩家操控）'}
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors',
                    u.playerControlled
                      ? 'border-amber-400/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                      : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
                  )}
                >
                  {u.playerControlled ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                </button>
              )}
              {/* AC 徽章 */}
              <div className="flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-full border border-border/50 bg-black/30" title={`AC ${u.ac}`}>
                <span className="text-[11px] font-bold leading-none">{u.ac}</span>
                <span className="text-[7px] leading-none text-muted-foreground">AC</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
