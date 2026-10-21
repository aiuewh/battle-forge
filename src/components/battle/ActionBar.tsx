'use client';

import React, { useEffect, useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { useActionUiStore } from '@/store/actionUiStore';
import { abilityPreview } from '@/lib/engine/actionPreview';
import { hudCandidates, hudTargetReason, type HudPlayerAction } from '@/lib/engine/hudTargets';
import { aggregateEffects, conditionName } from '@/lib/engine/conditions';
import { effectiveSpeed } from '@/lib/engine/rules';
import { abilityDisabledReason } from './abilityGate';
import { decidePotionCost, DAMAGE_TYPE_META, type AiAbility } from '@/lib/engine/types';
import { unitDistance } from '@/lib/engine/geometry';
import { isAiControlled } from '@/lib/engine/ai';
import { HudMenu } from './HudMenu';
import { hpColor } from './iso/isoScene';
import { SpellCastDialog, type GenericCastRequest } from './SpellCastDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Swords, Wand2, Footprints, Package, MoreHorizontal, X, Check, Target, ChevronUp, Play } from 'lucide-react';

type Menu = 'weapons' | 'spells' | 'items' | 'actions' | 'targets' | null;

/** Character HUD on the canvas. Menus overlay the stage; they never grow the map layout. */
export function ActionBar({ compact = false, boundary, onInspect }: {
  compact?: boolean; boundary?: HTMLElement | null; onInspect?: (id: string) => void;
}) {
  const store = useBattleStore();
  const ui = useActionUiStore();
  const [menu, setMenu] = useState<Menu>(null);
  const [spellLevel, setSpellLevel] = useState<number | null>(null);
  const [nonLethal, setNonLethal] = useState(false);
  const [generic, setGeneric] = useState<GenericCastRequest | null>(null);
  const [readyOpen, setReadyOpen] = useState(false);
  const [readyId, setReadyId] = useState('');
  const [readyText, setReadyText] = useState('');
  const [readyTrigger, setReadyTrigger] = useState(false);
  const [readyOwner, setReadyOwner] = useState('');
  const [readyTarget, setReadyTarget] = useState('');

  useEffect(() => {
    const s = useBattleStore.getState();
    const selection = useActionUiStore.getState();
    const q = s.multiAttackQueue;
    if (s.readOnly || !q || selection.request || selection.movingActorId) return;
    const owner = s.units.find(u => u.id === q.actorId);
    const ability = owner?.aiAbilities?.find(a => a.id === q.abilityId);
    if (ability && owner?.hp && s.turn.currentUnitId === owner.id) selection.begin({ actorId:owner.id, ability, continuation:true });
  }, [store.multiAttackQueue, store.readOnly, ui.request, ui.movingActorId]);

  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (menu || generic || readyOpen || readyTrigger) { setMenu(null); return; }
      if (useActionUiStore.getState().request?.continuation) useBattleStore.getState().clearMultiAttackQueue();
      else useActionUiStore.getState().clear();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu, generic, readyOpen, readyTrigger]);

  const current = store.units.find(u => u.id === store.turn.currentUnitId);
  const selected = store.units.find(u => u.id === store.selectedId);
  const actor = store.battleActive && current ? current : selected?.attitude === 0 ? selected
    : store.units.find(u => u.attitude === 0 && (u.isPlayer || u.playerControlled));
  if (!actor) return <div className="token-hud hud-wait">选择一个我方棋子查看行动</div>;

  const controlled = actor.attitude === 0 && (actor.isPlayer || actor.playerControlled);
  const locked = store.readOnly || !controlled || !!store.pendingReactionStep;
  const alive = actor.hp > 0 && !actor.deathSaves?.dead;
  const noActions = aggregateEffects(actor.statuses).noActions;
  const abilities = actor.aiAbilities ?? [];
  const weapons = abilities.filter(a => ['melee', 'ranged'].includes(a.kind) && a.spellLevel === undefined);
  const spells = abilities.filter(a => a.spellLevel !== undefined);
  const specials = abilities.filter(a => a.spellLevel === undefined && !weapons.includes(a));
  const levels = [...new Set(spells.map(a => a.spellLevel ?? 0))].sort((a, b) => a - b);
  const level = spellLevel !== null && levels.includes(spellLevel) ? spellLevel : levels[0] ?? 0;
  const queue = store.multiAttackQueue?.actorId === actor.id ? store.multiAttackQueue : null;
  const request = ui.request?.actorId === actor.id ? ui.request : null;
  const target = store.units.find(u => u.id === ui.targetId);
  const preview = request && !request.playerAction ? abilityPreview(actor, request.ability, target,
    store.units, store.obstacles, store.mapConfig.diagonal, { ...request, originPos: ui.originPos, angle: ui.angle }) : null;
  const reason = request ? hudTargetReason(request, actor, target, store.units, store.obstacles, store.mapConfig.diagonal, ui.originPos) : null;
  const candidates = request ? hudCandidates(request, actor, store.units) : [];
  const potion = decidePotionCost(store.rules, actor.actionEconomy);
  const speed = effectiveSpeed(actor);
  const left = Math.max(0, speed - actor.actionEconomy.movementUsed);
  const isCurrent = store.battleActive && actor.id === store.turn.currentUnitId;
  const readied = store.units.filter(u => u.attitude === 0 && u.readyAction && u.hp > 0 && !u.deathSaves?.dead);
  const triggerOwner = readied.find(u => u.id === readyOwner) ?? readied[0];
  const triggerAbility = triggerOwner?.aiAbilities?.find(a => a.id === triggerOwner.readyAction?.abilityId);
  const triggerChoices = triggerOwner && triggerAbility ? hudCandidates({ability:triggerAbility},triggerOwner,store.units) : [];
  const triggerReason = triggerOwner && triggerAbility ? hudTargetReason({ability:triggerAbility},triggerOwner,
    store.units.find(u => u.id === readyTarget), store.units, store.obstacles,store.mapConfig.diagonal) : '预备动作已失效';

  function stillOwnsTurn() {
    const now = useBattleStore.getState();
    return !now.readOnly && !now.pendingReactionStep && (!now.battleActive || now.turn.currentUnitId === actor?.id);
  }

  function disabledReason(a: AiAbility): string | null {
    return abilityDisabledReason(actor!, a, { locked, isCurrent });
  }
  function choose(a: AiAbility) {
    if (!stillOwnsTurn() || disabledReason(a)) return;
    if (a.spellPrepared === false && (a.spellLevel ?? 0) > 0 && !window.confirm(`【${a.name}】未准备，仍要使用宽松施法？`)) return;
    setMenu(null); setNonLethal(false);
    if (a.genericCast) { setGeneric({ abilityId: a.id, name: a.name, baseLevel: a.spellLevel ?? 0 }); return; }
    ui.begin({ actorId: actor!.id, ability: a });
  }
  function beginPlayerAction(kind: HudPlayerAction, name: string) {
    if (!stillOwnsTurn() || locked || !alive || noActions) return;
    setMenu(null); setNonLethal(false);
    ui.begin({ actorId: actor!.id, playerAction: kind, ability: {
      id: `hud-${kind}`, name, kind: ['potion', 'help'].includes(kind) ? 'heal' : 'melee',
      dice: '0', range: kind === 'potion' ? 5 : actor!.reach ?? 5,
    } });
  }
  function cancel() { setMenu(null); if (queue) store.clearMultiAttackQueue(); else ui.clear(); setNonLethal(false); }
  function execute() {
    if (!stillOwnsTurn() || !request || reason || locked || !alive) return;
    if (request.playerAction) {
      const before = useBattleStore.getState().events.at(-1)?.id;
      store.playerAction(request.playerAction, actor!.id, ui.targetId);
      const after = useBattleStore.getState().events;
      if (after.at(-1)?.id === before || (after.at(-1)?.type === 'note' && after.at(-1)?.level === 'bad')) { ui.fail(after.at(-1)?.text ?? '行动未执行'); return; }
      ui.clear(); return;
    }
    if (request.continuation) {
      store.continueMultiAttack(actor!.id, request.ability.id, ui.targetId);
      if (!useBattleStore.getState().multiAttackQueue) ui.clear(); else ui.select(null);
      return;
    }
    if (preview?.allies.length && !window.confirm(`将波及友方：${preview.allies.map(u => u.name).join('、')}。确认施放？`)) return;
    const ok = store.castAbility(actor!.id, request.ability.id, ui.targetId, { abilityOverride: request.ability,
      nonLethal: request.ability.kind === 'melee' && nonLethal, originPos: ui.originPos, angle: ui.angle,
      castLevel: request.castLevel, consumeSlot: request.consumeSlot });
    if (ok) { if (!useBattleStore.getState().multiAttackQueue) ui.clear(); setNonLethal(false); }
    else ui.fail(useActionUiStore.getState().error ?? useBattleStore.getState().events.at(-1)?.text ?? '行动未执行');
  }
  function abilityItem(a: AiAbility) {
    const disabled = disabledReason(a);
    return <button key={a.id} className="hud-list-item" disabled={!!disabled} title={disabled ?? a.note ?? a.name} onClick={() => choose(a)}>
      <span>{a.name}{a.concentration && <span className="hud-tag">专注</span>}{a.spellPrepared === false && <span className="hud-tag">未准备</span>}</span>
      <small>{disabled ?? [a.bonusAction ? '附赠' : '动作', a.dice && a.dice !== '0' ? a.dice : '', a.damageType ? DAMAGE_TYPE_META[a.damageType].name : '', a.range ? `${a.range} 尺` : ''].filter(Boolean).join(' · ')}</small>
    </button>;
  }
  const actionDisabled = locked || !alive || noActions || (isCurrent && actor.actionEconomy.action);
  const popup = (name: Exclude<Menu, null>, label: string, icon: React.ReactNode, children: React.ReactNode) =>
    <HudMenu key={name} boundary={boundary} label={label} open={menu === name} onOpenChange={v => setMenu(v ? name : null)}
      trigger={<button className="hud-shortcut" disabled={locked || !alive || noActions} aria-label={label}>{icon}<span>{label}</span><ChevronUp size={12} /></button>}>
      <div className="hud-menu-heading"><strong>{label}</strong><button aria-label={`关闭${label}菜单`} onClick={() => setMenu(null)}><X size={16}/></button></div>{children}
    </HudMenu>;

  const pr = store.pendingReactionStep;
  return <div className={`token-hud ${compact ? 'token-hud-compact' : ''}`} aria-label="角色行动 HUD">
    {pr && <div className="hud-reaction" role="alert">
      <strong>{store.units.find(u => u.id === pr.targetId)?.name ?? pr.targetId} 可使用反应</strong>
      <span>{pr.spellName} · 反应＋{pr.spellLevel}环</span>
      <div><button disabled={store.readOnly} onClick={() => store.resolvePendingReaction(true)}>施放 {pr.spellName}</button><button disabled={store.readOnly} onClick={() => store.resolvePendingReaction(false)}>不使用反应</button></div>
    </div>}
    {ui.error && <div className="hud-error" role="alert"><span>{ui.error}</span><button aria-label="关闭行动提示" onClick={() => ui.fail(null)}><X size={16}/></button></div>}
    <div className="hud-character">
      <button className="hud-portrait" aria-label={`查看${actor.name}人物卡`} onClick={() => onInspect?.(actor.id)}>
        <span>{actor.name.slice(0, 1)}</span>{actor.portrait && <img src={actor.portrait} alt="" onError={e => { e.currentTarget.style.display = 'none'; }}/>}</button>
      <div className="hud-character-text"><strong>{actor.name}</strong><span>HP {Math.max(0, actor.hp)}/{actor.maxHp}{actor.tempHp ? ` ＋${actor.tempHp}` : ''}</span><div className="hud-hp"><i style={{ width: `${Math.max(0, Math.min(100, actor.hp / Math.max(1, actor.maxHp) * 100))}%`, background: hpColor(actor.hp / Math.max(1, actor.maxHp)) }}/></div></div>
      <div className="hud-economy"><span>移动 {left} 尺{queue ? ` · 余 ${queue.remaining} 次攻击` : ''}</span>{(['action','bonus','reaction'] as const).map((key, i) => <span key={key} className={actor.actionEconomy[key] ? 'spent' : ''}>{['动作','附赠','反应'][i]} {actor.actionEconomy[key] ? '已用' : '可用'}</span>)}</div>
      {readied.length > 0 && <button className="hud-ready-button" disabled={store.readOnly || !!pr} onClick={() => { setReadyTrigger(true); setReadyTarget(''); }}>预备反应 {readied.length}</button>}
    </div>
    {(actor.concentration || actor.statuses.length > 0) && <div className="hud-status-strip" aria-label="当前角色状态">
      {actor.concentration && <span className="hud-concentration">专注 · {actor.concentration}</span>}
      {actor.statuses.slice(0, 3).map(status => <span key={status}>{conditionName(status)}</span>)}
      {actor.statuses.length > 3 && <button onClick={() => onInspect?.(actor.id)}>＋{actor.statuses.length - 3}</button>}
    </div>}
    <div className="hud-command-area">
      {request ? <>
        <div className="hud-target-line"><strong>{request.ability.name}{queue ? ` · 余 ${queue.remaining} 次` : ''}</strong><span>→ {target?.name ?? (ui.originPos ? '地图落点' : '点选目标')}</span>
          <HudMenu open={menu === 'targets'} onOpenChange={v => setMenu(v ? 'targets' : null)} label="目标列表" boundary={boundary} align="end" trigger={<button className="hud-icon-button" aria-label="目标列表"><Target size={18}/></button>}>
            <div className="hud-menu-heading"><strong>目标列表</strong><button aria-label="关闭目标列表" onClick={() => setMenu(null)}><X size={16}/></button></div>
            <div className="hud-menu-list">{candidates.map(u => {
              const why = hudTargetReason(request, actor, u, store.units, store.obstacles, store.mapConfig.diagonal);
              return <button className="hud-list-item" key={u.id} disabled={!!why} onClick={() => { ui.select(u.id); setMenu(null); }}><span>{u.name}</span><small>{why ?? `${unitDistance(actor, u, store.mapConfig.diagonal)} 尺 · HP ${u.hp}/${u.maxHp}`}</small></button>;
            })}</div>
          </HudMenu>
        </div>
        <div className="hud-preview-line" aria-live="polite">
          {reason ?? <>{preview?.dist !== null && preview?.dist !== undefined ? `${preview.dist} 尺 · ` : ''}{request.continuation ? '不重复消耗动作' : request.playerAction === 'potion' ? (potion.useBonus ? '附赠动作' : '动作') : request.ability.bonusAction ? '附赠动作' : '动作'}{preview?.slot?.level ? `＋${preview.slot.level}环` : ''}{preview?.mode ? ` · ${({ normal: '普通检定', advantage: '优势', disadvantage: '劣势' })[preview.mode.mode]}` : ''}{preview?.cover?.bonus ? ` · 掩护＋${preview.cover.bonus}` : ''}</>}
          {preview?.mode?.reasons.length ? <span> · {preview.mode.reasons.join('、')}</span> : null}
          {preview?.template && <span> · 波及 {preview.affected.map(u => u.name).join('、') || '无'}{preview.allies.length ? `（友方 ${preview.allies.length}）` : ''}</span>}
          {preview?.slot?.upcast && <strong className="hud-upcast">将消耗 {preview.slot.level} 环法术位（升环）</strong>}
          {request.ability.concentration && <span> · 专注{actor.concentration ? `将替换 ${actor.concentration}` : ''}</span>}
        </div>
        <div className="hud-confirm-row">
          {request.continuation && <button disabled={locked} onClick={() => { store.setSelectedId(actor.id); ui.move(actor.id); }}>先移动</button>}
          {request.playerAction === 'potion' && <button disabled={locked} onClick={() => ui.select(actor.id)}>自己饮用</button>}
          {request.ability.kind === 'melee' && !request.playerAction && !request.continuation && <label className="hud-nonlethal"><input type="checkbox" checked={nonLethal} onChange={e => setNonLethal(e.target.checked)}/>留活口</label>}
          {request.ability.aoe && ['cone', 'line'].includes(request.ability.aoe.kind) && <label className="hud-angle">朝向<input aria-label="范围朝向" type="range" min="-180" max="180" value={Math.round((preview?.template?.angle ?? 0) * 180 / Math.PI)} onChange={e => ui.rotate(Number(e.target.value) * Math.PI / 180)}/></label>}
          {request.ability.spellLevel !== undefined && request.ability.spellLevel > 0 && !request.continuation && <label className="hud-cast-level">施放环阶<select aria-label="施放环阶" value={request.castLevel ?? preview?.slot?.level ?? request.ability.spellLevel} onChange={e => ui.begin({ ...request, castLevel: Number(e.target.value) })}>{Object.entries(actor.spellSlots ?? {}).filter(([lv, slot]) => Number(lv) >= request.ability.spellLevel! && slot.current > 0).map(([lv, slot]) => <option key={lv} value={lv}>{lv}环 · 余{slot.current}</option>)}</select></label>}
          <button className="hud-execute" disabled={!!reason || locked || (!!preview?.slot && !preview.slot.ok) || (store.battleActive && (request.ability.spellLevel ?? 0) > 0 && request.consumeSlot !== false && !!actor.slotCastThisTurn)} onClick={execute}><Check size={16}/>确认{request.continuation ? '续打' : '执行'}</button><button className="hud-icon-button" aria-label="取消行动" onClick={cancel}><X size={18}/></button>
        </div>
      </> : ui.movingActorId === actor.id ? <div className="hud-moving"><Footprints size={18}/><span>点选可达空格移动 · 剩余 {left} 尺</span><button aria-label="取消移动" onClick={() => ui.clear()}><X size={18}/></button></div> : controlled ? <div className="hud-shortcuts">
        {weapons.slice(0, 2).map(a => <button className="hud-shortcut hud-weapon" key={a.id} disabled={!!disabledReason(a)} title={disabledReason(a) ?? a.name} onClick={() => choose(a)}><Swords size={16}/><span>{a.name}</span></button>)}
        {weapons.length > 2 && popup('weapons', '武器', <Swords size={16}/>, <div className="hud-menu-list">{weapons.map(abilityItem)}</div>)}
        {spells.length > 0 && popup('spells', '法术', <Wand2 size={16}/>, <><div className="hud-spell-levels" role="tablist" aria-label="法术环阶">{levels.map(lv => <button role="tab" aria-selected={lv === level} key={lv} onClick={() => setSpellLevel(lv)}>{lv === 0 ? '戏法' : `${lv}环`}<small>{lv > 0 && actor.spellSlots?.[lv] ? `${actor.spellSlots[lv].current}/${actor.spellSlots[lv].max}` : ''}</small></button>)}</div><div className="hud-menu-list">{spells.filter(a => (a.spellLevel ?? 0) === level).map(abilityItem)}</div></>)}
        {popup('items', '物品', <Package size={16}/>, <div className="hud-menu-list"><button className="hud-list-item" disabled={locked || !alive || noActions || (isCurrent && !potion.ok)} onClick={() => beginPlayerAction('potion', '治疗药水')}><span>治疗药水</span><small>饮用或喂给 5 尺内队友 · {potion.useBonus ? '附赠动作' : '动作'}</small></button></div>)}
        <button className="hud-shortcut" disabled={locked || !alive || left <= 0} onClick={() => { setMenu(null); store.setSelectedId(actor.id); ui.move(actor.id); }}><Footprints size={16}/><span>移动</span></button>
        {popup('actions', '其他动作', <MoreHorizontal size={18}/>, <div className="hud-menu-list">
          {specials.map(abilityItem)}
          {([['dash','冲刺'],['dodge','闪避'],['disengage','脱离'],['hide','隐藏']] as const).map(([kind, name]) => <button key={kind} className="hud-list-item" disabled={actionDisabled} onClick={() => { store.playerAction(kind, actor.id); setMenu(null); }}><span>{name}</span><small>动作</small></button>)}
          {([['help','协助'],['grapple','擒抱'],['shove','推撞·击倒'],['shove-away','推撞·推离']] as const).map(([kind, name]) => <button key={kind} className="hud-list-item" disabled={actionDisabled} onClick={() => beginPlayerAction(kind,name)}><span>{name}</span><small>动作 · 在地图点选目标</small></button>)}
          <button className="hud-list-item" disabled={actionDisabled} onClick={() => { setMenu(null); setReadyOpen(true); }}><span>预备动作</span><small>选择动作与触发条件</small></button>
          <button className="hud-list-item" disabled={locked || !isCurrent || !alive || !(actor.pos.x < 5 || actor.pos.y < 5 || actor.pos.x >= (store.mapConfig.width - 1) * 5 || actor.pos.y >= (store.mapConfig.height - 1) * 5)} onClick={() => { store.escapeUnit(actor.id); setMenu(null); }}><span>逃离战场</span><small>需要站在最外圈格子</small></button>
        </div>)}
        {isCurrent && <button className="hud-shortcut hud-end-turn" disabled={store.readOnly || !!pr} onClick={() => { if (queue && !window.confirm(`放弃剩余 ${queue.remaining} 次攻击并结束回合？`)) return; store.nextTurn(); }}>结束回合</button>}
        {!alive && !actor.deathSaves?.dead && <button className="hud-shortcut" disabled={store.readOnly} onClick={() => store.rollDeathSave(actor.id)}>死亡豁免</button>}
      </div> : <div className="hud-wait"><span>{pr ? '等待反应选择' : store.readOnly ? '同步视图' : store.aiAutoPlay ? 'AI 正在行动' : 'AI 已暂停'}</span>{!store.aiAutoPlay && !store.readOnly && store.battleActive && !pr && isAiControlled(actor) && <button onClick={() => store.takeAiStep()}><Play size={16}/>AI 单步</button>}</div>}
    </div>
    <Dialog open={readyOpen} onOpenChange={setReadyOpen}><DialogContent portalContainer={boundary} className="dnd-theme max-w-sm"><DialogHeader><DialogTitle>预备动作 · {actor.name}</DialogTitle></DialogHeader>
      <p className="hud-ready-note">预备法术时立即消耗法术位并维持专注；本面板支持单体动作，触发时攻击一次。</p>
      <label>动作<select className="hud-form-input" value={readyId} onChange={e => setReadyId(e.target.value)}><option value="">选择动作</option>{abilities.filter(a => !a.genericCast && !a.bonusAction && !a.reaction && a.kind !== 'save-aoe').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>触发条件<input className="hud-form-input" value={readyText} onChange={e => setReadyText(e.target.value)} placeholder="例如：地精从门口露头"/></label>
      <button className="hud-dialog-button" disabled={!readyId || actionDisabled} onClick={() => { const ab=abilities.find(a => a.id === readyId); if (ab) { store.setReadyAction(actor.id,ab.id,ab.name,readyText); setReadyOpen(false); } }}>登记预备</button>
    </DialogContent></Dialog>
    <Dialog open={readyTrigger} onOpenChange={setReadyTrigger}><DialogContent portalContainer={boundary} className="dnd-theme max-w-sm"><DialogHeader><DialogTitle>触发预备反应</DialogTitle></DialogHeader>
      <label>预备者<select className="hud-form-input" value={triggerOwner?.id ?? ''} onChange={e => setReadyOwner(e.target.value)}>{readied.map(u => <option key={u.id} value={u.id}>{u.name} · {u.readyAction?.abilityName}</option>)}</select></label>
      <p>{triggerOwner?.readyAction?.triggerText}</p><label>目标<select className="hud-form-input" value={readyTarget} onChange={e => setReadyTarget(e.target.value)}><option value="">选择触发目标</option>{triggerChoices.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      {triggerReason && <p>{triggerReason}</p>}
      <button className="hud-dialog-button" disabled={store.readOnly || !!pr || !!triggerReason || !readyTarget || !triggerOwner || triggerOwner.actionEconomy.reaction || !!triggerOwner.reactionUsedTurn} onClick={() => { if (triggerOwner) { store.triggerReadyAction(triggerOwner.id,readyTarget); setReadyTrigger(false); } }}>以反应触发</button>
    </DialogContent></Dialog>
    <SpellCastDialog portalContainer={boundary} open={!!generic} onOpenChange={v => { if (!v) setGeneric(null); }} actor={actor} units={store.units} request={generic ?? {abilityId:'',name:'',baseLevel:0}}
      onCast={(ability,castLevel,consumeSlot) => { ui.begin({actorId:actor.id,ability,castLevel,consumeSlot}); setGeneric(null); }}/>
  </div>;
}
