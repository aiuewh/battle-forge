from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'src/store/battleStore.ts'
t=p.read_text(encoding='utf-8')
t=t.replace("const STORAGE_KEY =", "let settlementDepth = 0;\nlet pendingPersist = false;\nlet resolvedReactionPair = '';\n\nconst STORAGE_KEY =")
t=t.replace("  if (state.readOnly && !force) return;", "  if (state.readOnly && !force) return;\n  if (settlementDepth > 0 && !force) { pendingPersist = true; return; }")
t=t.replace("    const target = get().units.find(u => u.id === targetId);\n    if (target?.concentration", "    const target = get().units.find(u => u.id === targetId);\n    if (target?.concentration")
t=t.replace("if (!source || !ability.applyStatus) return;", "if (!source || !ability.applyStatus || (ability.concentration && source.concentration !== ability.name)) return;")
t=t.replace("const _rs = target.playerControlled && !target.actionEconomy.reaction", "const _rs = resolvedReactionPair !== `${unit.id}:${target.id}` && (target.playerControlled || target.isPlayer) && !target.actionEconomy.reaction && !target.slotCastThisTurn && !aggregateEffects(target.statuses).noActions")
t=t.replace("          get().castAbility(unit.id, ability.id, target.id,", "          resolvedReactionPair = '';\n          get().castAbility(unit.id, ability.id, target.id,")
t=t.replace("    if (cast) {\n      const target", "    resolvedReactionPair = `${pending.attackerId}:${pending.targetId}`;\n    if (cast) {\n      const target")
t=t.replace("      if (target) {\n        // E11", "      if (target && target.hp > 0 && !aggregateEffects(target.statuses).noActions && !target.actionEconomy.reaction && !target.slotCastThisTurn && (pending.spellLevel === 0 || (target.spellSlots?.[pending.spellLevel]?.current ?? 0) > 0)) {\n        // E11")
t=t.replace("        if (pending.spellLevel > 0) get().spendSpellSlot(target.id, pending.spellLevel);", "        if (pending.spellLevel > 0) { get().spendSpellSlot(target.id, pending.spellLevel); get().updateUnit(target.id, { slotCastThisTurn: true }); }")
# Remove unsupported pre-hit rebuke execution: only shield is offered before an attack.
t=t.replace("a.reaction === true\n              && a.spellPrepared", "a.reaction === true && /护盾|shield/i.test(a.name)\n              && a.spellPrepared")
# Readied spell pays now and must retain concentration until release; unsuccessful targeting does not spend reaction.
start=t.index('  setReadyAction: (unitId, abilityId, abilityName, triggerText) => {')
end=t.index('  clearHistory:',start)
t=t[:start]+'''  setReadyAction: (unitId, abilityId, abilityName, triggerText) => {
    const s = get(), unit = s.units.find(u => u.id === unitId);
    const ability = unit?.aiAbilities?.find(a => a.id === abilityId);
    if (s.readOnly || !unit || !ability || unit.hp <= 0 || aggregateEffects(unit.statuses).noActions || ability.bonusAction || ability.reaction || ability.kind === 'save-aoe') return;
    if (s.battleActive && (unit.id !== s.turn.currentUnitId || unit.actionEconomy.action)) return;
    const isSpell = ability.spellLevel !== undefined;
    const cast = resolveCastSlot(unit, ability.spellLevel ?? 0);
    if (isSpell && (!cast.ok || ((ability.spellLevel ?? 0) > 0 && unit.slotCastThisTurn))) return;
    if (isSpell) {
      if (cast.level > 0) { get().spendSpellSlot(unitId, cast.level); get().updateUnit(unitId, { slotCastThisTurn: true }); }
      get().setConcentration(unitId, `预备：${abilityName}`);
    }
    set({ units: get().units.map(u => u.id === unitId ? { ...u,
      readyAction: { abilityId, abilityName, triggerText: triggerText || '触发条件（自定）', castLevel: isSpell ? cast.level : undefined, requiresConcentration: isSpell },
      actionEconomy: { ...u.actionEconomy, action: true } } : u) });
    get().logEvent({ type: 'note', actorId: unitId, text: `${unit.name} 预备【${abilityName}】${isSpell ? `（已消耗${cast.level}环位·维持专注）` : ''}，等待 ${triggerText || '自定条件'}`, level: 'info' });
    persist(get());
  },

  triggerReadyAction: (unitId, targetId) => {
    const unit = get().units.find(u => u.id === unitId), ra = unit?.readyAction;
    if (get().readOnly || !unit || !ra || unit.actionEconomy.reaction || unit.reactionUsedTurn || (ra.requiresConcentration && unit.concentration !== `预备：${ra.abilityName}`)) return;
    const ability = unit.aiAbilities?.find(a => a.id === ra.abilityId);
    if (!ability) return;
    const released = { ...ability, multiAttack: 1, dice: applyUpcast(ability.dice, ability.spellLevel ?? 0, ra.castLevel ?? ability.spellLevel ?? 0, ability.upcast), concentration: ability.concentration, upcast: undefined };
    if (!get().castAbility(unitId, ra.abilityId, targetId, { abilityOverride: released, ignoreEconomy: true, consumeSlot: false })) return;
    set({ units: get().units.map(u => u.id === unitId ? { ...u, readyAction: undefined, actionEconomy: { ...u.actionEconomy, reaction: true }, reactionUsedTurn: true } : u) });
    if (ra.requiresConcentration && !ability.concentration) get().setConcentration(unitId, null);
    get().logEvent({ type: 'note', actorId: unitId, text: `${unit.name} 以反应释放预备【${ra.abilityName}】`, level: 'info' });
    persist(get());
  },
''' + t[end:]
t=t.replace("            tempAcBonus: 0,", "            tempAcBonus: 0,\n            readyAction: undefined,")
t=t.replace("    const cleared = endConcentrationEffects(get().units, id);", "    const cleared = endConcentrationEffects(get().units, id).map(u => u.id === id && u.readyAction?.requiresConcentration ? { ...u, readyAction: undefined } : u);")
t=t.replace("    const s2 = get();\n    set({ turnSnap:", "    const readyExpired = get().units.find(u => u.id === result.state.currentUnitId);\n    if (readyExpired?.concentration?.startsWith('预备：')) get().setConcentration(readyExpired.id, null);\n    const s2 = get();\n    set({ turnSnap:")
t+='''
// Nested actions persist once at the outer settlement boundary, including reactions/effects.
const transactional = ['castAbility', 'continueMultiAttack', 'damageUnit', 'moveUnit', 'performAttack', 'nextTurn', 'takeAiStep', 'playerAction', 'toggleStatus', 'setReadyAction', 'triggerReadyAction', 'resolvePendingReaction', 'stabilizeUnit'] as const;
for (const key of transactional) {
  const original = useBattleStore.getState()[key] as (...args: unknown[]) => unknown;
  const wrapped = (...args: unknown[]) => {
    settlementDepth++;
    try { return original(...args); }
    finally {
      settlementDepth--;
      if (settlementDepth === 0 && pendingPersist) { pendingPersist = false; persist(useBattleStore.getState()); }
    }
  };
  useBattleStore.setState({ [key]: wrapped } as Partial<BattleStore>);
}
'''
p.write_text(t,encoding='utf-8')
p=root/'src/lib/engine/types.ts'
t=p.read_text(encoding='utf-8').replace('triggerText: string };', 'triggerText: string; castLevel?: number; requiresConcentration?: boolean };')
p.write_text(t,encoding='utf-8')
p=root/'src/lib/engine/statblocks.ts'
t=p.read_text(encoding='utf-8')
t=t.replace('    halfOnSuccess,\n    multiAttack,', '''    halfOnSuccess,
    damageOnSuccess: ['none','half','full'].includes(String(o.damageOnSuccess ?? '')) ? o.damageOnSuccess as AiAbility['damageOnSuccess'] : undefined,
    excludeSelf: o.excludeSelf === true || o['排除自身'] === true,
    ignoresCover: o.ignoresCover === true || o['忽略掩护'] === true,
    requiresSight: o.requiresSight === true || o['需要看见'] === true,
    durationRounds: o.durationRounds !== undefined || o['持续轮数'] !== undefined ? Math.max(1, Math.floor(toNum(o.durationRounds ?? o['持续轮数'], 1))) : undefined,
    repeatSave: (() => {
      const value = o.repeatSave ?? o['重复豁免'];
      if (!value || typeof value !== 'object') return undefined;
      const r = value as Record<string, unknown>, raw = String(r.ability ?? r['属性'] ?? '').toLowerCase();
      const ability = ABILITY_CN[raw];
      if (!ability) return undefined;
      return { ability, dc: toNum(r.dc ?? r.DC ?? r['DC'], saveDc ?? 13), timing: r.timing === 'start' || r['时机'] === '回合开始' ? 'start' as const : 'end' as const };
    })(),
    multiAttack,''')
p.write_text(t,encoding='utf-8')
p=root/'scripts/action-flow-tests.cjs'
t=p.read_text(encoding='utf-8').replace("mk('right',{attitude:2,pos:", "mk('right',{isPlayer:false,playerControlled:false,attitude:2,pos:").replace("mk('left',{attitude:2,pos:", "mk('left',{isPlayer:false,playerControlled:false,attitude:2,pos:")
p.write_text(t,encoding='utf-8')
