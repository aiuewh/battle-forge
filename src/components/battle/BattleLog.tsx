'use client';

/**
 * 战斗日志：时间线事件流，按级别着色
 */
import React from 'react';
import { useBattleStore } from '@/store/battleStore';
import { cn } from '@/lib/utils';
import { ScrollText } from 'lucide-react';

const LEVEL_CLS: Record<string, string> = {
  info: 'border-border/40 bg-black/20 text-foreground/80',
  good: 'border-green-500/35 bg-green-950/25 text-green-200',
  bad: 'border-red-500/35 bg-red-950/25 text-red-200',
  crit: 'border-amber-400/50 bg-amber-950/30 text-amber-200',
};

export function BattleLog({ compact = false }: { compact?: boolean }) {
  const events = useBattleStore(s => s.events);
  const logRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <ScrollText className="h-3.5 w-3.5" />战斗日志
        <span className="rounded-full bg-black/40 px-1.5 text-[10px]">{events.length}</span>
      </div>
      <div ref={logRef} className={cn('log-scroll flex flex-col gap-1 overflow-y-auto pr-1', compact ? 'max-h-40' : 'max-h-64 md:max-h-96')}>
        {events.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/40 p-4 text-center text-xs text-muted-foreground">
            战斗事件将按时间线显示在这里
          </div>
        )}
        {events.map(e => (
          <div key={e.id} className={cn('flex items-start gap-1.5 rounded-md border px-2 py-1 text-[11.5px] leading-snug', LEVEL_CLS[e.level ?? 'info'])}>
            <span className="shrink-0 font-mono text-[9px] text-muted-foreground/70">
              R{e.round}
            </span>
            <span className="min-w-0 break-words">{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
