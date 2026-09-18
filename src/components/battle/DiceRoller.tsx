'use client';

/**
 * 骰子面板：快捷骰 + 自定义公式 + 大成功/大失败动画覆盖层
 */
import React, { useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { formatDice } from '@/lib/engine/dice';
import type { RollMode } from '@/lib/engine/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Dices, Sparkles, Swords, ChevronUp, ChevronDown } from 'lucide-react';

const QUICK_DICE = ['d20', 'd12', 'd10', 'd8', 'd6', 'd4', '2d6', '1d10+3'];

export function DiceRoller() {
  const store = useBattleStore();
  const [formula, setFormula] = useState('1d20+5');
  const [mode, setMode] = useState<RollMode>('normal');

  const last = store.lastRoll;

  const roll = (f: string) => {
    try {
      store.quickRoll(f, mode);
    } catch {
      /* 公式错误静默 */
    }
  };

  const isCrit = last?.result.rawD20 === 20;
  const isFail = last?.result.rawD20 === 1;

  return (
    <div className="relative flex flex-col gap-2.5">
      {/* 模式切换 */}
      <div className="flex items-center gap-1">
        {([
          ['normal', '常规', Dices],
          ['advantage', '优势', ChevronUp],
          ['disadvantage', '劣势', ChevronDown],
        ] as const).map(([m, label, Icon]) => (
          <Button key={m} size="sm" variant={mode === m ? 'default' : 'secondary'}
            className={cn('h-8 flex-1 gap-1 text-xs', mode === m && 'bg-primary text-primary-foreground')}
            onClick={() => setMode(m)}>
            <Icon className="h-3.5 w-3.5" />{label}
          </Button>
        ))}
      </div>

      {/* 快捷骰 */}
      <div className="grid grid-cols-4 gap-1.5">
        {QUICK_DICE.map(d => (
          <Button key={d} size="sm" variant="secondary" className="h-9 font-mono text-xs hover:bg-accent"
            onClick={() => roll(d)}>
            {d}
          </Button>
        ))}
      </div>

      {/* 自定义公式 */}
      <div className="flex gap-1.5">
        <Input
          className="h-9 border-border/50 bg-black/30 font-mono text-sm"
          placeholder="如 2d6+3 或 1d8+2d4"
          value={formula}
          onChange={e => setFormula(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && roll(formula)}
        />
        <Button className="h-9 gap-1 bg-primary text-primary-foreground hover:bg-primary/85" onClick={() => roll(formula)}>
          <Dices className="h-4 w-4" />掷骰
        </Button>
      </div>

      {/* 最近结果 */}
      <div className="log-scroll flex max-h-32 flex-col gap-1 overflow-y-auto">
        {store.events.filter(e => e.type === 'check' || e.type === 'save').slice(-6).reverse().map(e => (
          <div key={e.id} className={cn('rounded-md border px-2 py-1 text-[11px] leading-tight',
            e.level === 'crit' ? 'border-amber-400/50 bg-amber-500/10 text-amber-200'
              : e.level === 'bad' ? 'border-red-400/40 bg-red-500/10 text-red-200'
                : 'border-border/40 bg-black/25 text-foreground/85')}>
            {e.text}
          </div>
        ))}
        {store.events.filter(e => e.type === 'check' || e.type === 'save').length === 0 && (
          <div className="rounded-md border border-dashed border-border/40 px-2 py-3 text-center text-[11px] text-muted-foreground">
            掷骰结果显示在这里
          </div>
        )}
      </div>

      {/* 骰子动画覆盖层（key 驱动重放，动画结束自动淡出） */}
      {last && (
        <div key={last.id} className="dice-flash absolute inset-0 z-50 flex items-center justify-center">
          <div className={cn(
            'dice-rolling flex flex-col items-center gap-1 rounded-2xl border-2 px-8 py-5 backdrop-blur-md',
            isCrit ? 'border-amber-300 bg-amber-950/80 shadow-[0_0_60px_rgba(245,197,66,0.6)]'
              : isFail ? 'fail-shake border-red-400 bg-red-950/85 shadow-[0_0_50px_rgba(230,69,69,0.5)]'
                : 'border-primary/60 bg-black/85',
          )}>
            <div className={cn('font-display text-6xl font-black leading-none',
              isCrit ? 'crit-burst gold-text' : isFail ? 'text-red-300' : 'gold-text')}>
              {last.result.rawD20 ?? last.result.total}
            </div>
            <div className={cn('text-sm font-bold',
              isCrit ? 'text-amber-200' : isFail ? 'text-red-200' : 'text-primary')}>
              {isCrit ? '✦ 大成功 ✦' : isFail ? '✕ 大失败 ✕' : last.note ?? '掷骰结果'}
            </div>
            {last.result.rolls.length > 1 && (
              <div className="text-[11px] text-muted-foreground">
                {last.result.rolls.map(r => (r.kept ? r.value : `(${r.value})`)).join(' · ')}
                {last.result.modifier !== 0 && (last.result.modifier > 0 ? ` +${last.result.modifier}` : ` ${last.result.modifier}`)}
                {' = '}{last.result.total}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
