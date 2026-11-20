'use client';

/**
 * 单位详情卡（人物卡）
 *
 * 设计原则（2026-11-20 重构）：
 *  1. 战斗中最常做的三件事——扣血 / 回血 / 切状态——必须一屏可见、零折叠。
 *  2. 低频编辑（属性、抗性、法术位、备注）收进折叠区，默认不出现。
 *     旧版把 3×15 个伤害类型微按钮平铺，光这一节就 45 个点击目标。
 *  3. 抗性改为「先选伤害类型，再点抗性/免疫/易伤」的两步式，而不是 45 个并排小方块。
 *  4. 每节保留原功能，只是默认收起；不删功能、不改语义。
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
  Bot, User, Wand2, Zap, Cross, ChevronDown, ChevronRight,
} from 'lucide-react';

/** 折叠区：默认收起，标题行显示摘要，点开才渲染内容 */
function Section({ title, summary, defaultOpen = false, children }: {
  title: string; summary?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border/40 bg-black/20">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
        {summary && !open && <span className="ml-auto font-normal text-[11px] opacity-70">{summary}</span>}
      </button>
      {open && <div className="border-t border-border/30 p-2">{children}</div>}
    </div>
  );
}

export function UnitDetailCard({ unitId, compact = false }: { unitId: string | null; compact?: boolean }) {
  const store = useBattleStore();
  const unit = store.units.find(u => u.id === unitId);
  const [amount, setAmount] = useState('');
  const [dmgType, setDmgType] = useState<DamageType | ''>('');

  if (!unit) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 p-5 text-center text-xs text-muted-foreground">
        点击地图上的 token 或先攻条中的单位查看详情
      </div>
    );
  }

  const meta = ATTITUDE_META[unit.attitude];
  const hpRatio = unit.maxHp > 0 ? Math.max(0, unit.hp) / unit.maxHp : 0;
  const amountNum = parseInt(amount, 10);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  /** 快捷伤害档位：常用固定值，避免每次都要输数字 */
  const QUICK_AMOUNTS = [5, 10, 20];

  const applyDamage = (n: number, type?: DamageType) => {
    if (!Number.isFinite(n) || n <= 0) return;
    store.damageUnit(unit.id, n, type ? { type } : undefined);
    setAmount('');
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-xl parchment-panel p-3">
      {/* ── 标题行 ── */}
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black text-black/80" style={{ background: meta.color }}>
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
            {unit.ac ? ` · AC ${unit.ac}` : ''}
            {unit.speed ? ` · ${effectiveSpeed(unit)} 尺` : ''}
          </div>
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-1 text-muted-foreground hover:text-red-400"
          onClick={() => store.removeUnit(unit.id)} title="移除单位">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* ── HP 条 + 核心操作（一屏可见，不折叠）── */}
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
            {unit.tempHp > 0 && <span className="text-[#8fdfc8]"> +{unit.tempHp}</span>}
          </span>
        </div>

        {/* 一个输入框 + 三个动词：扣 / 回 / 临时。旧版是两个输入框 + 三个按钮 */}
        <div className="flex items-center gap-1.5">
          <Input
            className="h-9 w-[68px] shrink-0 text-center text-sm tabular-nums"
            placeholder="数值"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            type="number"
            aria-label="伤害或治疗数值"
          />
          <Button size="sm" variant="destructive" className="h-9 flex-1 gap-1 px-2"
            disabled={!amountValid} onClick={() => applyDamage(amountNum, dmgType || undefined)}>
            <HeartCrack className="h-3.5 w-3.5" />扣血
          </Button>
          <Button size="sm" className="h-9 flex-1 gap-1 bg-green-700 px-2 hover:bg-green-600"
            disabled={!amountValid} onClick={() => { if (amountValid) { store.healUnit(unit.id, amountNum); setAmount(''); } }}>
            <HeartPulse className="h-3.5 w-3.5" />回血
          </Button>
          <Button size="sm" variant="secondary" className="h-9 gap-1 px-2" title="获得临时 HP（取最大值，不叠加）"
            disabled={!amountValid} onClick={() => { if (amountValid) { store.tempHpUnit(unit.id, amountNum); setAmount(''); } }}>
            <Shield className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* 快捷档位 + 伤害类型（只在扣血时用得上，所以并到这一行） */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10.5px] text-muted-foreground">快捷</span>
          {QUICK_AMOUNTS.map(n => (
            <button key={n} onClick={() => setAmount(String((amountNum || 0) + n))}
              className="rounded border border-border/50 px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
              +{n}
            </button>
          ))}
          <button onClick={() => setAmount('')} className="rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">清空</button>
          <div className="grow" />
          <label className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
            伤害类型
            <select
              className="rounded border border-border/50 bg-black/40 px-1 py-0.5 text-[11px] text-foreground"
              value={dmgType}
              onChange={e => setDmgType(e.target.value as DamageType | '')}
              title="选类型后扣血会走抗性/免疫/易伤结算"
            >
              <option value="">通用</option>
              {(Object.keys(DAMAGE_TYPE_META) as DamageType[]).map(dt => (
                <option key={dt} value={dt}>{DAMAGE_TYPE_META[dt].name}</option>
              ))}
            </select>
          </label>
        </div>

        {unit.knockedOut && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 p-2 text-[11.5px]">
            <span className="flex-1">留活口 · 1 HP 昏迷 · 已开始短休</span>
            <Button size="sm" variant="secondary" className="h-7 text-[11px]" onClick={() => store.stabilizeUnit(unit.id)}>急救唤醒</Button>
          </div>
        )}

        {unit.effects?.length ? (
          <div className="rounded-lg border border-border/40 p-2 text-[11.5px]">
            <strong>持续效果</strong>
            {unit.effects.map(effect => (
              <p key={effect.id} className="text-muted-foreground">
                {effect.name} · 来源 {store.units.find(u => u.id === effect.sourceId)?.name ?? effect.sourceId}
                {effect.remainingRounds !== undefined ? ` · 余${effect.remainingRounds}轮` : ''}
                {effect.repeatSave ? ` · ${effect.repeatSave.timing === 'end' ? '回合结束' : '回合开始'}豁免` : ''}
              </p>
            ))}
          </div>
        ) : null}

        {/* 死亡豁免：濒死时才出现，本身就不是常态 UI */}
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
                    aria-label={`第 ${i + 1} 次成功`}
                    className={cn('h-3.5 w-3.5 rounded-full border', i < (unit.deathSaves?.successes ?? 0) ? 'border-green-400 bg-green-500' : 'border-border bg-transparent')} />
                ))}
              </div>
              <span className="text-muted-foreground">失败</span>
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <button key={i} aria-label={`第 ${i + 1} 次失败`}
                    className={cn('h-3.5 w-3.5 rounded-full border', i < (unit.deathSaves?.failures ?? 0) ? 'border-red-400 bg-red-500' : 'border-border bg-transparent')} />
                ))}
              </div>
              {unit.deathSaves?.stable && <span className="text-green-400">已稳定</span>}
              {unit.deathSaves?.dead && <span className="font-bold text-red-400">已死亡</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── 状态：战斗中高频，保持展开但压缩成 chip 流 ── */}
      <div>
        <div className="mb-1 flex items-center gap-1">
          <span className="text-[11px] font-semibold text-muted-foreground">状态</span>
          {unit.concentration && <span className="status-chip" style={{ borderColor: 'rgba(94,176,201,.8)', color: '#5eb0c9', background: 'rgba(94,176,201,.15)' }}>专注 · {unit.concentration}</span>}
          {unit.statuses.length === 0 && !unit.concentration && <span className="text-[10.5px] text-muted-foreground/60">无</span>}
        </div>
        <div className="flex flex-wrap gap-1">
          {PROTOCOL_STATUSES.map(s => {
            const def = CONDITIONS[s];
            const active = unit.statuses.includes(s);
            return (
              <button
                key={s}
                onClick={() => store.toggleStatus(unit.id, s)}
                title={def.brief}
                aria-pressed={active}
                className={cn('status-chip transition-all', active ? 'scale-105 shadow-md' : 'opacity-45 hover:opacity-80')}
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
                  if (s === 'concentration') store.setConcentration(unit.id, active ? null : '法术');
                  else store.toggleStatus(unit.id, s);
                }}
                title={def.brief}
                aria-pressed={active}
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

      {/* ── 以下为低频区：默认折叠 ── */}

      {/* 行动逻辑 + 动作表（装配后基本不改） */}
      <Section
        title="行动逻辑与动作表"
        summary={unit.attitude === 0 && !unit.isPlayer ? (unit.playerControlled ? '玩家操控' : 'AI 托管') : unit.isPlayer ? '玩家角色' : '敌方 AI'}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {unit.attitude === 0 && !unit.isPlayer ? (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs" title="切换本队友回合由玩家手动操作或 AI 自动托管">
                <Switch checked={!!unit.playerControlled} onCheckedChange={() => store.togglePlayerControl(unit.id)} />
                {unit.playerControlled
                  ? <span className="flex items-center gap-1 font-medium text-amber-300"><User className="h-3.5 w-3.5" />玩家操控</span>
                  : <span className="flex items-center gap-1 font-medium text-emerald-300"><Bot className="h-3.5 w-3.5" />AI 托管</span>}
              </label>
            ) : unit.isPlayer ? (
              <span className="flex items-center gap-1 text-xs text-amber-300"><User className="h-3.5 w-3.5" />玩家角色（手动操控）</span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-red-300"><Bot className="h-3.5 w-3.5" />敌方 AI</span>
            )}
            <div className="grow" />
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              战术
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
          {unit.aiAbilities && unit.aiAbilities.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {unit.aiAbilities.map(a => {
                const icon = a.kind === 'heal' ? <Cross className="h-3 w-3" />
                  : a.kind === 'save-aoe' ? <Wand2 className="h-3 w-3" />
                  : a.kind === 'ranged' ? <Target className="h-3 w-3" />
                  : <Zap className="h-3 w-3" />;
                const desc = a.kind === 'heal'
                  ? `治 ${a.dice}${a.range > 5 ? ` · ${a.range}尺` : ''}`
                  : a.kind === 'save-aoe'
                    ? `${a.dice} · ${a.aoe ? `${a.aoe.size}尺` : ''}DC${a.saveDc ?? 13}${a.halfOnSuccess ? '半' : ''}`
                    : `${a.attackBonus !== undefined ? `+${a.attackBonus}` : ''} ${a.dice}${(a.multiAttack ?? 1) > 1 ? `×${a.multiAttack}` : ''}${a.range > 5 ? ` · ${a.range}尺` : ''}`;
                return (
                  <span key={a.id} title={a.note ?? a.name}
                    className="flex items-center gap-1 rounded-md border border-border/40 bg-black/30 px-1.5 py-0.5 text-[11px] text-foreground/85">
                    {icon}{a.name}<span className="text-muted-foreground">{desc}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      {/* 数值编辑（装配后基本不改） */}
      <Section title="数值编辑" summary={`AC ${unit.ac} · HP ${unit.maxHp} · 速 ${unit.speed} · 先攻 ${unit.init}`}>
        <div className="grid grid-cols-4 gap-1.5">
          {([
            ['先攻', 'init', unit.init],
            ['AC', 'ac', unit.ac],
            ['HP上限', 'maxHp', unit.maxHp],
            ['速度', 'speed', unit.speed],
          ] as const).map(([label, key, val]) => (
            <label key={key} className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">{label}</span>
              <Input className="h-8 border-border/50 bg-black/30 text-center text-sm" type="number" value={val}
                onChange={e => store.updateUnit(unit.id, { [key]: parseInt(e.target.value, 10) || 0 } as never)} />
            </label>
          ))}
        </div>
        {(unit.tempAcBonus ?? 0) > 0 && (
          <div className="mt-2 flex items-center gap-2 rounded border border-sky-500/40 bg-sky-950/30 px-2 py-1 text-[11px]">
            <span className="text-sky-300">临时 AC +{unit.tempAcBonus}（至其下回合开始）</span>
            <button type="button"
              className="ml-auto rounded border border-border/50 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-primary"
              onClick={() => store.updateUnit(unit.id, { tempAcBonus: 0 })}>
              清除
            </button>
          </div>
        )}
      </Section>

      {/* 属性值 */}
      <Section title="属性值" summary={(Object.keys(ABILITY_META) as AbilityKey[]).map(k => `${ABILITY_META[k].short}${unit.abilities?.[k] ?? 10}`).join(' ')}>
        <div className="grid grid-cols-6 gap-1">
          {(Object.keys(ABILITY_META) as AbilityKey[]).map(k => (
            <label key={k} className="flex flex-col items-center gap-0.5" title={`${ABILITY_META[k].name} 调整值 ${formatMod(abilityMod(unit.abilities?.[k] ?? 10))}`}>
              <span className="text-[11px] text-muted-foreground">{ABILITY_META[k].short}</span>
              <Input className="h-7 w-full border-border/50 bg-black/30 px-0.5 text-center text-xs" type="number"
                value={unit.abilities?.[k] ?? 10}
                onChange={e => store.updateUnit(unit.id, {
                  abilities: { ...unit.abilities, [k]: parseInt(e.target.value, 10) || 10 } as never,
                })} />
              <span className="text-[11px] font-bold text-primary">{formatMod(abilityMod(unit.abilities?.[k] ?? 10))}</span>
            </label>
          ))}
        </div>
      </Section>

      {/* 伤害调整：45 个并排方块 → 先选类型再点三个动词 */}
      <Section
        title="伤害调整"
        summary={[
          unit.resistances.length ? `抗 ${unit.resistances.length}` : '',
          unit.immunities.length ? `免 ${unit.immunities.length}` : '',
          unit.vulnerabilities.length ? `弱 ${unit.vulnerabilities.length}` : '',
        ].filter(Boolean).join(' · ') || '无'}
      >
        <DamageAdjuster unit={unit} />
      </Section>

      {/* 法术位 */}
      <Section
        title="法术位"
        summary={unit.spellSlots
          ? Object.entries(unit.spellSlots).sort((a, b) => Number(a[0]) - Number(b[0])).map(([lv, s]) => `${lv}环${s.current}/${s.max}`).join(' ')
          : '未设置'}
      >
        <SpellSlotEditor unitId={unit.id} />
      </Section>

      {/* 备注 */}
      <Section title="备注" summary={unit.notes ? unit.notes.slice(0, 18) + (unit.notes.length > 18 ? '…' : '') : '无'}>
        <textarea
          className="w-full rounded-lg border border-border/40 bg-black/30 p-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50"
          rows={3}
          aria-label="单位备注"
          placeholder="如：巢穴动作、传奇抗性、特殊攻击…"
          value={unit.notes ?? ''}
          onChange={e => store.updateUnit(unit.id, { notes: e.target.value })}
        />
      </Section>

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

/**
 * 伤害调整：先选一个伤害类型，再点抗性/免疫/易伤，一次只处理一种。
 * 旧版把 15 种类型 × 3 类调整 = 45 个微按钮同时铺开，误点率极高。
 */
function DamageAdjuster({ unit }: { unit: ReturnType<typeof useBattleStore.getState>['units'][number] }) {
  const store = useBattleStore();
  const [type, setType] = useState<DamageType>('fire');
  const lists = {
    resistances: unit.resistances,
    immunities: unit.immunities,
    vulnerabilities: unit.vulnerabilities,
  } as const;
  const toggle = (key: keyof typeof lists) => {
    const list = lists[key];
    const active = list.includes(type);
    store.updateUnit(unit.id, {
      [key]: active ? list.filter(x => x !== type) : [...list, type],
    } as never);
  };
  const ROWS = [
    ['resistances', '抗性 ×½', 'bg-sky-500/25 ring-sky-400/60'],
    ['immunities', '免疫 ×0', 'bg-emerald-500/25 ring-emerald-400/60'],
    ['vulnerabilities', '易伤 ×2', 'bg-red-500/25 ring-red-400/60'],
  ] as const;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {(Object.keys(DAMAGE_TYPE_META) as DamageType[]).map(dt => {
          const on = dt === type;
          return (
            <button key={dt} onClick={() => setType(dt)} aria-pressed={on}
              className={cn('rounded px-1.5 py-0.5 text-[11.5px] transition-colors',
                on ? 'bg-primary/25 text-foreground ring-1 ring-primary/60' : 'text-muted-foreground hover:text-foreground')}>
              {DAMAGE_TYPE_META[dt].icon} {DAMAGE_TYPE_META[dt].name}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1">
        {ROWS.map(([key, label, activeCls]) => {
          const active = lists[key].includes(type);
          return (
            <button key={key} onClick={() => toggle(key)} aria-pressed={active}
              className={cn('rounded border px-2 py-1 text-[11.5px] transition-all',
                active ? `${activeCls} border-transparent ring-1` : 'border-border/50 text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-[10.5px] text-muted-foreground/70">
        当前对「{DAMAGE_TYPE_META[type].name}」：{
          [lists.resistances.includes(type) && '抗性',
           lists.immunities.includes(type) && '免疫',
           lists.vulnerabilities.includes(type) && '易伤'].filter(Boolean).join(' + ') || '无调整'
        }
      </p>
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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {!slots ? (
          <>
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => initSlots([1, 2, 3])}>满施法者 1-3环</Button>
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => initSlots([1, 2, 3, 4, 5, 6, 7, 8, 9])}>1-9环</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => store.restoreSpellSlots(unitId, true)}>长休恢复</Button>
        )}
      </div>
      {slots && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(slots).sort((a, b) => Number(a[0]) - Number(b[0])).map(([lvStr, s]) => {
            const lv = Number(lvStr);
            return (
              <div key={lv} className="flex items-center gap-1 rounded-lg border border-border/40 bg-black/25 px-1.5 py-1">
                <span className="text-[11px] text-muted-foreground">{lv}环</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: s.max }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (i < s.current) store.spendSpellSlot(unitId, lv);
                        else store.updateUnit(unitId, { spellSlots: { ...slots, [lv]: { ...s, current: Math.min(s.max, i + 1) } } });
                      }}
                      aria-label={i < s.current ? `消耗 ${lv} 环（剩 ${s.current}）` : `恢复 ${lv} 环`}
                      className={cn('h-3 w-3 rounded-full border transition-colors',
                        i < s.current ? 'border-[#8fdfc8] bg-[#7fd6c0] shadow-[0_0_6px_rgba(127,214,192,0.65)]' : 'border-border bg-transparent')}
                    />
                  ))}
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  <b className="font-semibold text-foreground/80">{s.current}</b>/{s.max}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
