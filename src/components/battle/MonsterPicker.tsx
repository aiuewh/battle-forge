'use client';

/**
 * 怪物快速添加面板：预设怪物库 + 遭遇难度预算计算
 */
import React, { useMemo, useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { MONSTER_PRESETS } from '@/lib/engine/presets';
import { encounterDifficulty } from '@/lib/engine/combat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Plus, Users, Skull, Swords } from 'lucide-react';

export function MonsterPicker() {
  const store = useBattleStore();
  const [query, setQuery] = useState('');
  const [partyLevel, setPartyLevel] = useState(3);
  const [partySize, setPartySize] = useState(4);

  const filtered = MONSTER_PRESETS.filter(m => m.name.includes(query.trim()));

  // 敌方单位 CR 列表
  const monsterCrs = store.units.filter(u => u.attitude === 2).map(u => u.cr ?? 1);
  const partyLevels = Array.from({ length: partySize }, () => partyLevel);
  const difficulty = useMemo(
    () => encounterDifficulty(monsterCrs, partyLevels),
    [monsterCrs, partyLevels],
  );

  const DIFF_CLS: Record<string, string> = {
    trivial: 'text-green-300',
    easy: 'text-green-300',
    medium: 'text-amber-300',
    hard: 'text-orange-400',
    deadly: 'text-red-400 font-bold',
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 搜索 */}
      <div className="flex items-center gap-2">
        <Input
          className="h-9 border-border/50 bg-black/30 text-sm"
          placeholder="搜索怪物预设…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* 怪物网格 */}
      <div className="log-scroll grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto pr-1 md:grid-cols-3">
        {filtered.map(m => (
          <button
            key={m.name}
            onClick={() => store.addUnitFromPreset(m, true)}
            className="group flex flex-col items-start rounded-lg border border-border/40 bg-card/60 px-2.5 py-1.5 text-left transition-all hover:border-primary/60 hover:bg-primary/10"
            title={m.note ?? m.attack ? `${m.attack?.name}：+${m.attack?.bonus} 命中，${m.attack?.damage} ${m.attack?.type}` : m.name}
          >
            <span className="flex w-full items-center justify-between text-[13px] font-semibold text-foreground">
              {m.name}
              <Plus className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
            </span>
            <span className="text-[10px] text-muted-foreground">
              CR {m.cr} · AC {m.ac} · HP {m.hp}
            </span>
          </button>
        ))}
      </div>

      {/* 遭遇难度 */}
      <div className="rounded-xl border border-border/40 bg-black/25 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Swords className="h-3.5 w-3.5" />遭遇难度预算（2024 XP 阈值）
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            <Input className="h-7 w-12 border-border/50 bg-black/30 text-center" type="number" min={1} max={20}
              value={partyLevel} onChange={e => setPartyLevel(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))} />
            级 ×
            <Input className="h-7 w-12 border-border/50 bg-black/30 text-center" type="number" min={1} max={10}
              value={partySize} onChange={e => setPartySize(Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))} />
            人
          </label>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">敌方 XP：</span>
          <span className="font-mono">{difficulty.totalXp}</span>
          <span className="text-muted-foreground">调整后（×数量系数）：</span>
          <span className="font-mono font-bold">{difficulty.adjustedXp}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Skull className="h-3.5 w-3.5" />
          <span className={cn('text-sm', DIFF_CLS[difficulty.level])}>
            {difficulty.level === 'trivial' ? '轻松' : difficulty.level === 'easy' ? '简单' : difficulty.level === 'medium' ? '中等' : difficulty.level === 'hard' ? '困难' : '致命'}
          </span>
          <span className="text-[10px] text-muted-foreground">
            (简单{difficulty.threshold.easy} / 中等{difficulty.threshold.medium} / 困难{difficulty.threshold.hard} / 致命{difficulty.threshold.deadly})
          </span>
        </div>
      </div>

      {/* 添加自定义单位 */}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" className="h-8 text-xs"
          onClick={() => store.addUnit({ id: '勇士', name: '勇士', attitude: 0, isPlayer: true, hp: 28, maxHp: 28, ac: 16, init: 12, abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 } })}>
          <Plus className="h-3.5 w-3.5" />添加玩家单位
        </Button>
        <Button size="sm" variant="secondary" className="h-8 text-xs"
          onClick={() => store.addUnit({ id: '敌人', name: '敌人', attitude: 2, hp: 15, maxHp: 15, ac: 13, init: 10 })}>
          <Plus className="h-3.5 w-3.5" />添加空白敌人
        </Button>
        <Button size="sm" variant="secondary" className="h-8 text-xs"
          onClick={() => store.addUnit({ id: '平民', name: '平民', attitude: 1, hp: 4, maxHp: 4, ac: 10, init: 10 })}>
          <Plus className="h-3.5 w-3.5" />添加中立单位
        </Button>
      </div>
    </div>
  );
}
