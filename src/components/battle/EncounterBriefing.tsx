'use client';

/**
 * 战前敌情简报：
 * DM 在战斗爆发前先输出 <encounter> 敌卡（世界书协议要求），
 * 面板暂存后以简报形式展示 —— 敌方阵容、个体数值、遭遇难度预估，
 * 并提示「等待 <battle> 触发」。战斗触发后自动配装，无需手动操作。
 */
import React from 'react';
import { useBattleStore } from '@/store/battleStore';
import { encounterDifficulty } from '@/lib/engine/combat';
import { AI_PROFILE_META } from '@/lib/engine/types';
import { cn } from '@/lib/utils';
import { Skull, Shield, Heart, Zap, MapPin, Eye, Swords } from 'lucide-react';

const DIFF_META: Record<string, { label: string; cls: string }> = {
  trivial: { label: '轻松', cls: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300' },
  easy: { label: '简单', cls: 'border-lime-400/40 bg-lime-500/10 text-lime-300' },
  medium: { label: '中等', cls: 'border-amber-400/40 bg-amber-500/10 text-amber-300' },
  hard: { label: '困难', cls: 'border-orange-400/50 bg-orange-500/10 text-orange-300' },
  deadly: { label: '致命', cls: 'border-red-400/50 bg-red-500/15 text-red-300' },
};

export function EncounterBriefing({ compact = false }: { compact?: boolean }) {
  const staged = useBattleStore(s => s.stagedStatblocks);
  const rosterSheets = useBattleStore(s => s.rosterSheets);
  const battleActive = useBattleStore(s => s.battleActive);
  const units = useBattleStore(s => s.units);

  if (staged.length === 0 || battleActive || units.length > 0) return null;

  // 难度预估：暂存敌卡 CR × 名单等级（无名单按 3 人 1 级估算）
  const partyLevels = rosterSheets.length > 0
    ? rosterSheets.map(s => s.level)
    : [1, 1, 1];
  const crs = staged.map(d => d.cr);
  // 多个同名实例近似：战场里通常会以 名称+序号 复数出现，暂按卡面 1:1 估算
  const diff = encounterDifficulty(crs, partyLevels);
  const diffMeta = DIFF_META[diff.level] ?? DIFF_META.trivial;

  return (
    <div className="rounded-xl border border-red-400/25 bg-gradient-to-b from-red-950/30 to-black/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Skull className="h-4 w-4 text-red-300" />
        <span className="text-sm font-bold text-red-200">战前敌情简报</span>
        <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', diffMeta.cls)}>
          预估难度：{diffMeta.label}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {diff.adjustedXp} XP{rosterSheets.length === 0 ? '（未知队伍等级，按 3×Lv.1 估）' : ''}
        </span>
        <div className="grow" />
        <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
          ⏳ 等待 DM 输出 &lt;battle&gt; 触发战斗
        </span>
      </div>

      <div className={cn(
        'grid gap-2',
        compact ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-3',
      )}>
        {staged.map(d => (
          <div key={d.id} className="rounded-lg border border-border/50 bg-black/30 p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="text-[13px] font-bold text-red-100">{d.name}</span>
              {d.cr !== undefined && (
                <span className="rounded border border-border/60 px-1 text-[10px] text-muted-foreground">CR {d.cr}</span>
              )}
              {d.size && <span className="text-[10px] text-muted-foreground">{d.size}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><Heart className="h-3 w-3 text-red-400/80" />{d.hp}</span>
              <span className="flex items-center gap-1"><Shield className="h-3 w-3 text-sky-400/80" />AC {d.ac}</span>
              {d.speed !== undefined && (
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-emerald-400/80" />{d.speed}尺</span>
              )}
            </div>
            {d.attacks.length > 0 && (
              <div className="mt-1.5 flex flex-col gap-0.5">
                {d.attacks.slice(0, compact ? 2 : 3).map((a, i) => (
                  <div key={i} className="flex items-center gap-1 text-[11px] text-foreground/75">
                    <Zap className="h-3 w-3 shrink-0 text-amber-400/70" />
                    <span className="truncate">
                      {a.name}
                      {a.attackBonus !== undefined ? ` +${a.attackBonus}` : ''}
                      {a.dice ? ` ${a.dice}` : ''}
                      {a.saveDc !== undefined ? ` DC${a.saveDc}` : ''}
                      {a.multiAttack && a.multiAttack > 1 ? ` ×${a.multiAttack}` : ''}
                    </span>
                  </div>
                ))}
                {d.attacks.length > (compact ? 2 : 3) && (
                  <span className="text-[10px] text-muted-foreground">…共 {d.attacks.length} 个动作</span>
                )}
              </div>
            )}
            {d.aiProfile && (
              <div className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
                <Eye className="h-3 w-3" />
                战术：{AI_PROFILE_META[d.aiProfile]?.label ?? d.aiProfile}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        <Swords className="mr-1 inline h-3 w-3" />
        敌卡已暂存 —— 当 DM 输出 <code className="text-primary">&lt;battle&gt;</code> 块时，同名敌方单位将自动装配上述数据
        （AC / 六维 / 动作表 / 抗性 / AI 战术档案），并在 2.5D 地图上开战。战斗在前端面板内结算，DM 只负责叙述。
      </div>
    </div>
  );
}
