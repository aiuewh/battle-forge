from pathlib import Path
root = Path(__file__).resolve().parents[1]
p = root / 'src/store/battleStore.ts'
text = p.read_text(encoding='utf-8')
text = text.replace('aoeCells, unitDistance, cellCenter,', 'aoeCells, unitDistance, cellCenter, findPath, movementStepCost,')
text = text.replace('recordEvent?: boolean) => void;', "recordEvent?: boolean, mode?: 'voluntary' | 'forced' | 'teleport') => void;")
start = text.index('  moveUnit: (id, pos, recordEvent = true) => {')
end = text.index('  toggleStatus:', start)
text = text[:start] + '''  moveUnit: (id, pos, recordEvent = true, mode = 'voluntary') => {
    const s = get();
    if (s.readOnly) return;
    const unit = s.units.find(u => u.id === id);
    if (!unit || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    if (mode !== 'voluntary') {
      const dest = posToCell(pos), span = SIZE_META[unit.size]?.cells ?? 1;
      if (dest.cx < 0 || dest.cy < 0 || dest.cx + span > s.mapConfig.width || dest.cy + span > s.mapConfig.height) return;
      const occupied = s.units.filter(u => u.id !== id).flatMap(u => unitOccupiedCells(u).map(cellKey));
      const cells = unitOccupiedCells({ ...unit, pos }).map(cellKey);
      const blocked = buildBlockedCells(s.obstacles);
      if (cells.some(c => occupied.includes(c) || blocked.get(c) === 'full')) return;
      set({ units: get().units.map(u => u.id === id ? { ...u, pos } : u) });
      if (recordEvent) get().logEvent({ type: 'move', actorId: id, text: `${unit.name} ${mode === 'forced' ? '被推移' : '传送'} → (${dest.cx},${dest.cy})`, level: 'info' });
      persist(get()); return;
    }
    if (s.battleActive && (unit.id !== s.turn.currentUnitId || unit.hp <= 0 || aggregateEffects(unit.statuses).noActions)) return;
    const opts = { ignoreFullObstacles: unit.moveMode === 'fly', mapWidth: s.mapConfig.width, mapHeight: s.mapConfig.height };
    const route = findPath(posToCell(unit.pos), posToCell(pos), s.units, s.obstacles, unit, s.mapConfig.diagonal, opts);
    if (!route.reachable || (s.battleActive && route.costCells * 5 > remainingMovement(unit))) return;
    let traveled = 0;
    for (const next of route.path.slice(1)) {
      let mover = get().units.find(u => u.id === id);
      if (!mover || mover.hp <= 0 || mover.deathSaves?.dead || aggregateEffects(mover.statuses).noActions) break;
      const destination = { x: next.cx * 5, y: next.cy * 5 };
      const step = movementStepCost(posToCell(mover.pos), next, mover, get().units, get().obstacles, s.mapConfig.diagonal, mover.actionEconomy.diagonalSteps ?? 0, opts);
      if (s.battleActive && step.feet > remainingMovement(mover)) break;
      if (s.battleActive) for (const t of movementThreats(currentAiCtx(get()), mover, destination)) {
        const threat = get().units.find(u => u.id === t.unit.id);
        mover = get().units.find(u => u.id === id);
        if (!threat || !mover || threat.hp <= 0 || threat.actionEconomy.reaction || aggregateEffects(threat.statuses).noReactions) continue;
        const cover = estimateCover(threat, mover, get().obstacles, buildBlockedCells(get().obstacles));
        if (cover.cover === 'full') continue;
        set({ units: get().units.map(u => u.id === threat.id ? { ...u, actionEconomy: { ...u.actionEconomy, reaction: true }, reactionUsedTurn: true, reactionsUsedRound: (u.reactionsUsedRound ?? 0) + 1 } : u) });
        get().logEvent({ type: 'attack', actorId: threat.id, targetId: id, text: `⚡ ${threat.name} 在 ${mover.name} 离开触及前借机攻击`, level: 'bad' });
        get().performAttack(threat.id, id, { attackBonus: t.ability.attackBonus ?? 0, targetAc: mover.ac + coverBonus(cover.cover), weaponDamage: t.ability.dice, weaponType: t.ability.damageType, coverKind: cover.cover, isRanged: false, magicSource: t.ability.magic === true });
      }
      mover = get().units.find(u => u.id === id);
      if (!mover || mover.hp <= 0 || mover.deathSaves?.dead || aggregateEffects(mover.statuses).noActions || (s.battleActive && step.feet > remainingMovement(mover))) break;
      set({ units: get().units.map(u => u.id === id ? { ...u, pos: destination, actionEconomy: { ...u.actionEconomy, movementUsed: u.actionEconomy.movementUsed + step.feet, diagonalSteps: (u.actionEconomy.diagonalSteps ?? 0) + (step.diagonalStep ? 1 : 0) } } : u) });
      traveled += step.feet;
    }
    if (recordEvent && traveled > 0) get().logEvent({ type: 'move', actorId: id, text: `${unit.name} 沿路径移动，消耗 ${traveled} 尺`, level: 'info' });
    persist(get());
  },

''' + text[end:]
text = text.replace('aoeCells, unitDistance, cellCenter, findPath, movementStepCost,', 'aoeCells, unitDistance, cellCenter, findPath, movementStepCost, unitOccupiedCells, cellKey,')
text = text.replace('coverBonus, effectiveSpeed,', 'coverBonus, effectiveSpeed, remainingMovement,')
text = text.replace('store.moveUnit(target.id, dest, true);', "store.moveUnit(target.id, dest, true, 'forced');")
text = text.replace('get().moveUnit(strikeTarget.id, sDest, true);', "get().moveUnit(strikeTarget.id, sDest, true, 'forced');")
text = text.replace('consumeSlot: !!unit.spellSlots });\n        }\n        return true;\n      }\n      case \'aoe\'', 'consumeSlot: !!unit.spellSlots, ignoreEconomy: ability.spellLevel === undefined && unit.actionEconomy.action });\n        }\n        return true;\n      }\n      case \'aoe\'')
text = text.replace('runMultiAttackSequence(get, set, actorId, ability, target.id, times,', 'runMultiAttackSequence(get, set, actorId, { ...ability, dice: effDice }, target.id, times,')
p.write_text(text, encoding='utf-8')
