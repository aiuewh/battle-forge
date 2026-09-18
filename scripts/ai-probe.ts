/**
 * AI 回合执行探针：绕过 AiDriver 定时器，同步驱动 takeAiStep，
 * 打印当前行动者的全部步骤事件，用于排查移动日志异常
 */
import { useBattleStore } from '../src/store/battleStore';

async function main() {
  const store = useBattleStore.getState();
  store.reset();
  store.loadDemoBattle();
  // 全自动模拟：玩家单位也交给 AI（用攻击动作模拟），观察多回合行为
  const st0 = useBattleStore.getState();
  for (const u of st0.units) {
    useBattleStore.getState().updateUnit(u.id, { playerControlled: false, isPlayer: false });
  }
  store.startCombat();

  let guard = 0;
  while (guard++ < 600) {
    const s = useBattleStore.getState();
    if (!s.battleActive || s.turn.ended) break;
    const unit = s.units.find(u => u.id === s.turn.currentUnitId);
    if (!unit) break;
    const more = s.takeAiStep();
    if (!more) {
      // 玩家操控单位回合 → 手动推进
      const cur = useBattleStore.getState();
      if (cur.battleActive && !cur.turn.ended) cur.nextTurn();
      else break;
    }
  }

  const events = useBattleStore.getState().events;
  for (const e of events) {
    if (e.type === 'unit-add' || e.type === 'note') continue;
    console.log(`[${e.round}] (${e.type}) ${e.text}`);
  }
  const s2 = useBattleStore.getState();
  console.log('\n=== 单位状态 ===');
  for (const u of s2.units) {
    console.log(`${u.name} hp=${u.hp}/${u.maxHp} pos=(${u.pos.x / 5},${u.pos.y / 5}) used=${u.actionEconomy.movementUsed}ft acted=${u.hasActed}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
