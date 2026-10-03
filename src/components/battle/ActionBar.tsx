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
import { canUnarmedStrikeTarget } from '@/lib/engine/combat';
import { SpellCastDialog, type GenericCastRequest } from '@/components/battle/SpellCastDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AiAbility as AiAbilityT } from '@/lib/engine/types';
import { unitDistance, inMeleeRange } from '@/lib/engine/geometry';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Swords, Wand2, Footprints, Zap, Wind, Shield, DoorOpen, EyeOff,
  HelpingHand, Timer, FlaskConical, ChevronsRight, Bot, User, LogOut, MapPin, Hand,
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
  // 喂药模式：药水按钮 → 目标条选 5 尺内友方（不选 = 自己饮用），复用 help 的目标条交互
  const [potionMode, setPotionMode] = useState(false);
  // 擒抱/推撞模式（2024 徒手打击）：目标条选近战触及内敌人；推撞可选击倒或推离 5 尺
  const [strikeMode, setStrikeMode] = useState<null | 'grapple' | 'shove'>(null);
  // 通用施法（E6/T2）：未结构化法术 → 弹窗填参施放
  const [gcRequest, setGcRequest] = useState<GenericCastRequest | null>(null);
  // 预备动作（E12）：登记弹窗开关 + 表单
  const [readyMode, setReadyMode] = useState(false);
  const [readyAbilityId, setReadyAbilityId] = useState('');
  const [readyTrigger, setReadyTrigger] = useState('');
  // 预备触发：目标选择
  const [readyTriggerTarget, setReadyTriggerTarget] = useState('');
  const [shoveEffect, setShoveEffect] = useState<'prone' | 'push5'>('prone');

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
  const resetKey = `${actor?.id ?? '-'}|${turn.round}|${pending?.ability.id ?? ''}|${multiQueue?.abilityId ?? ''}|${multiQueue?.remaining ?? ''}|${helpMode ? 'h' : ''}|${potionMode ? 'p' : ''}|${strikeMode ?? ''}`;
  if (resetKey !== ctxKey) {
    setCtxKey(resetKey);
    setTargetId(null);
  }

  const living = units.filter(u => u.hp > 0 && !u.deathSaves?.dead);
  const enemies = living.filter(u => u.attitude === 2);
  const allies = living.filter(u => u.attitude === 0);

  // 动作经济展示
  const eco = actor?.actionEconomy;
  // 逃离战场门控：玩家单位 + 存活 + 站在战场外圈一格
  const onEdge = !!actor && actorAlive && actor.attitude === 0 && (() => {
    const cx = actor.pos.x / store.mapConfig.cellSize;
    const cy = actor.pos.y / store.mapConfig.cellSize;
    return cx < 1 || cy < 1 || cx >= store.mapConfig.width - 1 || cy >= store.mapConfig.height - 1;
  })();
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

  // 喂药候选：同阵营存活友方（含濒死——喂药正是拉人手段）×5 尺触及
  const potionCands = useMemo(() => {
    if (!potionMode || !actor) return [];
    return units
      .filter(u => u.id !== actor.id && u.attitude === actor.attitude && !u.deathSaves?.dead)
      .map(u => ({
        unit: u,
        dist: unitDistance(actor, u, store.mapConfig.diagonal),
        inRange: inMeleeRange(actor, u, 5, store.mapConfig.diagonal),
      }));
  }, [potionMode, actor, units, store.mapConfig.diagonal]);

  // 擒抱/推撞候选：敌对/中立存活单位 ×近战触及；体型差 >1 级（2024 守卫）保留在列表但禁用并标注
  const strikeCands = useMemo(() => {
    if (!strikeMode || !actor) return [];
    return living
      .filter(u => u.id !== actor.id && u.attitude !== actor.attitude)
      .map(u => {
        const sizeOk = canUnarmedStrikeTarget(actor, u);
        return {
          unit: u,
          dist: unitDistance(actor, u, store.mapConfig.diagonal),
          inRange: sizeOk && inMeleeRange(actor, u, actor.reach ?? 5, store.mapConfig.diagonal),
          sizeOk,
        };
      });
  }, [strikeMode, actor, living, store.mapConfig.diagonal]);

  if (!actor) return null;

  const canActFree = !battleActive || !actorIsCurrent; // 非当前回合/非战斗 → 自由结算（不消耗）
  const blocked = battleActive && actorIsCurrent && !actorControllable;

  const startAction = (ability: AiAbility) => {
    setHelpMode(false);
    setPotionMode(false);
    setStrikeMode(null);
    setPending({ ability });
  };

  const confirmPotion = () => {
    // targetId 为空 = 自己饮用；选友方 = 喂药（消耗施动者附赠/回退动作，目标回血）
    store.playerAction('potion', actor.id, targetId);
    setPotionMode(false);
    setTargetId(null);
  };

  const confirmStrike = () => {
    if (!strikeMode) return;
    // 推撞效果二选一（2024）：击倒 prone / 推离 5 尺；擒抱失败直接挂 grappled
    store.playerAction(
      strikeMode === 'grapple' ? 'grapple' : shoveEffect === 'prone' ? 'shove' : 'shove-away',
      actor.id, effectiveTargetId,
    );
    setStrikeMode(null);
    setTargetId(null);
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
            {spells.filter(a => !a.genericCast).map(a => {
              const lvl = a.spellLevel ?? 0;
              const noSlot = !slotOk(a);
              const disabled = econDisabled(a) || !actorAlive || noSlot;
              const unprepared = a.spellPrepared === false && lvl > 0;
              return (
                <button
                  key={a.id}
                  disabled={disabled}
                  onClick={() => {
                    if (unprepared && !window.confirm(`「${a.name}」未准备——仍要强施吗？（2024 RAW：未准备法术不可施放，此处为面板宽松兜底）`)) return;
                    startAction(a);
                  }}
                  title={noSlot ? `${lvl} 环法术位不足` : unprepared ? '⚠ 未准备法术：点击确认后强施' : AI_ABILITY_KIND_META[a.kind].hint}
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
                    {unprepared && <span className="ml-1 rounded bg-amber-500/15 px-1 text-[9px] text-amber-300">未准备</span>}
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

      {/* ===== 通用施法（未结构化法术：弹窗填参） ===== */}
      {spells.some(a => a.genericCast) && (
        <div className="flex flex-wrap gap-1.5">
          {spells.filter(a => a.genericCast).map(a => (
            <button
              key={a.id}
              onClick={() => setGcRequest({ abilityId: a.id, name: a.name, baseLevel: a.spellLevel ?? 0 })}
              title={a.note}
              className="flex flex-col items-start rounded-lg border border-violet-400/30 bg-card/60 px-2.5 py-1.5 text-left transition-all hover:border-violet-400/60 hover:bg-violet-500/10"
            >
              <span className="text-xs font-semibold">
                ◐ {a.name}
                <span className="ml-1 rounded bg-violet-500/20 px-1 text-[9px] text-violet-300">{(a.spellLevel ?? 0) === 0 ? '戏法' : `${a.spellLevel}环`}</span>
                <span className="ml-1 rounded bg-amber-500/15 px-1 text-[9px] text-amber-300">通用</span>
              </span>
              <span className="text-[10px] text-muted-foreground">点击填参施放</span>
            </button>
          ))}
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
            ['grapple', '擒抱', Hand, '2024 徒手打击：目标 STR/DEX 豁免（自选）vs DC8+力调+熟练，失败被擒抱（速度归 0）'],
            ['shove', '推撞', Hand, '2024 徒手打击：同上豁免，失败可击倒（倒地）或推离 5 尺'],
            ['potion', '药水', FlaskConical, '2d4+2 治疗：附赠动作，可喂 5 尺内友方（附赠耗尽回退动作）'],
          ] as const).map(([kind, label, Icon, hint]) => {
            const actionUsed = battleActive && actorIsCurrent && (eco?.action ?? false);
            const disabled = !actorAlive || (kind !== 'potion' ? actionUsed : actionUsed);
            return (
              <button
                key={kind}
                disabled={disabled}
                onClick={() => {
                  if (kind === 'ready') { setReadyMode(true); setReadyAbilityId(''); setReadyTrigger(''); }
                  else if (kind === 'help') { setHelpMode(true); setPending(null); setPotionMode(false); setStrikeMode(null); }
                  else if (kind === 'potion') { setPotionMode(true); setPending(null); setHelpMode(false); setStrikeMode(null); }
                  else if (kind === 'grapple' || kind === 'shove') { setStrikeMode(kind); setShoveEffect('prone'); setPending(null); setHelpMode(false); setPotionMode(false); }
                  else doPlayerAction(kind);
                }}
                title={hint}
                className={cn(
                  'flex items-center gap-1 rounded-lg border border-border/40 bg-card/60 px-2 py-1.5 text-[11px] transition-all hover:border-primary/60 hover:bg-primary/10',
                  (helpMode && kind === 'help') || (potionMode && kind === 'potion') || (strikeMode && kind === strikeMode) ? 'border-primary bg-primary/20' : '',
                  disabled && 'cursor-not-allowed opacity-40',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
        {/* 逃离战场：玩家侧逃跑机制——需站上战场外圈格 */}
        {actorControllable && actorAlive && (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              disabled={!onEdge || !actorIsCurrent}
              onClick={() => actor && store.escapeUnit(actor.id)}
              title={onEdge
                ? '逃离战场：移出先攻轮，不再参战'
                : '需先移动到战场边缘格外圈（最外一圈格子）才能逃离'}
              className={cn(
                'flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] transition-all',
                onEdge && actorIsCurrent
                  ? 'border-amber-400/50 bg-amber-500/10 text-amber-200 hover:border-amber-300 hover:bg-amber-500/20'
                  : 'cursor-not-allowed border-border/30 bg-card/40 text-muted-foreground/60',
              )}
            >
              <LogOut className="h-3.5 w-3.5" />
              逃离战场{onEdge ? '' : '（需在边缘格）'}
            </button>
            {!onEdge && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <MapPin className="h-3 w-3" />移动到战场最外圈后可逃离
              </span>
            )}
          </div>
        )}
      </div>

      {/* ===== 目标选择条（手动动作 / 协助 / 喂药 / 擒抱推撞 / 多重攻击余量续打） ===== */}
      {(pending || helpMode || queueActive || potionMode || strikeMode) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-2">
          <span className="text-[11px] font-semibold text-primary">
            {strikeMode
              ? strikeMode === 'grapple' ? '🤼 擒抱目标（近战触及 · 体型≤大1级）' : '🤼 推撞目标（近战触及 · 体型≤大1级）'
              : potionMode
                ? '🧪 喂药对象（5 尺内友方；不选 = 自己饮用）'
                : helpMode
                  ? '🤝 协助对象'
                  : pending
                    ? `${pending.ability.name} → 选择目标`
                    : `${queuedAbility!.name} → 多重攻击剩余 ${multiQueue!.remaining} 次 · 选择新目标`}
          </span>
          {strikeMode === 'shove' && (
            <select
              className="h-8 rounded-md border border-border/50 bg-black/40 px-2 text-xs text-foreground focus:border-primary/50 focus:outline-none"
              value={shoveEffect}
              onChange={e => setShoveEffect(e.target.value as 'prone' | 'push5')}
              title="推撞失败时的效果（2024：击倒或推离 5 尺，发起者选择）"
            >
              <option value="prone">击倒（倒地）</option>
              <option value="push5">推离 5 尺</option>
            </select>
          )}
          <select
            className="h-8 min-w-0 flex-1 rounded-md border border-border/50 bg-black/40 px-2 text-xs text-foreground focus:border-primary/50 focus:outline-none"
            value={effectiveTargetId ?? ''}
            onChange={e => setTargetId(e.target.value || null)}
          >
            {strikeMode ? (
              <>
                <option value="">— 选择目标 —</option>
                {strikeCands.map(({ unit: u, dist, inRange, sizeOk }) => (
                  <option key={u.id} value={u.id} disabled={!inRange}>
                    {u.name}（{dist}尺{!sizeOk ? ' · 体型悬殊不可' : !inRange ? ' · 不在触及' : ''} · AC {u.ac}）
                  </option>
                ))}
              </>
            ) : potionMode ? (
              <>
                <option value="">— 自己饮用 —</option>
                {potionCands.map(({ unit: u, dist, inRange }) => (
                  <option key={u.id} value={u.id} disabled={!inRange}>
                    {u.name}（{dist}尺{!inRange ? ' · 超5尺' : ''}{u.hp <= 0 ? ' · 濒死' : ` · HP ${u.hp}/${u.maxHp}`}{u.hp > 0 && u.hp <= u.maxHp * 0.4 ? ' · 残血' : ''}）
                  </option>
                ))}
              </>
            ) : (
              <>
                <option value="">— 选择目标 —</option>
                {targetCandidates.map(({ unit: u, dist, inRange }) => (
                  <option key={u.id} value={u.id} disabled={!inRange}>
                    {u.name}（{dist}尺{!inRange ? ' · 超出射程' : ''} · AC {u.ac}{u.hp <= u.maxHp * 0.4 ? ' · 残血' : ''}）
                  </option>
                ))}
              </>
            )}
          </select>
          {strikeMode ? (
            <Button
              size="sm" className="h-8 gap-1 bg-amber-800 text-[11px] text-white hover:bg-amber-700"
              disabled={!effectiveTargetId}
              onClick={confirmStrike}
            >
              <Hand className="h-3.5 w-3.5" />{strikeMode === 'grapple' ? '擒抱' : shoveEffect === 'prone' ? '推撞·击倒' : '推撞·推离'}
            </Button>
          ) : potionMode ? (
            <Button
              size="sm" className="h-8 gap-1 bg-emerald-800 text-[11px] text-white hover:bg-emerald-700"
              onClick={confirmPotion}
            >
              <FlaskConical className="h-3.5 w-3.5" />{targetId ? '喂药' : '自己饮用'}
            </Button>
          ) : helpMode ? (
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
              setPending(null); setHelpMode(false); setPotionMode(false); setStrikeMode(null); setTargetId(null);
            }}
          >
            {pending || strikeMode ? '取消' : '放弃'}
          </Button>
        </div>
      )}

      {/* 状态提示 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>拖拽地图 token 移动（自动计移动力/借机攻击）</span>
        {!battleActive && <span className="text-amber-300/80">非战斗状态：自由结算，不消耗动作经济</span>}
        {canActFree && battleActive && <span className="text-amber-300/80">非本回合单位：演练结算</span>}
      </div>

      {/* E12 预备动作触发条：已登记且反应可用时可见 */}
      {actor?.readyAction && actorAlive && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs">
          <span className="font-semibold text-amber-200">
            ⏳ 已预备【{actor.readyAction.abilityName}】（触发：{actor.readyAction.triggerText}）
          </span>
          <select
            value={readyTriggerTarget}
            onChange={e => setReadyTriggerTarget(e.target.value)}
            className="rounded border border-border/60 bg-background/60 px-2 py-1"
          >
            <option value="">— 选择触发目标 —</option>
            {units.filter(u => u.id !== actor.id && u.hp > 0 && !u.deathSaves?.dead && u.attitude !== 0).map(u => (
              <option key={u.id} value={u.id}>{u.name}（{u.hp}/{u.maxHp}）</option>
            ))}
          </select>
          <Button size="sm" className="h-7 bg-amber-600 hover:bg-amber-500"
            disabled={!readyTriggerTarget || actor.actionEconomy.reaction || actor.reactionUsedTurn}
            onClick={() => { store.triggerReadyAction(actor.id, readyTriggerTarget); setReadyTriggerTarget(''); }}>
            ▶ 以反应触发
          </Button>
          {(actor.actionEconomy.reaction || actor.reactionUsedTurn) && (
            <span className="text-[10px] text-red-300">反应已用尽</span>
          )}
        </div>
      )}

      {/* E11 反应法术窗口：AI 攻击玩家单位时挂起，等待确认/忽略 */}
      {store.pendingReactionStep && (() => {
        const pr = store.pendingReactionStep;
        const target = units.find(u => u.id === pr.targetId);
        return (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-400/50 bg-cyan-500/10 px-3 py-2 text-xs">
            <span className="font-semibold text-cyan-200">
              ⏸ {pr.attackerId} 即将攻击 {target?.name ?? pr.targetId}
            </span>
            <Button size="sm" className="h-7 gap-1 bg-cyan-600 hover:bg-cyan-500"
              onClick={() => store.resolvePendingReaction(true)}>
              🛡 施放【{pr.spellName}】（反应+{pr.spellLevel}环，AC+5）
            </Button>
            <Button size="sm" variant="secondary" className="h-7"
              onClick={() => store.resolvePendingReaction(false)}>
              忽略
            </Button>
          </div>
        );
      })()}

      {/* E12 预备动作登记弹窗 */}
      <Dialog open={readyMode} onOpenChange={setReadyMode}>
        <DialogContent className="max-w-sm bg-card text-card-foreground">
          <DialogHeader>
            <DialogTitle className="text-amber-300">⏳ 预备动作 —— {actor?.name ?? ''}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">预备的动作（触发时以反应执行并按常结算）</span>
              <select value={readyAbilityId} onChange={e => setReadyAbilityId(e.target.value)} className="rounded border border-border/60 bg-background/60 px-2 py-1">
                <option value="">— 选择动作 —</option>
                {(actor?.aiAbilities ?? [])
                  .filter(a => ['melee', 'ranged', 'save', 'save-aoe', 'heal'].includes(a.kind) && !a.genericCast)
                  .map(a => <option key={a.id} value={a.id}>{AI_ABILITY_KIND_META[a.kind].icon} {a.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">触发条件（记录用，如「地精从门口露头」）</span>
              <input value={readyTrigger} onChange={e => setReadyTrigger(e.target.value)} className="rounded border border-border/60 bg-background/60 px-2 py-1" />
            </label>
            <p className="text-[10px] text-muted-foreground">2024：预备消耗本回合动作；触发时消耗反应并按该动作正常结算（法术位照常消耗）。失去对触发目标的可见性则预备作废（由 DM 叙事裁定）。</p>
            <Button
              className="w-full bg-amber-600 hover:bg-amber-500"
              disabled={!readyAbilityId || !actor}
              onClick={() => {
                const ab = (actor?.aiAbilities ?? []).find(a => a.id === readyAbilityId);
                if (!ab || !actor) return;
                store.setReadyAction(actor.id, ab.id, ab.name, readyTrigger);
                setReadyMode(false);
              }}
            >
              登记预备（消耗动作）
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 通用施法弹窗（E6/T2） */}
      <SpellCastDialog
        open={!!gcRequest && !!actor}
        onOpenChange={(v) => { if (!v) setGcRequest(null); }}
        actor={actor!}
        units={units}
        request={gcRequest ?? { abilityId: '', name: '', baseLevel: 0 }}
        onCast={(synth: AiAbilityT, castLevel: number, consumeSlot: boolean, targetId: string | null) => {
          if (!actor) return;
          // 合成动作写入单位（替换占位项），随后走 castAbility 现成结算分支
          useBattleStore.setState((s) => ({
            units: s.units.map(u => (u.id === actor.id
              ? { ...u, aiAbilities: (u.aiAbilities ?? []).map(a => (a.id === synth.id ? synth : a)) }
              : u)),
          }));
          const isAoe = synth.kind === 'save-aoe';
          store.castAbility(actor.id, synth.id, targetId, {
            castLevel,
            consumeSlot,
            ...(isAoe && !targetId ? { originPos: actor.pos } : {}),
          });
        }}
      />
    </div>
  );
}
