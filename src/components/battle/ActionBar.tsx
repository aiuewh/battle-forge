'use client';

/**
 * 行动栏：当前玩家操控单位的完整行动选项
 * - 动作经济：移动条 + 动作/附赠/反应状态
 * - 武器攻击（自动掩护/优劣势/多重攻击）
 * - 法术（环位消耗检查 + 专注标记 + AoE/单体豁免/治疗）
 * - 通用动作：冲刺/闪避/脱离/隐藏/协助/预备/治疗药水
 * - 目标选择：射程内高亮、超距禁用
 */
import React, { useMemo, useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import type { AiAbility, BattleUnit } from '@/lib/engine/types';
import { AI_ABILITY_KIND_META, DAMAGE_TYPE_META, SIZE_META } from '@/lib/engine/types';
import { effectiveSpeed } from '@/lib/engine/rules';
import { unitDistance } from '@/lib/engine/geometry';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Swords, Wand2, Footprints, Zap, Wind, Shield, DoorOpen, EyeOff,
  HelpingHand, Timer, FlaskConical, ChevronsRight, Bot, User,
} from 'lucide-react';

interface PendingAction {
  ability: AiAbility;
}

export function ActionBar({ compact = false }: { compact?: boolean }) {
  const store = useBattleStore();
  const { units, turn, battleActive } = store;
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [helpMode, setHelpMode] = useState(false);

  // 行动者：战斗中 = 当前玩家操控单位；非战斗 = 选中的友方单位
  const currentUnit = units.find(u => u.id === turn.currentUnitId);
  const selected = units.find(u => u.id === store.selectedId);
  const actor: BattleUnit | undefined = useMemo(() => {
    if (battleActive && currentUnit) return currentUnit;
    if (selected && selected.attitude === 0) return selected;
    return units.find(u => u.attitude === 0 && u.playerControlled) ?? units.find(u => u.attitude === 0);
  }, [battleActive, currentUnit, selected, units]);

  const actorIsCurrent = !!actor && battleActive && turn.currentUnitId === actor.id;
  const actorControllable = !!actor && actor.attitude === 0 && (actor.isPlayer || actor.playerControlled);
  const actorAlive = !!actor && actor.hp > 0 && !actor.deathSaves?.dead;

  const abilities = actor?.aiAbilities ?? [];
  const weapons = abilities.filter(a => (a.kind === 'melee' || a.kind === 'ranged') && a.spellLevel === undefined);
  const spells = abilities.filter(a => a.spellLevel !== undefined);
  const specials = abilities.filter(a => ['save', 'save-aoe', 'heal'].includes(a.kind) && a.spellLevel === undefined);

  // 多重攻击余量：击杀后引擎挂起等待重选目标（仅对 queued 的当前行动者生效）
  const multiQueue = store.multiAttackQueue;
  const queuedAbility = multiQueue && multiQueue.actorId === actor?.id
    ? abilities.find(a => a.id === multiQueue.abilityId) ?? null
    : null;
  const queueActive = !!multiQueue && !!queuedAbility && multiQueue.remaining > 0 && actorAlive;

  // 渲染期重置：行动者 / 回合 / 待执行动作 / 余量队列变化时清空手动目标选择（React render-time 调整模式）
  const [ctxKey, setCtxKey] = useState('');
  const resetKey = `${actor?.id ?? '-'}|${turn.round}|${pending?.ability.id ?? ''}|${multiQueue?.abilityId ?? ''}|${multiQueue?.remaining ?? ''}|${helpMode ? 'h' : ''}`;
  if (resetKey !== ctxKey) {
    setCtxKey(resetKey);
    setTargetId(null);
  }

  const living = units.filter(u => u.hp > 0 && !u.deathSaves?.dead);
  const enemies = living.filter(u => u.attitude === 2);
  const allies = living.filter(u => u.attitude === 0);

  // 动作经济展示
  const eco = actor?.actionEconomy;
  const speed = actor ? effectiveSpeed(actor) : 30;
  const moveLeft = actor ? Math.max(0, speed - (eco?.movementUsed ?? 0)) : 0;
  const movePct = Math.min(100, speed > 0 ? (moveLeft / speed) * 100 : 0);

  // 法术位摘要
  const slotSummary = useMemo(() => {
    if (!actor?.spellSlots) return [];
    return Object.entries(actor.spellSlots)
      .map(([lv, s]) => ({ level: Number(lv), ...s }))
      .filter(s => s.max > 0)
      .sort((a, b) => a.level - b.level);
  }, [actor]);

  // 目标候选（手动 pending 与多重攻击余量队列共用一套目标选择）
  const activeAbility = pending?.ability ?? queuedAbility;
  const targetCandidates = useMemo(() => {
    if (!activeAbility || !actor) return [];
    const a = activeAbility;
    let cands: BattleUnit[] = [];
    if (a.kind === 'heal') cands = allies;
    else if (a.kind === 'save-aoe') cands = living; // AoE 落点可以是任何单位位置
    else cands = enemies;
    return cands.map(u => ({
      unit: u,
      dist: unitDistance(actor, u, store.mapConfig.diagonal),
      inRange: unitDistance(actor, u, store.mapConfig.diagonal) <= a.range + 5,
    }));
  }, [activeAbility, pending, queuedAbility, actor, enemies, allies, living, store.mapConfig.diagonal]);

  // 派生：唯一合法目标自动选中（不写 effect，直接推导）
  const validCands = targetCandidates.filter(c => c.inRange);
  const autoTargetId = validCands.length === 1 ? validCands[0].unit.id : null;
  const effectiveTargetId = targetId ?? autoTargetId;

  if (!actor) return null;

  const canActFree = !battleActive || !actorIsCurrent; // 非当前回合/非战斗 → 自由结算（不消耗）
  const blocked = battleActive && actorIsCurrent && !actorControllable;

  const startAction = (ability: AiAbility) => {
    setHelpMode(false);
    setPending({ ability });
  };

  const execute = () => {
    if (!pending) return;
    store.castAbility(actor.id, pending.ability.id, effectiveTargetId, { ignoreEconomy: canActFree ? false : undefined });
    setPending(null);
    setTargetId(null);
  };

  const doPlayerAction = (kind: Parameters<typeof store.playerAction>[0]) => {
    if (helpMode && kind === 'help') {
      if (effectiveTargetId) store.playerAction('help', actor.id, effectiveTargetId);
      setHelpMode(false);
      setTargetId(null);
      return;
    }
    store.playerAction(kind, actor.id, null);
  };

  const abilityLabel = (a: AiAbility) => {
    const parts: string[] = [];
    if (a.attackBonus !== undefined) parts.push(`+${a.attackBonus}`);
    if (a.dice && a.dice !== '0') parts.push(a.dice);
    if (a.damageType) parts.push(DAMAGE_TYPE_META[a.damageType].name);
    return parts.join(' · ');
  };

  const slotOk = (a: AiAbility) => (a.spellLevel ?? 0) === 0 || !!actor.spellSlots?.[a.spellLevel!]?.current;

  const econDisabled = (a: AiAbility) => {
    if (canActFree) return false;
    if (!battleActive || !actorIsCurrent) return false;
    if (a.bonusAction) return eco?.bonus ?? false;
    return eco?.action ?? false;
  };

  return (
    <div className={cn('flex flex-col gap-2.5', compact && 'gap-2')}>
      {/* ===== 头部：行动者 + 动作经济 ===== */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn('truncate text-sm font-bold', actor.attitude === 0 ? 'text-sky-300' : 'text-red-300')}>
            {actor.name}
          </span>
          <span className="rounded bg-black/40 px-1 py-0.5 text-[10px] text-muted-foreground">
            {SIZE_META[actor.size].name}{actor.level ? ` · Lv.${actor.level}` : actor.cr ? ` · CR ${actor.cr}` : ''}
          </span>
          {actor.isPlayer || actor.playerControlled ? (
            <User className="h-3.5 w-3.5 text-sky-300" />
          ) : (
            <Bot className="h-3.5 w-3.5 text-amber-300" />
          )}
        </div>

        {/* 移动条 */}
        <div className="flex items-center gap-1.5" title={`移动力 ${moveLeft}/${speed} 尺`}>
          <Footprints className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-black/50">
            <div
              className={cn('h-full rounded-full transition-all', movePct > 40 ? 'bg-sky-400' : movePct > 0 ? 'bg-amber-400' : 'bg-red-500/60')}
              style={{ width: `${movePct}%` }}
            />
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">{moveLeft}/{speed}</span>
        </div>

        {/* 动作/附赠/反应 */}
        <div className="flex items-center gap-1">
          {([['动作', 'action'], ['附赠', 'bonus'], ['反应', 'reaction']] as const).map(([label, key]) => {
            const used = eco?.[key] ?? false;
            return (
              <span
                key={key}
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors',
                  used ? 'bg-black/50 text-muted-foreground line-through' : 'bg-emerald-500/15 text-emerald-300',
                )}
              >
                {label}
              </span>
            );
          })}
        </div>

        <div className="grow" />
        {battleActive && actorIsCurrent && actorControllable && (
          <Button
            size="sm"
            className="h-7 gap-1 bg-primary px-3 text-[11px] text-primary-foreground hover:bg-primary/85"
            onClick={() => { setPending(null); store.nextTurn(); }}
          >
            <ChevronsRight className="h-3.5 w-3.5" />结束回合
          </Button>
        )}
      </div>

      {/* 法术位摘要 */}
      {slotSummary.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <Wand2 className="h-3 w-3 text-muted-foreground" />
          {slotSummary.map(s => (
            <span
              key={s.level}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px]',
                s.current === 0 ? 'bg-black/40 text-muted-foreground' : 'bg-violet-500/15 text-violet-300',
              )}
              title={`${s.level} 环法术位`}
            >
              {s.level}环 {s.current}/{s.max}
            </span>
          ))}
          {actor.concentration && (
            <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-300" title="专注中：受伤需体质豁免 DC=max(10, 伤害÷2)">
              🎯 专注：{actor.concentration}
            </span>
          )}
        </div>
      )}

      {blocked && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          <Bot className="mr-1 inline h-3.5 w-3.5" />
          AI 托管中 —— 在单位详情卡或先攻条切换为「玩家操控」即可手动操作
        </div>
      )}
      {!actorAlive && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          {actor.hp <= 0 ? '濒死状态 —— 需死亡豁免或等待治疗' : '已阵亡'}
        </div>
      )}

      {/* ===== 武器/攻击 ===== */}
      {weapons.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Swords className="h-3 w-3" />武器攻击
          </div>
          <div className="flex flex-wrap gap-1.5">
            {weapons.map(a => {
              const disabled = econDisabled(a) || !actorAlive || !slotOk(a);
              return (
                <button
                  key={a.id}
                  disabled={disabled}
                  onClick={() => startAction(a)}
                  className={cn(
                    'flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-all',
                    pending?.ability.id === a.id
                      ? 'border-primary bg-primary/20'
                      : 'border-border/40 bg-card/60 hover:border-primary/60 hover:bg-primary/10',
                    disabled && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <span className="text-xs font-semibold">
                    {AI_ABILITY_KIND_META[a.kind].icon} {a.name}
                    {(a.multiAttack ?? 1) > 1 && <span className="ml-1 text-[10px] text-amber-300">×{a.multiAttack}</span>}
                    {a.range > 5 && <span className="ml-1 text-[10px] text-muted-foreground">{a.range}尺</span>}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">{abilityLabel(a)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== 法术 ===== */}
      {spells.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Wand2 className="h-3 w-3" />法术
          </div>
          <div className="flex flex-wrap gap-1.5">
            {spells.map(a => {
              const lvl = a.spellLevel ?? 0;
              const noSlot = !slotOk(a);
              const disabled = econDisabled(a) || !actorAlive || noSlot;
              return (
                <button
                  key={a.id}
                  disabled={disabled}
                  onClick={() => startAction(a)}
                  title={noSlot ? `${lvl} 环法术位不足` : AI_ABILITY_KIND_META[a.kind].hint}
                  className={cn(
                    'flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-all',
                    pending?.ability.id === a.id
                      ? 'border-violet-400 bg-violet-500/20'
                      : 'border-border/40 bg-card/60 hover:border-violet-400/60 hover:bg-violet-500/10',
                    disabled && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <span className="text-xs font-semibold">
                    {AI_ABILITY_KIND_META[a.kind].icon} {a.name}
                    <span className={cn('ml-1 rounded px-1 text-[9px]', lvl === 0 ? 'bg-emerald-500/20 text-emerald-300' : noSlot ? 'bg-red-500/20 text-red-300' : 'bg-violet-500/20 text-violet-300')}>
                      {lvl === 0 ? '戏法' : `${lvl}环`}
                    </span>
                    {a.bonusAction && <span className="ml-1 text-[9px] text-amber-300">附赠</span>}
                    {a.concentration && <span className="ml-1 text-[9px] text-cyan-300">🎯专注</span>}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {abilityLabel(a)}
                    {a.saveDc !== undefined && a.saveAbility ? ` · DC${a.saveDc}${a.halfOnSuccess ? ' 半伤' : ''}` : ''}
                    {a.range > 0 ? ` · ${a.range}尺` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== 特殊动作（龙息/天生武器等） ===== */}
      {specials.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Zap className="h-3 w-3" />特殊动作
          </div>
          <div className="flex flex-wrap gap-1.5">
            {specials.map(a => {
              const disabled = econDisabled(a) || !actorAlive;
              return (
                <button
                  key={a.id}
                  disabled={disabled}
                  onClick={() => startAction(a)}
                  title={AI_ABILITY_KIND_META[a.kind].hint}
                  className={cn(
                    'flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-all',
                    pending?.ability.id === a.id ? 'border-orange-400 bg-orange-500/20' : 'border-border/40 bg-card/60 hover:border-orange-400/60 hover:bg-orange-500/10',
                    disabled && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <span className="text-xs font-semibold">{AI_ABILITY_KIND_META[a.kind].icon} {a.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {abilityLabel(a)}
                    {a.saveDc !== undefined && a.saveAbility ? ` · DC${a.saveDc}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== 通用动作 ===== */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Footprints className="h-3 w-3" />通用动作
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([
            ['dash', '冲刺', Wind, '移动力翻倍'],
            ['dodge', '闪避', Shield, '对己攻击劣势'],
            ['disengage', '脱离', DoorOpen, '移动不触发借机'],
            ['hide', '隐藏', EyeOff, '隐匿检定，成功则攻击优势'],
            ['help', '协助', HelpingHand, '友方下次攻击优势'],
            ['ready', '预备', Timer, '记录触发条件'],
            ['potion', '药水', FlaskConical, '2d4+2 治疗'],
          ] as const).map(([kind, label, Icon, hint]) => {
            const actionUsed = battleActive && actorIsCurrent && (eco?.action ?? false);
            const disabled = !actorAlive || (kind !== 'potion' ? actionUsed : actionUsed);
            return (
              <button
                key={kind}
                disabled={disabled}
                onClick={() => {
                  if (kind === 'help') { setHelpMode(true); setPending(null); }
                  else doPlayerAction(kind);
                }}
                title={hint}
                className={cn(
                  'flex items-center gap-1 rounded-lg border border-border/40 bg-card/60 px-2 py-1.5 text-[11px] transition-all hover:border-primary/60 hover:bg-primary/10',
                  helpMode && kind === 'help' && 'border-primary bg-primary/20',
                  disabled && 'cursor-not-allowed opacity-40',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ===== 目标选择条（手动动作 / 多重攻击余量续打） ===== */}
      {(pending || helpMode || queueActive) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-2">
          <span className="text-[11px] font-semibold text-primary">
            {helpMode
              ? '🤝 协助对象'
              : pending
                ? `${pending.ability.name} → 选择目标`
                : `${queuedAbility!.name} → 多重攻击剩余 ${multiQueue!.remaining} 次 · 选择新目标`}
          </span>
          <select
            className="h-8 min-w-0 flex-1 rounded-md border border-border/50 bg-black/40 px-2 text-xs text-foreground focus:border-primary/50 focus:outline-none"
            value={effectiveTargetId ?? ''}
            onChange={e => setTargetId(e.target.value || null)}
          >
            <option value="">— 选择目标 —</option>
            {targetCandidates.map(({ unit: u, dist, inRange }) => (
              <option key={u.id} value={u.id} disabled={!inRange}>
                {u.name}（{dist}尺{!inRange ? ' · 超出射程' : ''} · AC {u.ac}{u.hp <= u.maxHp * 0.4 ? ' · 残血' : ''}）
              </option>
            ))}
          </select>
          {helpMode ? (
            <Button
              size="sm" className="h-8 gap-1 bg-primary text-[11px] text-primary-foreground"
              disabled={!effectiveTargetId}
              onClick={() => doPlayerAction('help')}
            >
              <HelpingHand className="h-3.5 w-3.5" />确认协助
            </Button>
          ) : pending ? (
            <Button
              size="sm" className="h-8 gap-1 bg-red-800 text-[11px] text-white hover:bg-red-700"
              disabled={!effectiveTargetId}
              onClick={execute}
            >
              <Zap className="h-3.5 w-3.5" />执行
            </Button>
          ) : (
            <Button
              size="sm" className="h-8 gap-1 bg-red-800 text-[11px] text-white hover:bg-red-700"
              disabled={!effectiveTargetId}
              onClick={() => {
                store.continueMultiAttack(actor.id, queuedAbility!.id, effectiveTargetId);
                setTargetId(null);
              }}
            >
              <Zap className="h-3.5 w-3.5" />续打 ×{multiQueue!.remaining}
            </Button>
          )}
          <Button
            size="sm" variant="secondary" className="h-8 text-[11px]"
            onClick={() => {
              if (!pending && queueActive) store.clearMultiAttackQueue();
              setPending(null); setHelpMode(false); setTargetId(null);
            }}
          >
            {pending ? '取消' : '放弃'}
          </Button>
        </div>
      )}

      {/* 状态提示 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>拖拽地图 token 移动（自动计移动力/借机攻击）</span>
        {!battleActive && <span className="text-amber-300/80">非战斗状态：自由结算，不消耗动作经济</span>}
        {canActFree && battleActive && <span className="text-amber-300/80">非本回合单位：演练结算</span>}
      </div>
    </div>
  );
}
