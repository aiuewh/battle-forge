from pathlib import Path

root = Path(__file__).resolve().parents[1]
def edit(file, old, new, count=1):
    p = root / file
    text = p.read_text(encoding='utf-8')
    if text.count(old) < count:
        raise RuntimeError(f'Missing replacement in {file}: {old[:90]}')
    p.write_text(text.replace(old, new, count), encoding='utf-8')

s = 'src/store/battleStore.ts'
edit(s, "import { abilityTargetCheck, movementPreview, movementThreats }", "import { abilityTargetCheck, abilityPreview, movementPreview, movementThreats }")
edit(s, "const STORAGE_KEY =", "import { addAbilityEffect, endConcentrationEffects, migrateUnits, removeEffects } from '@/lib/engine/effects';\nimport { ENGINE_VERSION, SAVE_VERSION, PROTOCOL_VERSION } from '@/lib/engine/version';\n\nconst STORAGE_KEY =")
# Concentration is now handled exactly once by damageUnit, after resistance/reaction reductions.
p = root / s
text = p.read_text(encoding='utf-8')
start = text.index('      // 专注豁免\n', text.index('  performAttack:'))
end = text.index('      // 反应【被命中后·攻击类】', start)
text = text[:start] + text[end:]
import re
text = re.sub(r'^\s*(?:if \(applied > 0\) )?get\(\)\.concentrationAfterDamage\((?:tid|t\.id|target\.id|attacker\.id), [^;]+;\n', '\n', text, flags=re.M)
p.write_text(text, encoding='utf-8')
edit(s, "const data = {\n      units:", "const data = {\n      saveVersion: SAVE_VERSION, engineVersion: ENGINE_VERSION, protocolVersion: PROTOCOL_VERSION,\n      units:")
edit(s, 'units: data.units ?? [],', 'units: migrateUnits(data.units ?? []),', 2)
edit(s, 'units: data.units,', 'units: migrateUnits(data.units),')
edit(s, 'version: 1,\n      exportedAt:', 'version: SAVE_VERSION, engineVersion: ENGINE_VERSION, protocolVersion: PROTOCOL_VERSION,\n      battleActive: s.battleActive,\n      exportedAt:')
edit(s, "battleName: data.battleName ?? '导入战报',\n        battleActive: true,", "battleName: data.battleName ?? '导入战报',\n        battleActive: data.battleActive ?? !data.turn?.ended,")
edit(s, "set({ units: get().units.map(u => (u.id === id ? { ...u, concentration: spell ?? undefined } : u)) });", "const cleared = endConcentrationEffects(get().units, id);\n    set({ units: cleared.map(u => (u.id === id ? { ...u, concentration: spell ?? undefined } : u)) });")
edit(s, "    if (dead) {\n      get().logEvent({ type: 'death', actorId: id, text: `💀 ${unit.name} 力竭衰竭而死`, level: 'crit' });\n    }", "    if (dead) {\n      get().logEvent({ type: 'death', actorId: id, text: `💀 ${unit.name} 力竭衰竭而死`, level: 'crit' });\n    }\n    if (unit.concentration && (dead || aggregateEffects(statuses).noActions)) get().setConcentration(id, null);")
edit(s, "    const { turn, units, rules } = get();\n    // 反应", "    const { turn, rules } = get();\n    get().processEffects(turn.currentUnitId, 'end');\n    // 反应")
edit(s, '    const result = advanceTurn(turn, units, rules);', '    const units = get().units;\n    const result = advanceTurn(turn, units, rules);')
edit(s, 'const base = { ...u, reactionUsedTurn: false };', 'const base = { ...u, reactionUsedTurn: false, slotCastThisTurn: false };')
edit(s, "    const nu = get().units.find(u => u.id === result.newUnitId);", "    get().processEffects(result.newUnitId, 'start');\n    const nu = get().units.find(u => u.id === result.newUnitId);")
edit(s, 'actionEconomy: defaultActionEconomy(), hasActed: false', 'actionEconomy: defaultActionEconomy(), slotCastThisTurn: false, hasActed: false')
edit(s, '  // ---- 持久化 ----', "  processEffects: (unitId: string | null, timing: 'start' | 'end') => void;\n  applyAbilityEffect: (targetId: string, sourceId: string, ability: AiAbility) => void;\n  // ---- 持久化 ----")
edit(s, '  // ---------------- 统一行动结算 ----------------', '''  applyAbilityEffect: (targetId, sourceId, ability) => {
    const source = get().units.find(u => u.id === sourceId);
    if (!source || !ability.applyStatus) return;
    set({ units: get().units.map(u => u.id === targetId ? addAbilityEffect(u, source, ability, uid()) : u) });
    const target = get().units.find(u => u.id === targetId);
    if (target?.concentration && aggregateEffects(target.statuses).noActions) get().setConcentration(targetId, null);
  },

  processEffects: (unitId, timing) => {
    if (!unitId) return;
    const unit = get().units.find(u => u.id === unitId);
    if (!unit) return;
    const expired = new Set<string>();
    for (const effect of unit.effects ?? []) {
      if (effect.repeatSave?.timing === timing) {
        const result = resolveSave(unit, effect.repeatSave);
        const passed = result.check.outcome === 'success';
        get().logEvent({ type: 'save', actorId: unit.id, text: `${unit.name} 解除【${effect.name}】${result.check.label}：${result.check.total} —— ${passed ? '成功' : '失败'}`, level: passed ? 'good' : 'info' });
        if (passed) expired.add(effect.id);
      }
      if (timing === 'end' && effect.remainingRounds !== undefined && effect.remainingRounds <= 1) expired.add(effect.id);
    }
    set({ units: get().units.map(u => u.id !== unitId ? u : {
      ...removeEffects(u, e => expired.has(e.id)),
      effects: (u.effects ?? []).filter(e => !expired.has(e.id)).map(e => timing === 'end' && e.remainingRounds !== undefined ? { ...e, remainingRounds: e.remainingRounds - 1 } : e),
    }) });
  },

  // ---------------- 统一行动结算 ----------------''')
