'use client';

/**
 * 单位详情卡：选中单位编辑面板
 * HP/治疗/伤害、属性、状态开关、抗性编辑、法术位、死亡豁免、专注
 */
import React, { useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { CONDITIONS, PROTOCOL_STATUSES } from '@/lib/engine/conditions';
import { ATTITUDE_META, ABILITY_META, DAMAGE_TYPE_META, AI_PROFILE_META } from '@/lib/engine/types';
import type { DamageType, AbilityKey, AIProfile } from '@/lib/engine/types';
import { abilityMod, formatMod, effectiveSpeed } from '@/lib/engine/rules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  HeartPulse, Swords, Shield, Sparkles, HeartCrack, Dices, Target, Trash2,
  Bot, User, Wand2, Zap, Cross,
} from 'lucide-react';

export function UnitDetailCard({ unitId, compact = false }: { unitId: string | null; compact?: boolean }) {
  const store = useBattleStore();
  const unit = store.units.find(u => u.id === unitId);
  const [dmgInput, setDmgInput] = useState('');
  const [healInput, setHealInput] = useState('');

  if (!unit) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 p-5 text-center text-xs text-muted-foreground">
        点击地图上的 token 或先攻条中的单位查看详情
      </div>
    );
  }

  const meta = ATTITUDE_META[unit.attitude];
  const hpRatio = unit.maxHp > 0 ? Math.max(0, unit.hp) / unit.maxHp : 0;

  return (
    <div className="flex flex-col gap-3 rounded-xl parchment-panel p-3.5">
      {/* 标题行 */}
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-black text-black/80" style={{ background: meta.color }}>
          {unit.name.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <Input
            className="h-7 border-transparent bg-transparent px-1 text-base font-bold"
            value={unit.name}
            onChange={e => store.updateUnit(unit.id, { name: e.target.value })}
          />
          <div className="px-1 text-[11px] text-muted-foreground">
            {meta.label}{unit.isPlayer ? ' · 玩家' : unit.cr !== undefined ? ` · CR ${unit.cr}` : ''}
            {unit.level ? ` · ${unit.level}级` : ''}
          </div>
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-1 text-muted-foreground hover:text-red-400"
          onClick={() => store.removeUnit(unit.id)} title="移除单位">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* AI 行动逻辑：操控开关 + 战术档案 + 动作表 */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-black/25 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground">行动逻辑</span>
          {unit.attitude === 0 && !unit.isPlayer ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs" title="切换本队友回合由玩家手动操作或 AI 自动托管">
              <Switch
                checked={!!unit.playerControlled}
                onCheckedChange={() => store.togglePlayerControl(unit.id)}
              />
              {unit.playerControlled ? (
                <span className="flex items-center gap-1 font-medium text-amber-300"><User className="h-3.5 w-3.5" />玩家操控</span>
              ) : (
                <span className="flex items-center gap-1 font-medium text-emerald-300"><Bot className="h-3.5 w-3.5" />AI 托管</span>
              )}
            </label>
          ) : unit.isPlayer ? (
            <span className="flex items-center gap-1 text-xs text-amber-300"><User className="h-3.5 w-3.5" />玩家角色（手动操控）</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-red-300"><Bot className="h-3.5 w-3.5" />敌方 AI</span>
          )}
          <div className="grow" />
          {/* 战术档案 */}
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            战术档案
            <select
              className="rounded-md border border-border/50 bg-black/40 px-1.5 py-0.5 text-[11px] text-foreground"
              value={unit.aiProfile ?? 'tactical'}
              onChange={e => store.updateUnit(unit.id, { aiProfile: e.target.value as AIProfile })}
            >
              {(Object.keys(AI_PROFILE_META) as AIProfile[]).map(p => (
                <option key={p} value={p}>{AI_PROFILE_META[p].label}</option>
              ))}
            </select>
          </label>
        </div>
        {/* 动作表 */}
        {unit.aiAbilities && unit.aiAbilities.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {unit.aiAbilities.map(a => {
              const icon = a.kind === 'heal' ? <Cross className="h-3 w-3" />
                : a.kind === 'save-aoe' ? <Wand2 className="h-3 w-3" />
                : a.kind === 'ranged' ? <Target className="h-3 w-3" />
                : <Zap className="h-3 w-3" />;
              const desc = a.kind === 'heal'
                ? `治疗 ${a.dice}${a.range > 5 ? ` · 射程${a.range}尺` : ''}`
                : a.kind === 'save-aoe'
                  ? `${a.dice} ${a.aoe ? `${a.aoe.size}尺${a.aoe.kind === 'cone' ? '锥形' : a.aoe.kind === 'line' ? '直线' : a.aoe.kind === 'sphere' ? '球体' : a.aoe.kind === 'cube' ? '立方' : '圆形'}` : ''} · ${a.saveAbility?.toUpperCase() ?? 'DEX'}豁免DC${a.saveDc ?? 13}${a.halfOnSuccess ? '（半伤）' : ''}`
                  : `${a.attackBonus !== undefined ? `+${a.attackBonus}` : ''} ${a.dice}${(a.multiAttack ?? 1) > 1 ? ` ×${a.multiAttack}` : ''}${a.range > 5 ? ` · 射程${a.range}尺` : ' · 近战'}`;
              return (
                <span
                  key={a.id}
                  title={a.note ?? a.name}
                  className="flex items-center gap-1 rounded-md border border-border/40 bg-black/30 px-1.5 py-0.5 text-[10px] text-foreground/85"
                >
                  {icon}{a.name}
                  <span className="text-muted-foreground">{desc}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* HP 大条 + 快速操作 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="hp-bar-track h-3.5 flex-1">
            <div className="hp-bar-fill" style={{
              width: `${hpRatio * 100}%`,
              background: hpRatio > 0.5 ? 'linear-gradient(90deg,#4f9d43,#6dbf5e)' : hpRatio > 0.25 ? 'linear-gradient(90deg,#c9973a,#e0b040)' : 'linear-gradient(90deg,#b03a3a,#e05252)',
            }} />
          </div>
          <span className="text-sm font-bold tabular-nums">
            {unit.hp}<span className="text-muted-foreground">/{unit.maxHp}</span>
            {unit.tempHp > 0 && <span className="text-cyan-300"> +{unit.tempHp}</span>}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1">
            <Input className="h-8 w-16 text-center text-sm" placeholder="伤害" value={dmgInput}
              onChange={e => setDmgInput(e.target.value)} type="number" />
            <Button size="sm" variant="destructive" className="h-8 gap-1"
              onClick={() => {
                const n = parseInt(dmgInput, 10);
                if (!Number.isNaN(n) && n > 0) { store.damageUnit(unit.id, n); setDmgInput(''); }
              }}>
              <HeartCrack className="h-3.5 w-3.5" />伤害
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Input className="h-8 w-16 text-center text-sm" placeholder="治疗" value={healInput}
              onChange={e => setHealInput(e.target.value)} type="number" />
            <Button size="sm" className="h-8 gap-1 bg-green-700 hover:bg-green-600" 
              onClick={() => {
                const n = parseInt(healInput, 10);
                if (!Number.isNaN(n) && n > 0) { store.healUnit(unit.id, n); setHealInput(''); }
              }}>
              <HeartPulse className="h-3.5 w-3.5" />治疗
            </Button>
          </div>
          <Button size="sm" variant="secondary" className="h-8" title="获得临时HP"
            onClick={() => {
              const n = parseInt(dmgInput, 10);
              if (!Number.isNaN(n) && n > 0) { store.tempHpUnit(unit.id, n); setDmgInput(''); }
            }}>
            <Shield className="h-3.5 w-3.5" />临时
          </Button>
        </div>
        {/* 死亡豁免 */}
        {unit.hp <= 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-red-500/40 bg-red-950/30 p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-red-300">死亡豁免</span>
              <div className="flex gap-1">
                <Button size="sm" className="h-7 gap-1" onClick={() => store.rollDeathSave(unit.id)}>
                  <Dices className="h-3.5 w-3.5" />掷骰
                </Button>
                <Button size="sm" variant="secondary" className="h-7 text-[11px]" onClick={() => store.stabilizeUnit(unit.id)}>稳定</Button>
                <Button size="sm" variant="secondary" className="h-7 text-[11px]" onClick={() => store.reviveUnit(unit.id, 1)}>复苏1HP</Button>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">成功</span>
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <button key={i} onClick={() => i === (unit.deathSaves?.successes ?? 0) ? store.addDeathSuccess(unit.id) : undefined}
                    className={cn('h-3.5 w-3.5 rounded-full border', i < (unit.deathSaves?.successes ?? 0) ? 'border-green-400 bg-green-500' : 'border-border bg-transparent')} />
                ))}
              </div>
              <span className="text-muted-foreground">失败</span>
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <button key={i}
                    className={cn('h-3.5 w-3.5 rounded-full border', i < (unit.deathSaves?.failures ?? 0) ? 'border-red-400 bg-red-500' : 'border-border bg-transparent')} />
                ))}
              </div>
              {unit.deathSaves?.stable && <span className="text-green-400">已稳定</span>}
              {unit.deathSaves?.dead && <span className="font-bold text-red-400">已死亡</span>}
            </div>
          </div>
        )}
      </div>

      {/* 数值编辑行 */}
      <div className="grid grid-cols-4 gap-1.5">
        {([
          ['先攻', 'init', unit.init],
          ['AC', 'ac', unit.ac],
          ['HP上限', 'maxHp', unit.maxHp],
          ['速度', 'speed', unit.speed],
        ] as const).map(([label, key, val]) => (
          <label key={key} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">{label}</span>
            <Input className="h-8 border-border/50 bg-black/30 text-center text-sm" type="number" value={val}
              onChange={e => store.updateUnit(unit.id, { [key]: parseInt(e.target.value, 10) || 0 } as never)} />
          </label>
        ))}
      </div>

      {/* 属性 */}
      <div>
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">属性值（豁免=属性调整）</div>
        <div className="grid grid-cols-6 gap-1">
          {(Object.keys(ABILITY_META) as AbilityKey[]).map(k => (
            <label key={k} className="flex flex-col items-center gap-0.5" title={`${ABILITY_META[k].name} 调整值 ${formatMod(abilityMod(unit.abilities?.[k] ?? 10))}`}>
              <span className="text-[9px] text-muted-foreground">{ABILITY_META[k].short}</span>
              <Input className="h-7 w-full border-border/50 bg-black/30 px-0.5 text-center text-xs" type="number"
                value={unit.abilities?.[k] ?? 10}
                onChange={e => store.updateUnit(unit.id, {
                  abilities: { ...unit.abilities, [k]: parseInt(e.target.value, 10) || 10 } as never,
                })} />
              <span className="text-[9px] font-bold text-primary">{formatMod(abilityMod(unit.abilities?.[k] ?? 10))}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 状态开关 */}
      <div>
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">状态条件（点击切换）</div>
        <div className="flex flex-wrap gap-1">
          {PROTOCOL_STATUSES.map(s => {
            const def = CONDITIONS[s];
            const active = unit.statuses.includes(s);
            return (
              <button
                key={s}
                onClick={() => store.toggleStatus(unit.id, s)}
                title={def.brief}
                className={cn('status-chip transition-all',
                  active ? 'scale-105 shadow-md' : 'opacity-45 hover:opacity-80')}
                style={{
                  borderColor: def.color + (active ? 'cc' : '44'),
                  color: def.color,
                  background: active ? def.color + '26' : 'rgba(0,0,0,0.35)',
                }}
              >
                {def.icon} {def.name}
              </button>
            );
          })}
          {['concentration', 'flying', 'blessed'].map(s => {
            const def = CONDITIONS[s];
            const active = unit.statuses.includes(s) || (s === 'concentration' && !!unit.concentration);
            return (
              <button
                key={s}
                onClick={() => {
                  if (s === 'concentration') {
                    store.setConcentration(unit.id, active ? null : '法术');
                  } else {
                    store.toggleStatus(unit.id, s);
                  }
                }}
                title={def.brief}
                className={cn('status-chip transition-all', active ? 'scale-105' : 'opacity-45 hover:opacity-80')}
                style={{
                  borderColor: def.color + (active ? 'cc' : '44'),
                  color: def.color,
                  background: active ? def.color + '26' : 'rgba(0,0,0,0.35)',
                }}
              >
                {def.icon} {def.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* 抗性/免疫/易伤 */}
      <div>
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">伤害调整</div>
        <div className="grid grid-cols-3 gap-2">
          {([
            ['抗性×½', 'resistances'],
            ['免疫×0', 'immunities'],
            ['易伤×2', 'vulnerabilities'],
          ] as const).map(([label, key]) => (
            <div key={key} className="rounded-lg border border-border/40 bg-black/25 p-1.5">
              <div className="mb-1 text-[10px] text-muted-foreground">{label}</div>
              <div className="flex flex-wrap gap-0.5">
                {(Object.keys(DAMAGE_TYPE_META) as DamageType[]).map(dt => {
                  const list = unit[key];
                  const active = list.includes(dt);
                  return (
                    <button
                      key={dt}
                      title={`${DAMAGE_TYPE_META[dt].name} ${label}`}
                      onClick={() => store.updateUnit(unit.id, {
                        [key]: active ? list.filter(x => x !== dt) : [...list, dt],
                      } as never)}
                      className={cn('rounded px-1 text-[13px] leading-5 transition-all',
                        active ? 'bg-primary/30 ring-1 ring-primary/60' : 'opacity-35 hover:opacity-70')}
                    >
                      {DAMAGE_TYPE_META[dt].icon}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 法术位 */}
      <SpellSlotEditor unitId={unit.id} />

      {/* 备注 */}
      <div>
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">备注（特性/巢穴动作等）</div>
        <textarea
          className="w-full rounded-lg border border-border/40 bg-black/30 p-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50"
          rows={2}
          placeholder="如：巢穴动作、传奇抗性、特殊攻击…"
          value={unit.notes ?? ''}
          onChange={e => store.updateUnit(unit.id, { notes: e.target.value })}
        />
      </div>

      {/* 快捷掷骰 */}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" className="h-8 gap-1 text-xs"
          onClick={() => store.quickRoll('1d20', 'normal', `${unit.name} d20`)}>
          <Dices className="h-3.5 w-3.5" />d20
        </Button>
        <Button size="sm" variant="secondary" className="h-8 gap-1 text-xs"
          onClick={() => store.quickRoll('1d20', 'advantage', `${unit.name} 优势`)}>
          <Sparkles className="h-3.5 w-3.5" />优势
        </Button>
        <Button size="sm" variant="secondary" className="h-8 gap-1 text-xs"
          onClick={() => store.quickRoll('1d20', 'disadvantage', `${unit.name} 劣势`)}>
          <Swords className="h-3.5 w-3.5" />劣势
        </Button>
      </div>
    </div>
  );
}

/** 法术位编辑器 */
function SpellSlotEditor({ unitId }: { unitId: string }) {
  const store = useBattleStore();
  const unit = store.units.find(u => u.id === unitId);
  if (!unit) return null;
  const slots = unit.spellSlots;

  const initSlots = (levels: number[]) => {
    const s: typeof slots = {};
    for (const lv of levels) s[lv] = { current: 2, max: 2 };
    store.updateUnit(unitId, { spellSlots: s });
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground">法术位</span>
        {!slots && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => initSlots([1, 2, 3])}>满施法者 1-3环</Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => initSlots([1, 2, 3, 4, 5, 6, 7, 8, 9])}>1-9环</Button>
          </div>
        )}
        {slots && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => store.restoreSpellSlots(unitId, true)}>长休恢复</Button>
          </div>
        )}
      </div>
      {slots && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(slots).sort((a, b) => Number(a[0]) - Number(b[0])).map(([lvStr, s]) => {
            const lv = Number(lvStr);
            return (
              <div key={lv} className="flex items-center gap-1 rounded-lg border border-border/40 bg-black/25 px-1.5 py-1">
                <span className="text-[10px] text-muted-foreground">{lv}环</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: s.max }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (i < s.current) store.spendSpellSlot(unitId, lv);
                        else store.updateUnit(unitId, {
                          spellSlots: { ...slots, [lv]: { ...s, current: Math.min(s.max, i + 1) } },
                        });
                      }}
                      title={i < s.current ? `消耗 ${lv} 环` : `恢复 ${lv} 环`}
                      className={cn('h-3 w-3 rounded-full border transition-colors',
                        i < s.current ? 'border-cyan-300 bg-cyan-400 shadow-[0_0_6px_rgba(110,200,240,0.7)]' : 'border-border bg-transparent')}
                    />
                  ))}
                </div>
                <span className="text-[10px] tabular-nums text-muted-foreground">{s.current}/{s.max}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
