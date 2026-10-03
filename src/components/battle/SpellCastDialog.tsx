'use client';

/**
 * 通用施法弹窗（批次2 E6/T2）：未结构化法术（法术书上无战斗结构的已准备法术）的参数化施放入口。
 * 纯表单组件：提交时回调 onCast(合成动作, 实际施放环阶, 消耗法术位, 目标id)，由 ActionBar 负责写入单位并走 castAbility 现成结算分支。
 * 环阶选择列出有剩余法术位的环（升环代打）；也可取消勾选"消耗法术位"做叙事施放。
 */
import React, { useMemo, useState } from 'react';
import type { AiAbility, BattleUnit, DamageType } from '@/lib/engine/types';
import { DAMAGE_TYPE_META } from '@/lib/engine/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface GenericCastRequest {
  abilityId: string;
  name: string;
  baseLevel: number;
}

const KIND_OPTIONS: Array<{ v: AiAbility['kind']; label: string; defaultDice: string }> = [
  { v: 'ranged', label: '远程攻击', defaultDice: '2d6' },
  { v: 'melee', label: '近战攻击', defaultDice: '2d6' },
  { v: 'save', label: '单体豁免', defaultDice: '3d6' },
  { v: 'save-aoe', label: '范围豁免', defaultDice: '8d6' },
  { v: 'heal', label: '治疗', defaultDice: '2d8' },
];

const SAVE_ABILITIES: Array<{ v: string; label: string }> = [
  { v: 'str', label: '力量' }, { v: 'dex', label: '敏捷' }, { v: 'con', label: '体质' },
  { v: 'int', label: '智力' }, { v: 'wis', label: '感知' }, { v: 'cha', label: '魅力' },
];

const AOE_SHAPES: Array<{ v: string; label: string }> = [
  { v: 'sphere', label: '球体' }, { v: 'cube', label: '立方' }, { v: 'cone', label: '锥形' },
  { v: 'cylinder', label: '柱状' }, { v: 'line', label: '直线' },
];

