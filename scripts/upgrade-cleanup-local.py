from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]
p = root / 'src/store/battleStore.ts'
t = p.read_text(encoding='utf-8')
t = t.replace('const _applied = get().damageUnit', 'get().damageUnit')
t = re.sub(r'const _applied = r.damageTaken > 0\s*\? (get\(\)\.damageUnit\([^;]+?\))\s*: 0;', r'if (r.damageTaken > 0) \1;', t)
t = t.replace('magicSource: ability.magic === true', 'magicSource: ability.magic === true || ability.spellLevel !== undefined')
t = t.replace('source: actorId })', 'source: actorId, magicSource: ability.magic === true || ability.spellLevel !== undefined })')
t = t.replace('magicSource: ability.magic === true || ability.spellLevel !== undefined || ability.spellLevel !== undefined', 'magicSource: ability.magic === true || ability.spellLevel !== undefined')
t = t.replace("          } else if (dmgRoll.total > 0) {", "          } else {\n            if (ability.applyStatus) get().applyAbilityEffect(tid, actorId, ability);")
t = t.replace('            const _applied =', '            const _applied =')
t = t.replace("    const unit = get().units.find(u => u.id === id);\n    if (!unit) return;\n    const r = resolveDeathSave", "    const unit = get().units.find(u => u.id === id);\n    if (!unit || unit.hp > 0 || unit.deathSaves?.dead || unit.deathSaves?.stable) return;\n    const r = resolveDeathSave")
t = t.replace('stabilizeUnit: (id: string) => void;', 'stabilizeUnit: (id: string, healerId?: string) => void;')
start = t.index('  stabilizeUnit: (id) => {')
end = t.index('  // F3：充能/限次动作消耗', start)
t = t[:start] + '''  stabilizeUnit: (id, healerId) => {
    const s = get();
    const unit = s.units.find(u => u.id === id);
    const healer = s.units.find(u => u.id === (healerId ?? s.turn.currentUnitId));
    if (s.readOnly || !unit || unit.deathSaves?.dead || (!unit.knockedOut && unit.hp > 0) || !healer || healer.hp <= 0 || aggregateEffects(healer.statuses).noActions) return;
    if (unitDistance(unit, healer, s.mapConfig.diagonal) > 5 || (s.battleActive && (healer.id !== s.turn.currentUnitId || healer.actionEconomy.action))) return;
    const roll = rollFormula('1d20', { bonus: abilityMod(healer.abilities?.wis ?? 10) - exhaustionPenalty(healer.statuses) });
    const success = roll.total >= 10;
    set({ lastRoll: { id: uid(), formula: '1d20+感知（医药 DC10）', result: roll, note: '急救' }, units: get().units.map(u => u.id === unit.id && success
      ? { ...u, knockedOut: false, deathSaves: { successes: 0, failures: 0, stable: u.hp <= 0, dead: false }, statuses: u.knockedOut ? u.statuses.filter(st => st !== 'unconscious') : u.statuses }
      : u.id === healer.id ? { ...u, actionEconomy: { ...u.actionEconomy, action: true } } : u) });
    get().logEvent({ type: 'stabilize', actorId: healer.id, targetId: id, text: `${healer.name} 为 ${unit.name} 急救：${roll.total} vs DC10 —— ${success ? (unit.knockedOut ? '苏醒' : '伤势稳定') : '失败'}`, level: success ? 'good' : 'bad' });
    persist(get());
  },

''' + t[end:]
t = t.replace('const roll = rollFormula(\'1d20\');\n        if (roll.total >= st.recharge)', 'const roll = rollFormula(\'1d6\');\n        if (roll.total >= st.recharge)')
t = t.replace('充能恢复（d20=', '充能恢复（d6=').replace('充能未恢复（d20=', '充能未恢复（d6=').replace('回合开始 d20≥', '回合开始 d6≥')
# Recharge on the owner's turn, not all creatures only on round boundaries.
t = t.replace('      if (!u.abilityUses) return u;', '      if (!u.abilityUses || u.id !== get().turn.currentUnitId) return u;')
t = t.replace('      get().restoreRecharges();', '')
t = t.replace("    get().processEffects(result.newUnitId, 'start');", "    get().restoreRecharges();\n    get().processEffects(result.newUnitId, 'start');")
t = t.replace('  if (getRules', '  if (getRules')
p.write_text(t, encoding='utf-8')
# Correct assertions to official rules, while preserving attack natural-roll coverage.
p = root / 'scripts/engine-tests.ts'
t = p.read_text(encoding='utf-8')
t = t.replace("check('judgeCheck 裸20大成功', judgeCheck(rollFormula('1d20', { forcedRolls: [20] }), 30).outcome === 'critical-success');", "check('普通检定裸20仍不足DC30', judgeCheck(rollFormula('1d20', { forcedRolls: [20] }), 30).outcome === 'failure');")
t = t.replace("check('judgeCheck 裸1大失败', judgeCheck(rollFormula('1d20', { forcedRolls: [1] }), 5).outcome === 'critical-failure');", "check('普通检定裸1加值足够仍成功', judgeCheck(rollFormula('1d20', { bonus: 20, forcedRolls: [1] }), 5).outcome === 'success');")
t = t.replace('judgeCheck(advNotCrit, 15)', "judgeCheck(advNotCrit, 15, 'attack')").replace('judgeCheck(advCrit, 15)', "judgeCheck(advCrit, 15, 'attack')").replace('judgeCheck(disNotCrit, 15)', "judgeCheck(disNotCrit, 15, 'attack')")
p.write_text(t, encoding='utf-8')
p = root / 'scripts/action-flow-tests.cjs'
t = p.read_text(encoding='utf-8').replace('assert.equal(u.hp, 0); assert.equal(u.deathSaves?.dead, false); assert.equal(u.deathSaves?.stable, true);', "assert.equal(u.hp, 1); assert.equal(u.deathSaves?.dead, false); assert.equal(u.knockedOut, true); assert.ok(u.statuses.includes('unconscious'));")
t = t.replace("assert.ok(!p.affected.some(u=>u.id==='left'||u.id==='down'||u.id==='hero'));", "assert.ok(!p.affected.some(u=>u.id==='left'));assert.ok(p.affected.some(u=>u.id==='down'));")
t = t.replace("assert.equal(after.hp,u.hp-(p.affected.some(x=>x.id===u.id)?6:0));", "assert.equal(after.hp,Math.max(0,u.hp-(p.affected.some(x=>x.id===u.id)?6:0))); if (u.id==='down') assert.equal(after.deathSaves.failures,1);")
p.write_text(t, encoding='utf-8')
for file in ['src/lib/engine/types.ts','src/lib/engine/statblocks.ts','src/lib/engine/conditions.ts','src/lib/engine/rules.ts','src/store/battleStore.ts']:
    p=root/file
    t=p.read_text(encoding='utf-8').replace('回合开始掷 d20', '回合开始掷 d6').replace('回合开始 d20', '回合开始 d6').replace('10 级死亡', '6 级死亡').replace('力竭达到 10', '力竭达到 6')
    p.write_text(t,encoding='utf-8')
