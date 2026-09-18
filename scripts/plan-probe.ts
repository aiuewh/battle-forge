/**
 * 计划生成探针：直接调用 planTurn 打印 Boss 回合的步骤列表
 */
import { useBattleStore } from '../src/store/battleStore';
import { planTurn, type AiContext } from '../src/lib/engine/ai';

async function main() {
  const store = useBattleStore.getState();
  store.reset();
  store.loadDemoBattle();

  const s = useBattleStore.getState();
  const boss = s.units.find(u => u.id === 'boss')!;
  const ctx: AiContext = {
    units: s.units,
    obstacles: s.obstacles,
    diagonal: s.mapConfig.diagonal,
    mapWidth: s.mapConfig.width,
    mapHeight: s.mapConfig.height,
    playerTargetId: null,
  };
  const steps = planTurn(ctx, boss);
  console.log('=== Boss 计划步骤 ===');
  steps.forEach((st, i) => {
    if (st.type === 'move') console.log(`${i}. move → (${st.path[0].cx},${st.path[0].cy})`);
    else if (st.type === 'attack') console.log(`${i}. attack ${st.abilityId} → ${st.targetId}`);
    else console.log(`${i}. ${st.type}`);
  });
  console.log('\n地图占用情况（x=敌方 o=友方 #=墙 c=箱）:');
  const occ = new Map<string, string>();
  for (const u of s.units) {
    const cx = u.pos.x / 5, cy = u.pos.y / 5;
    occ.set(`${cx},${cy}`, u.attitude === 2 ? 'x' : 'o');
  }
  const blocked = new Set<string>();
  for (const o of s.obstacles) {
    for (const c of o.cells) blocked.add(`${c.cx},${c.cy}`);
  }
  for (let y = 0; y < 9; y++) {
    let row = '';
    for (let x = 0; x < 22; x++) {
      const k = `${x},${y}`;
      row += occ.get(k) ?? (blocked.has(k) ? '#' : '.');
    }
    console.log(row);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