export function SpellCastDialog({
  open, onOpenChange, actor, units, request, onCast,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  actor: BattleUnit;
  units: BattleUnit[];
  request: GenericCastRequest;
  onCast: (synth: AiAbility, castLevel: number, consumeSlot: boolean, targetId: string | null) => void;
}) {
  const base = request.baseLevel;
  const [kind, setKind] = useState<AiAbility['kind']>('save');
  const [formula, setFormula] = useState('3d6');
  const [damageType, setDamageType] = useState<DamageType>('fire');
  const [attackBonus, setAttackBonus] = useState(5);
  const [saveAbility, setSaveAbility] = useState('dex');
  const [saveDc, setSaveDc] = useState(13);
  const [half, setHalf] = useState(true);
  const [aoeShape, setAoeShape] = useState('sphere');
  const [aoeSize, setAoeSize] = useState(20);
  const [range, setRange] = useState(30);
  const [concentration, setConcentration] = useState(false);
  const [castLevel, setCastLevel] = useState(base > 0 ? base : 0);
  const [consumeSlot, setConsumeSlot] = useState(true);
  const [targetId, setTargetId] = useState<string | null>(null);

  // 可选环阶：基础环..9 中有余量的环（升环代打）；0 环法术只有 0
  const levelOptions = useMemo(() => {
    if (base <= 0) return [{ level: 0, current: 0 }];
    const out: Array<{ level: number; current: number }> = [];
    for (let lv = Math.max(1, base); lv <= 9; lv++) {
      const slot = actor.spellSlots?.[lv];
      if (slot && slot.current > 0) out.push({ level: lv, current: slot.current });
    }
    return out;
  }, [actor, base]);

  const needTarget = kind === 'melee' || kind === 'ranged' || kind === 'save' || kind === 'heal';
  const isSave = kind === 'save' || kind === 'save-aoe';
  const isAttack = kind === 'melee' || kind === 'ranged';

  // 目标候选：治疗选友方（含自己），攻击/豁免选敌方
  const targetOptions = useMemo(() => {
    if (!needTarget) return [];
    return units.filter(u => u.hp > 0 && !u.deathSaves?.dead && u.id !== actor.id)
      .filter(u => (kind === 'heal' ? u.attitude === 0 : u.attitude !== 0));
  }, [units, actor.id, kind, needTarget]);

  const canSubmit = !(base > 0 && consumeSlot && levelOptions.length === 0) && (!needTarget || targetId !== null);

  const submit = () => {
    const synth: AiAbility = {
      id: request.abilityId,
      name: request.name,
      kind,
      dice: formula.trim() || '0',
      damageType,
      range,
      spellLevel: castLevel,
      concentration: concentration || undefined,
      genericCast: true,
      ...(isAttack ? { attackBonus } : {}),
      ...(isSave ? { saveAbility: saveAbility as AiAbility['saveAbility'], saveDc, halfOnSuccess: half } : {}),
      ...(kind === 'save-aoe' ? { aoe: { kind: aoeShape as 'sphere', size: aoeSize } } : {}),
    };
    onCast(synth, castLevel, consumeSlot && base > 0, needTarget ? targetId : null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto bg-card text-card-foreground">
        <DialogHeader>
          <DialogTitle className="text-violet-300">◐ 通用施法 · {request.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">环阶{base > 0 ? `（基础 ${base} 环）` : '（戏法不耗位）'}</span>
            <select
              value={castLevel}
              onChange={e => setCastLevel(Number(e.target.value))}
              className="rounded border border-border/60 bg-background/60 px-2 py-1"
            >
              {levelOptions.map(o => (
                <option key={o.level} value={o.level}>
                  {o.level === 0 ? '戏法（不耗位）' : `${o.level} 环（余 ${o.current}）${o.level > base ? ' · 升环' : ''}`}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-1">
            {KIND_OPTIONS.map(o => (
              <button
                key={o.v + o.label}
                type="button"
                onClick={() => { setKind(o.v); setFormula(o.defaultDice); }}
                className={cn('rounded border px-2 py-1', kind === o.v ? 'border-violet-400 bg-violet-500/20' : 'border-border/40')}
              >
                {o.label}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{kind === 'heal' ? '治疗公式' : '伤害公式'}（如 8d6、2d4+3；纯控制填 0）</span>
            <input value={formula} onChange={e => setFormula(e.target.value)} className="rounded border border-border/60 bg-background/60 px-2 py-1 font-mono" />
          </label>

          {kind !== 'heal' && (
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">伤害类型</span>
              <select value={damageType} onChange={e => setDamageType(e.target.value as DamageType)} className="rounded border border-border/60 bg-background/60 px-2 py-1">
                {Object.entries(DAMAGE_TYPE_META).map(([k, meta]) => (
                  <option key={k} value={k}>{meta.name}</option>
                ))}
              </select>
            </label>
          )}

          {isAttack && (
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">命中加值（熟练+施法属性调整，如 3 级智力法士=5）</span>
              <input type="number" value={attackBonus} onChange={e => setAttackBonus(Number(e.target.value) || 0)} className="rounded border border-border/60 bg-background/60 px-2 py-1 font-mono" />
            </label>
          )}

          {isSave && (
            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-muted-foreground">豁免属性</span>
                <select value={saveAbility} onChange={e => setSaveAbility(e.target.value)} className="rounded border border-border/60 bg-background/60 px-2 py-1">
                  {SAVE_ABILITIES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-muted-foreground">豁免 DC（8+熟练+属性）</span>
                <input type="number" value={saveDc} onChange={e => setSaveDc(Number(e.target.value) || 13)} className="rounded border border-border/60 bg-background/60 px-2 py-1 font-mono" />
              </label>
            </div>
          )}

          {isSave && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={half} onChange={e => setHalf(e.target.checked)} />
              <span className="text-muted-foreground">豁免成功减半</span>
            </label>
          )}

          {kind === 'save-aoe' && (
            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-muted-foreground">AoE 形状</span>
                <select value={aoeShape} onChange={e => setAoeShape(e.target.value)} className="rounded border border-border/60 bg-background/60 px-2 py-1">
                  {AOE_SHAPES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-muted-foreground">尺寸（尺）</span>
                <input type="number" value={aoeSize} onChange={e => setAoeSize(Number(e.target.value) || 20)} className="rounded border border-border/60 bg-background/60 px-2 py-1 font-mono" />
              </label>
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">射程（尺）</span>
            <input type="number" value={range} onChange={e => setRange(Number(e.target.value) || 0)} className="rounded border border-border/60 bg-background/60 px-2 py-1 font-mono" />
          </label>

          {needTarget && (
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">目标{kind === 'heal' ? '（友方/自己）' : '（敌方）'}</span>
              <select value={targetId ?? ''} onChange={e => setTargetId(e.target.value || null)} className="rounded border border-border/60 bg-background/60 px-2 py-1">
                <option value="">— 选择目标 —</option>
                {targetOptions.map(u => (
                  <option key={u.id} value={u.id}>{u.name}（{u.hp}/{u.maxHp}）</option>
                ))}
              </select>
            </label>
          )}
          {kind === 'save-aoe' && (
            <p className="text-[10px] text-muted-foreground">范围豁免：不选目标时以施法者自身为中心落点（可选目标时以其位置为原点）。</p>
          )}

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={concentration} onChange={e => setConcentration(e.target.checked)} />
            <span className="text-muted-foreground">需要专注</span>
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={consumeSlot} onChange={e => setConsumeSlot(e.target.checked)} disabled={base <= 0} />
            <span className="text-muted-foreground">消耗法术位（取消 = 叙事施放不耗位）</span>
          </label>

          <Button
            className="mt-1 w-full bg-violet-600 hover:bg-violet-500"
            onClick={submit}
            disabled={!canSubmit}
          >
            {!canSubmit
              ? (base > 0 && consumeSlot && levelOptions.length === 0 ? '无可用法术位' : '请选择目标')
              : `施放${castLevel > base ? `（以 ${castLevel} 环）` : ''}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