# AI decision stays in ai.ts; supported actions share player validation and settlement.
p = root / s
text = p.read_text(encoding='utf-8')
start = text.index('          // 攻击法术结算法术位：', text.index('  takeAiStep:'))
end = text.index("      case 'flee-note':", start)
text = text[:start] + '''          get().castAbility(unit.id, ability.id, target.id, { abilityOverride: { ...ability, multiAttack: 1 }, consumeSlot: !!unit.spellSlots });
        }
        return true;
      }
      case 'aoe': {
        const ability = unitAbilities(unit).find(a => a.id === step.abilityId);
        if (ability) get().castAbility(unit.id, ability.id, undefined, { abilityOverride: ability, originPos: step.origin, angle: step.angle, consumeSlot: !!unit.spellSlots });
        return true;
      }
      case 'save-single':
      case 'heal': {
        const ability = unitAbilities(unit).find(a => a.id === step.abilityId);
        if (ability) get().castAbility(unit.id, ability.id, step.targetId, { abilityOverride: ability, consumeSlot: !!unit.spellSlots });
        return true;
      }
''' + text[end:]
# Delete helpers superseded by the shared casting entry.
start = text.index('function resolveAiCast(')
end = text.index('/**\n * 玩家多重攻击', start)
text = text[:start] + text[end:]
text = text.replace("['move', 'attack', 'aoe', 'heal'].includes", "['move', 'attack', 'aoe', 'heal', 'save-single'].includes")
text = text.replace("if (!actor) return;\n    const cover =", "if (!actor || aggregateEffects(actor.statuses).noActions) return;\n    const cover =")
text = text.replace("if (!target || target.hp <= 0 || target.deathSaves?.dead) break;", "if (!target || target.hp <= 0 || target.deathSaves?.dead || target.knockedOut) break;")
# A cast may be outside own turn only through an explicitly declared reaction/readied action.
text = text.replace("const isCurrentActor = s.battleActive && s.turn.currentUnitId === actorId;", "const isCurrentActor = s.battleActive && s.turn.currentUnitId === actorId;\n    if (s.battleActive && !isCurrentActor && !opts.ignoreEconomy && !ability.reaction) return false;")
text = text.replace("const cost: 'action' | 'bonus' = ability.bonusAction ? 'bonus' : 'action';", "const cost: 'action' | 'bonus' | 'reaction' = ability.reaction ? 'reaction' : ability.bonusAction ? 'bonus' : 'action';")
text = text.replace("    // 法术位检查：升环", "    if (!opts.ignoreEconomy && cost === 'reaction' && actor.actionEconomy.reaction) return false;\n    if (s.battleActive && (ability.spellLevel ?? 0) > 0 && opts.consumeSlot !== false && actor.slotCastThisTurn) {\n      get().logEvent({ type: 'note', text: '本回合已消耗过法术位施法，可选择戏法或不消耗法术位的能力', level: 'bad' });\n      return false;\n    }\n    // 法术位检查：升环")
text = text.replace("    const prevActionUsed = actor.actionEconomy.action;", "    const prevActionUsed = actor.actionEconomy.action;\n    if (ability.concentration) get().setConcentration(actorId, ability.name);")
text = text.replace("if (cost === 'bonus') {\n            eco.bonus = true;", "if (cost === 'reaction') {\n            eco.reaction = true;\n            eco.action = prevActionUsed;\n          } else if (cost === 'bonus') {\n            eco.bonus = true;")
text = text.replace("if (isCurrentActor && !opts.ignoreEconomy) {\n          const eco", "if ((isCurrentActor || cost === 'reaction') && !opts.ignoreEconomy) {\n          const eco")
text = text.replace("next.spellSlots = {", "next.slotCastThisTurn = true;\n          next.spellSlots = {")
text = text.replace("        if (ability.concentration) next.concentration = ability.name;", "")
text = text.replace("            set({ units: get().units.map(u => (u.id === target.id ? { ...u, statuses: [...new Set([...u.statuses, ability.applyStatus!])] } : u)) });", "            get().applyAbilityEffect(target.id, actorId, ability);")
text = text.replace("              set({ units: get().units.map(u => (u.id === tid ? { ...u, statuses: [...new Set([...u.statuses, ability.applyStatus!])] } : u)) });", "              get().applyAbilityEffect(tid, actorId, ability);")
text = text.replace("halfOnSuccess: ability.halfOnSuccess,", "halfOnSuccess: ability.halfOnSuccess, damageOnSuccess: ability.damageOnSuccess,")
# Unified AoE preview is also the execution's affected set (including self/downed).
text = text.replace("const affected = aoeCells(template, get().units).affectedUnitIds.filter(id => id !== actorId);", "const affected = abilityPreview(actor, ability, target, get().units, s.obstacles, s.mapConfig.diagonal, { originPos: origin, angle }).affected.map(u => u.id);")
text = text.replace("if (!t || t.hp <= 0 || t.deathSaves?.dead) continue;\n            if (ability.saveAbility)", "if (!t || t.deathSaves?.dead) continue;\n            if (ability.saveAbility)")
text = text.replace("const covT = estimateCover(actor, t, s.obstacles, buildBlockedCells(s.obstacles));", "const covT = estimateCover({ ...actor, pos: origin }, t, s.obstacles, buildBlockedCells(s.obstacles));")
text = text.replace("{ type: ability.damageType, source: actorId });", "{ type: ability.damageType, source: actorId, magicSource: ability.magic === true || ability.spellLevel !== undefined });")
# Beneficial no-save state spells must apply their declared effect.
text = text.replace("          const appliedAuto =", "          if (ability.applyStatus) get().applyAbilityEffect(target.id, actorId, ability);\n          const appliedAuto =")
text = re.sub(r'const applied(?:Auto|Save|AoeSave|AoeAuto|Lair) =', 'const _applied =', text) # Remove obsolete returns next pass.
text = text.replace("if (target && (ability.kind === 'melee' || ability.kind === 'ranged'))", "if (target && !ability.ignoresCover)")
p.write_text(text, encoding='utf-8')

edit('src/lib/engine/combat.ts', '  const raw = dice.rawD20 ?? 0;\n  const success = dice.total >= dc;', '  const success = dice.total >= dc;')
edit('src/lib/engine/sheetbridge.ts', "applyStatus: 'paralyzed', spellLevel: 2, concentration: true,", "applyStatus: 'paralyzed', spellLevel: 2, concentration: true, requiresSight: true, durationRounds: 10, repeatSave: { ability: 'wis', dc, timing: 'end' },")
edit('src/lib/engine/sheetbridge.ts', "applyStatus: 'paralyzed', spellLevel: 5, concentration: true", "applyStatus: 'paralyzed', spellLevel: 5, concentration: true, requiresSight: true, durationRounds: 10, repeatSave: { ability: 'wis', dc, timing: 'end' }")
