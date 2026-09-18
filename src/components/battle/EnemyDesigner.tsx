'use client';

/**
 * 敌人设计师：设计完整敌卡（AC/六维/动作表/抗性/AI 档案）
 * - 从预设/图鉴载入为起点，或从零创建
 * - 保存图鉴（localStorage）/ 暂存（<battle> 触发时自动配装）/ 直接上阵
 * - 导出 JSON / <encounter> 块
 */
import React, { useMemo, useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import type { AiAbility, AiAbilityKind, AIProfile, DamageType, Size } from '@/lib/engine/types';
import { AI_ABILITY_KIND_META, AI_PROFILE_META, DAMAGE_TYPE_META, SIZE_META } from '@/lib/engine/types';
import { statblockFromPreset, statblockToJson, statblockFromJson, type StatblockDef } from '@/lib/engine/statblocks';
import { MONSTER_PRESETS } from '@/lib/engine/presets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Plus, Trash2, Save, Layers, Swords, Download, Upload, Copy, BookMarked } from 'lucide-react';

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const ABILITY_NAMES: Record<string, string> = { str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力' };
const SAVE_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const ALL_DAMAGE_TYPES = Object.keys(DAMAGE_TYPE_META) as DamageType[];
const AOE_KINDS = ['sphere', 'circle', 'cone', 'line', 'cube', 'cylinder'] as const;

function emptyAbility(idx: number): AiAbility {
  return { id: `a${idx}-new`, name: '', kind: 'melee', attackBonus: 4, dice: '1d6+2', damageType: 'slashing', range: 5, multiAttack: 1 };
}

function emptyDef(): StatblockDef {
  return {
    id: `sb-自定义${Math.floor(Math.random() * 900 + 100)}`,
    name: '新敌人',
    size: 'medium',
    cr: 1,
    ac: 13,
    hp: 20,
    speed: 30,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    attacks: [emptyAbility(0)],
    resistances: [],
    immunities: [],
    vulnerabilities: [],
    aiProfile: 'tactical',
  };
}

export function EnemyDesigner() {
  const store = useBattleStore();
  const [def, setDef] = useState<StatblockDef>(emptyDef);
  const [jsonText, setJsonText] = useState('');
  const [showJson, setShowJson] = useState(false);

  const patch = (p: Partial<StatblockDef>) => setDef(d => ({ ...d, ...p }));
  const patchAbility = (idx: number, p: Partial<AiAbility>) => {
    setDef(d => ({ ...d, attacks: d.attacks.map((a, i) => (i === idx ? { ...a, ...p } : a)) }));
  };
  const toggleDamage = (field: 'resistances' | 'immunities' | 'vulnerabilities', t: DamageType) => {
    setDef(d => {
      const list = d[field];
      return { ...d, [field]: list.includes(t) ? list.filter(x => x !== t) : [...list, t] };
    });
  };

  const loadPreset = (name: string) => {
    const p = MONSTER_PRESETS.find(x => x.name === name);
    if (p) setDef(statblockFromPreset(p));
  };

  const damageChips = (field: 'resistances' | 'immunities' | 'vulnerabilities', label: string) => (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">
        {ALL_DAMAGE_TYPES.map(t => {
          const on = def[field].includes(t);
          return (
            <button
              key={t}
              onClick={() => toggleDamage(field, t)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                on ? 'bg-amber-500/25 text-amber-200' : 'bg-black/30 text-muted-foreground hover:bg-black/50',
              )}
            >
              {DAMAGE_TYPE_META[t].icon}{DAMAGE_TYPE_META[t].name}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* 载入起点 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">从预设载入：</span>
        <select
          className="h-7 rounded-md border border-border/50 bg-black/40 px-1.5 text-[11px] focus:border-primary/50 focus:outline-none"
          value=""
          onChange={e => { if (e.target.value) loadPreset(e.target.value); }}
        >
          <option value="">选择预设…</option>
          {MONSTER_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}（CR {p.cr}）</option>)}
        </select>
        <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-[10px]" onClick={() => setDef(emptyDef())}>
          <Plus className="h-3 w-3" />从零新建
        </Button>
      </div>

      {/* 基础属性 */}
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
        <label className="col-span-2 flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">名称</span>
          <Input className="h-8 border-border/50 bg-black/30 text-sm" value={def.name}
            onChange={e => patch({ name: e.target.value, id: `sb-${e.target.value}` })} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">体型</span>
          <select className="h-8 rounded-md border border-border/50 bg-black/30 px-1.5 text-sm focus:border-primary/50 focus:outline-none"
            value={def.size} onChange={e => patch({ size: e.target.value as Size })}>
            {(Object.keys(SIZE_META) as Size[]).map(s => <option key={s} value={s}>{SIZE_META[s].name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">战术档案</span>
          <select className="h-8 rounded-md border border-border/50 bg-black/30 px-1.5 text-sm focus:border-primary/50 focus:outline-none"
            value={def.aiProfile} onChange={e => patch({ aiProfile: e.target.value as AIProfile })}>
            {(Object.keys(AI_PROFILE_META) as AIProfile[]).map(p => (
              <option key={p} value={p} title={AI_PROFILE_META[p].desc}>{AI_PROFILE_META[p].label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-4 gap-1.5 md:grid-cols-5">
        {([['CR', 'cr'], ['AC', 'ac'], ['HP', 'hp'], ['速度', 'speed']] as const).map(([label, key]) => (
          <label key={key} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">{label}</span>
            <Input className="h-8 border-border/50 bg-black/30 text-center text-sm" type="number"
              value={def[key]} onChange={e => patch({ [key]: parseFloat(e.target.value) || 0 } as Partial<StatblockDef>)} />
          </label>
        ))}
        {ABILITY_KEYS.map(k => (
          <label key={k} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">{ABILITY_NAMES[k]}</span>
            <Input className="h-8 border-border/50 bg-black/30 text-center text-sm" type="number"
              value={def.abilities[k]} onChange={e => patch({ abilities: { ...def.abilities, [k]: parseInt(e.target.value, 10) || 10 } })} />
          </label>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {damageChips('resistances', '抗性 ×½')}
        {damageChips('immunities', '免疫 ×0')}
        {damageChips('vulnerabilities', '易伤 ×2')}
      </div>

      {/* 动作表 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            <Swords className="h-3.5 w-3.5" />动作表（{def.attacks.length}）
          </span>
          <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-[10px]"
            onClick={() => setDef(d => ({ ...d, attacks: [...d.attacks, emptyAbility(d.attacks.length)] }))}>
            <Plus className="h-3 w-3" />添加动作
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {def.attacks.map((a, idx) => (
            <div key={idx} className="rounded-lg border border-border/40 bg-black/25 p-2">
              <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                <Input className="h-7 border-border/50 bg-black/30 text-xs" placeholder="动作名称（如 弯刀）"
                  value={a.name} onChange={e => patchAbility(idx, { name: e.target.value, id: `a${idx}-${e.target.value}` })} />
                <button className="rounded p-1 text-muted-foreground hover:bg-red-500/20 hover:text-red-300"
                  onClick={() => setDef(d => ({ ...d, attacks: d.attacks.filter((_, i) => i !== idx) }))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5 md:grid-cols-6">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-muted-foreground">类型</span>
                  <select className="h-7 rounded border border-border/50 bg-black/30 px-1 text-[11px] focus:outline-none"
                    value={a.kind} onChange={e => patchAbility(idx, { kind: e.target.value as AiAbilityKind })}>
                    {(Object.keys(AI_ABILITY_KIND_META) as AiAbilityKind[]).map(k => (
                      <option key={k} value={k}>{AI_ABILITY_KIND_META[k].icon}{AI_ABILITY_KIND_META[k].label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-muted-foreground">命中加值</span>
                  <Input className="h-7 border-border/50 bg-black/30 text-center text-[11px]" type="number"
                    value={a.attackBonus ?? 0} onChange={e => patchAbility(idx, { attackBonus: parseInt(e.target.value, 10) || 0 })} />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-muted-foreground">伤害/治疗</span>
                  <Input className="h-7 border-border/50 bg-black/30 text-center font-mono text-[11px]" placeholder="1d6+2"
                    value={a.dice} onChange={e => patchAbility(idx, { dice: e.target.value })} />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-muted-foreground">伤害类型</span>
                  <select className="h-7 rounded border border-border/50 bg-black/30 px-1 text-[11px] focus:outline-none"
                    value={a.damageType ?? 'slashing'} onChange={e => patchAbility(idx, { damageType: e.target.value as DamageType })}>
                    {ALL_DAMAGE_TYPES.map(t => <option key={t} value={t}>{DAMAGE_TYPE_META[t].name}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-muted-foreground">射程(尺)</span>
                  <Input className="h-7 border-border/50 bg-black/30 text-center text-[11px]" type="number"
                    value={a.range} onChange={e => patchAbility(idx, { range: parseInt(e.target.value, 10) || 5 })} />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-muted-foreground">多重攻击</span>
                  <Input className="h-7 border-border/50 bg-black/30 text-center text-[11px]" type="number" min={1}
                    value={a.multiAttack ?? 1} onChange={e => patchAbility(idx, { multiAttack: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                </label>
              </div>
              {['save-aoe', 'save'].includes(a.kind) && (
                <div className="mt-1.5 grid grid-cols-3 gap-1.5 md:grid-cols-5">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] text-muted-foreground">豁免属性</span>
                    <select className="h-7 rounded border border-border/50 bg-black/30 px-1 text-[11px] focus:outline-none"
                      value={a.saveAbility ?? 'dex'} onChange={e => patchAbility(idx, { saveAbility: e.target.value as typeof SAVE_KEYS[number] })}>
                      {SAVE_KEYS.map(k => <option key={k} value={k}>{ABILITY_NAMES[k]}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] text-muted-foreground">DC</span>
                    <Input className="h-7 border-border/50 bg-black/30 text-center text-[11px]" type="number"
                      value={a.saveDc ?? 13} onChange={e => patchAbility(idx, { saveDc: parseInt(e.target.value, 10) || 13 })} />
                  </label>
                  <label className="flex items-end gap-1 pb-1 text-[10px]">
                    <input type="checkbox" className="accent-primary" checked={a.halfOnSuccess ?? false}
                      onChange={e => patchAbility(idx, { halfOnSuccess: e.target.checked })} />
                    豁免半伤
                  </label>
                  {a.kind === 'save-aoe' && (
                    <>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-muted-foreground">AoE 形状</span>
                        <select className="h-7 rounded border border-border/50 bg-black/30 px-1 text-[11px] focus:outline-none"
                          value={a.aoe?.kind ?? 'sphere'} onChange={e => patchAbility(idx, { aoe: { kind: e.target.value as typeof AOE_KINDS[number], size: a.aoe?.size ?? 20 } })}>
                          {AOE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-muted-foreground">AoE 尺寸(尺)</span>
                        <Input className="h-7 border-border/50 bg-black/30 text-center text-[11px]" type="number"
                          value={a.aoe?.size ?? 20} onChange={e => patchAbility(idx, { aoe: { kind: a.aoe?.kind ?? 'sphere', size: parseInt(e.target.value, 10) || 20 } })} />
                      </label>
                    </>
                  )}
                </div>
              )}
              {a.kind === 'save' && (
                <label className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                  豁免失败附加状态：
                  <Input className="h-7 w-28 border-border/50 bg-black/30 text-[11px]" placeholder="如 paralyzed"
                    value={a.applyStatus ?? ''} onChange={e => patchAbility(idx, { applyStatus: e.target.value || undefined })} />
                  <span className="text-muted-foreground">（引擎状态 key：paralyzed/restrained/frightened…）</span>
                </label>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 操作 */}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" className="h-8 gap-1 bg-primary text-[11px] text-primary-foreground" onClick={() => store.addUnitFromStatblock(def, true)}>
          <Swords className="h-3.5 w-3.5" />上阵（敌方）
        </Button>
        <Button size="sm" variant="secondary" className="h-8 gap-1 text-[11px]" onClick={() => store.addUnitFromStatblock(def, false)}>
          <Swords className="h-3.5 w-3.5" />上阵（友方）
        </Button>
        <Button size="sm" variant="secondary" className="h-8 gap-1 text-[11px]" onClick={() => { store.stageStatblockDefs([def]); }}>
          <Layers className="h-3.5 w-3.5" />暂存待战
        </Button>
        <Button size="sm" variant="secondary" className="h-8 gap-1 text-[11px]" onClick={() => store.bestiaryUpsert(def)}>
          <Save className="h-3.5 w-3.5" />存入图鉴
        </Button>
        <Button size="sm" variant="secondary" className="h-8 gap-1 text-[11px]" onClick={() => { setJsonText(statblockToJson(def)); setShowJson(v => !v); }}>
          <Download className="h-3.5 w-3.5" />JSON
        </Button>
      </div>

      {/* JSON 导入导出 */}
      {showJson && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/40 bg-black/30 p-2">
          <textarea
            className="log-scroll h-32 w-full resize-none rounded border border-border/50 bg-black/50 p-2 font-mono text-[10px] text-foreground focus:border-primary/50 focus:outline-none"
            value={jsonText}
            onChange={e => setJsonText(e.target.value)}
            placeholder="敌卡 JSON（可粘贴修改后导入）"
          />
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" className="h-7 gap-1 text-[10px]"
              onClick={() => { const d = statblockFromJson(jsonText); if (d) setDef(d); }}>
              <Upload className="h-3 w-3" />导入此 JSON
            </Button>
            <Button size="sm" variant="secondary" className="h-7 gap-1 text-[10px]" onClick={() => navigator.clipboard?.writeText(jsonText)}>
              <Copy className="h-3 w-3" />复制
            </Button>
          </div>
        </div>
      )}

      {/* 暂存区 */}
      <StagedPanel />
    </div>
  );
}

function StagedPanel() {
  const store = useBattleStore();
  const staged = store.stagedStatblocks;
  const bestiary = store.bestiary;

  if (staged.length === 0 && bestiary.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-black/20 p-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
          <Layers className="h-3.5 w-3.5" />遭遇暂存区（{staged.length}）· <b className="text-foreground/80">&lt;battle&gt;</b> 触发时自动配装
        </span>
        {staged.length > 0 && (
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => navigator.clipboard?.writeText(store.generateEncounterText())}>
              <Copy className="h-3 w-3" />复制 &lt;encounter&gt;
            </Button>
            <Button size="sm" variant="secondary" className="h-6 px-2 text-[10px] hover:bg-red-500/20"
              onClick={() => store.clearStagedStatblocks()}>
              清空
            </Button>
          </div>
        )}
      </div>
      {staged.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {staged.map(d => (
            <div key={d.id} className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px]">
              <span className="font-semibold text-amber-200">{d.name}</span>
              <span className="text-muted-foreground">CR{d.cr} · AC{d.ac} · HP{d.hp}</span>
              <button className="text-primary hover:underline" onClick={() => store.addUnitFromStatblock(d, true)}>上阵</button>
            </div>
          ))}
        </div>
      )}
      {bestiary.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
            <BookMarked className="h-3 w-3" />自定义图鉴（{bestiary.length}）
          </span>
          <div className="flex flex-wrap gap-1.5">
            {bestiary.map(d => (
              <div key={d.id} className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/60 px-2 py-1 text-[11px]">
                <span className="font-semibold">{d.name}</span>
                <span className="text-muted-foreground">CR{d.cr}</span>
                <button className="text-primary hover:underline" onClick={() => store.addUnitFromStatblock(d, true)}>上阵</button>
                <button className="text-muted-foreground hover:text-red-300" title="删除"
                  onClick={() => store.bestiaryRemove(d.id)}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
