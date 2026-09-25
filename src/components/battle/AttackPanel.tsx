'use client';

/**
 * 攻击结算面板：选择攻击者/目标 → 自动条件判定 → 结算攻击/豁免/专注
 */
import React, { useMemo, useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { attackRollModeAgainst, coverBonus } from '@/lib/engine/rules';
import { ATTITUDE_META, DAMAGE_TYPE_META } from '@/lib/engine/types';
import type { DamageType } from '@/lib/engine/types';
import { estimateCover, inMeleeRange, unitDistance } from '@/lib/engine/geometry';
import { MONSTER_PRESETS } from '@/lib/engine/presets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Swords, Shield, Target, Zap } from 'lucide-react';

export function AttackPanel({ defaultAttackerId }: { defaultAttackerId?: string | null }) {
  const store = useBattleStore();
  const { units, obstacles } = store;
  const alive = units.filter(u => !u.deathSaves?.dead);

  const [attackerId, setAttackerId] = useState<string | undefined>(defaultAttackerId ?? alive[0]?.id);
  const [targetId, setTargetId] = useState<string | undefined>(alive.find(u => u.id !== (defaultAttackerId ?? alive[0]?.id))?.id);
  const [attackBonus, setAttackBonus] = useState(5);
  const [damageFormula, setDamageFormula] = useState('1d8+3');
  const [rider, setRider] = useState('');
  const [damageType, setDamageType] = useState<DamageType>('slashing');

  const attacker = units.find(u => u.id === attackerId);
  const target = units.find(u => u.id === targetId);

  // 自动判定信息
  const autoInfo = useMemo(() => {
    if (!attacker || !target) return null;
    const mode = attackRollModeAgainst(attacker, target);
    const blockedCells = new Map<string, 'half' | 'threeQuarters' | 'full'>();
    for (const o of obstacles) for (const c of o.cells) blockedCells.set(`${c.cx},${c.cy}`, o.kind);
    const cover = estimateCover(attacker, target, obstacles, blockedCells);
    const dist = unitDistance(attacker, target, store.mapConfig.diagonal);
    const melee = inMeleeRange(attacker, target, attacker.reach ?? 5, store.mapConfig.diagonal);
    return { mode, cover, dist, melee };
  }, [attacker, target, obstacles, store.mapConfig.diagonal]);

  // 预设攻击填充
  const fillFromPreset = () => {
    if (!attacker) return;
    const preset = MONSTER_PRESETS.find(p => attacker.name.startsWith(p.name));
    if (preset?.attack) {
      setAttackBonus(preset.attack.bonus);
      setDamageFormula(preset.attack.damage);
      setDamageType(preset.attack.type);
    }
  };

  const effectiveAc = target ? target.ac + coverBonus(autoInfo?.cover.cover ?? 'none') : 10;

  const doAttack = () => {
    if (!attacker || !target) return;
    if (autoInfo?.cover.cover === 'full') return; // 2024 全掩护：无法直接指定（按钮已禁用，此处兜底）
    store.performAttack(attacker.id, target.id, {
      attackBonus,
      targetAc: effectiveAc,
      weaponDamage: damageFormula,
      riderDamage: rider || undefined,
      weaponType: damageType,
      coverKind: autoInfo?.cover.cover,
    });
  };

  const doSave = () => {
    if (!target) return;
    const dmg = parseInt(damageFormula.replace(/[^\d]/g, '') || '0', 10);
    store.performSave(target.id, {
      ability: 'dex',
      dc: 13,
      sourceDamage: dmg,
      halfOnSuccess: true,
    });
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* 攻击者/目标 */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-1.5">
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">攻击者</span>
          <Select value={attackerId} onValueChange={setAttackerId}>
            <SelectTrigger className="h-9 w-full border-border/50 bg-black/30 text-xs">
              <SelectValue placeholder="选择" className="truncate" />
            </SelectTrigger>
            <SelectContent>
              {alive.map(u => (
                <SelectItem key={u.id} value={u.id} className="text-xs">
                  {u.name}（+{u.init}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Swords className="mb-2 h-4 w-4 text-primary" />
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">目标</span>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger className="h-9 w-full border-border/50 bg-black/30 text-xs">
              <SelectValue placeholder="选择" className="truncate" />
            </SelectTrigger>
            <SelectContent>
              {alive.filter(u => u.id !== attackerId).map(u => (
                <SelectItem key={u.id} value={u.id} className="text-xs">
                  {u.name}（AC {u.ac}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {/* 攻击参数 */}
      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">攻击加值</span>
          <Input className="h-8 border-border/50 bg-black/30 text-center text-sm" type="number"
            value={attackBonus} onChange={e => setAttackBonus(parseInt(e.target.value, 10) || 0)} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">伤害公式</span>
          <Input className="h-8 border-border/50 bg-black/30 text-center font-mono text-sm"
            value={damageFormula} onChange={e => setDamageFormula(e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">附加伤害骰（重击不翻倍）</span>
          <Input className="h-8 border-border/50 bg-black/30 text-center font-mono text-sm" placeholder="如 2d6 神能"
            value={rider} onChange={e => setRider(e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">伤害类型</span>
          <Select value={damageType} onValueChange={v => setDamageType(v as DamageType)}>
            <SelectTrigger className="h-8 border-border/50 bg-black/30 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DAMAGE_TYPE_META).map(([k, m]) => (
                <SelectItem key={k} value={k} className="text-xs">{m.icon} {m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {/* 自动判定信息 */}
      {autoInfo && target && attacker && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/40 bg-black/25 px-2.5 py-2 text-[11px]">
          {autoInfo.mode.mode !== 'normal' && (
            <span className={cn('rounded-md px-1.5 py-0.5 font-semibold',
              autoInfo.mode.mode === 'advantage' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300')}>
              {autoInfo.mode.mode === 'advantage' ? '↑ 优势' : '↓ 劣势'}
              <span className="ml-1 font-normal text-muted-foreground">{autoInfo.mode.reasons.join('、')}</span>
            </span>
          )}
          {autoInfo.cover.cover !== 'none' && (
            <span className="flex items-center gap-0.5 rounded-md bg-blue-500/15 px-1.5 py-0.5 text-sky-300">
              <Shield className="h-3 w-3" />
              {autoInfo.cover.cover === 'half' ? '半身掩护 +2' : autoInfo.cover.cover === 'threeQuarters' ? '3/4掩护 +5' : '完全掩护'}
            </span>
          )}
          <span className="text-muted-foreground">距离 {autoInfo.dist} 尺{autoInfo.melee ? '（近战范围）' : ''}</span>
          <span className="ml-auto font-semibold text-primary">
            有效 AC {effectiveAc}
          </span>
        </div>
      )}

      {/* 执行按钮 */}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" className="h-9 flex-1 gap-1.5 bg-red-800 hover:bg-red-700" onClick={doAttack} disabled={!attacker || !target || autoInfo?.cover.cover === 'full'}>
          <Zap className="h-4 w-4" />结算攻击
        </Button>
        <Button size="sm" variant="secondary" className="h-9 gap-1 text-xs" onClick={fillFromPreset} disabled={!attacker}>
          <Target className="h-3.5 w-3.5" />填入预设
        </Button>
        <Button size="sm" variant="secondary" className="h-9 gap-1 text-xs" onClick={doSave} disabled={!target}>
          敏捷豁免（半伤）
        </Button>
      </div>

      {/* 目标抗性提示 */}
      {target && (target.resistances.length > 0 || target.immunities.length > 0 || target.vulnerabilities.length > 0) && (
        <div className="flex flex-wrap gap-1 text-[10px]">
          {target.immunities.map(t => (
            <span key={t} className="status-chip border-red-400/40 text-red-300" title="免疫">免疫 {DAMAGE_TYPE_META[t].name}</span>
          ))}
          {target.resistances.map(t => (
            <span key={t} className="status-chip border-amber-400/40 text-amber-300" title="抗性×½">抗性 {DAMAGE_TYPE_META[t].name}</span>
          ))}
          {target.vulnerabilities.map(t => (
            <span key={t} className="status-chip border-green-400/40 text-green-300" title="易伤×2">易伤 {DAMAGE_TYPE_META[t].name}</span>
          ))}
        </div>
      )}
    </div>
  );
}
