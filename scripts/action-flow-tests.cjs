// Behavioral regression suite; run: node scripts/action-flow-tests.cjs
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);
};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const memory = new Map();
global.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) };
const { useBattleStore: store } = require('../src/store/battleStore.ts');
const { setRng } = require('../src/lib/engine/dice.ts');
const mk = (id, over = {}) => ({ id, name: id, init: 20, initMod: 0, hp: 30, maxHp: 30, tempHp: 0, ac: 10,
  speed: 30, pos: { x: 0, y: 0 }, attitude: 0, statuses: [], isPlayer: true, playerControlled: true, size: 'medium',
  resistances: [], immunities: [], vulnerabilities: [], hasActed: false,
  abilities: { str: 16, dex: 14, con: 12, int: 12, wis: 12, cha: 10 },
  actionEconomy: { action: false, bonus: false, reaction: false, movementUsed: 0 }, ...over });
const sword = { id: 'sword', name: '长剑', kind: 'melee', dice: '20', attackBonus: 20, range: 5, multiAttack: 2 };
function setup(units) { store.getState().reset(); store.setState({ readOnly: false, units, aiAutoPlay: false }); store.getState().startCombat(); }
let failed = 0, passed = 0;
function test(name, run) { try { run(); passed++; console.log('PASS', name); } catch (e) { failed++; console.error('FAIL', name, e.message); } }
setRng(() => 0.5);
test('Nonlethal choice survives changing the multiattack target', () => {
  setup([mk('hero', { aiAbilities: [sword] }), mk('e1', { attitude: 2, isPlayer: false, init: 0, hp: 5, pos: { x: 5, y: 0 } }), mk('e2', { attitude: 2, isPlayer: false, init: -1, hp: 5, pos: { x: 0, y: 5 } })]);
  assert.equal(store.getState().castAbility('hero', 'sword', 'e1', { nonLethal: true }), true);
  assert.equal(store.getState().multiAttackQueue?.nonLethal, true);
  store.getState().continueMultiAttack('hero', 'sword', 'e2');
  for (const id of ['e1', 'e2']) { const u = store.getState().units.find(u => u.id === id); assert.equal(u.hp, 1); assert.equal(u.deathSaves?.dead, false); assert.equal(u.knockedOut, true); assert.ok(u.statuses.includes('unconscious')); }
});
test('First-turn reset restores HP/resources and does not pop history', () => {
  setup([mk('hero', { aiAbilities: [sword] }), mk('enemy', { attitude: 2, isPlayer: false, init: 0, hp: 100, pos: { x: 5, y: 0 } })]);
  const before = JSON.stringify(store.getState().units);
  store.getState().castAbility('hero', 'sword', 'enemy');
  store.getState().resetCurrentTurn();
  assert.equal(JSON.stringify(store.getState().units), before);
  assert.equal(store.getState().turn.currentUnitId, 'hero');
  store.getState().resetCurrentTurn(); assert.equal(store.getState().turn.currentUnitId, 'hero');
  assert.equal(store.getState().undoStack.length, 0); assert.equal(store.getState().aiAutoPlay, false);
});
test('Range rejection leaves HP, slots and action economy unchanged', () => {
  setup([mk('hero', { aiAbilities: [sword] }), mk('enemy', { attitude: 2, isPlayer: false, init: 0, pos: { x: 10, y: 0 } })]);
  const before = JSON.stringify(store.getState().units);
  assert.equal(store.getState().castAbility('hero', 'sword', 'enemy'), false);
  assert.equal(JSON.stringify(store.getState().units), before);
});
test('Healing revives a downed ally and consumes the expected resource', () => {
  const heal = { id: 'heal', name: '治疗', kind: 'heal', dice: '6', range: 30, spellLevel: 1 };
  setup([mk('hero', { aiAbilities: [heal], spellSlots: { 1: { current: 2, max: 2 } } }), mk('ally', { hp: 0, init: -1, pos: { x: 5, y: 0 }, deathSaves: { successes: 0, failures: 1, stable: false, dead: false } }), mk('enemy', { attitude: 2, isPlayer: false, init: 0 })]);
  store.getState().castAbility('hero', 'heal', 'ally');
  assert.equal(store.getState().units.find(u => u.id === 'ally').hp, 6);
  assert.equal(store.getState().units[0].spellSlots[1].current, 1);
});
test('Read-only mirror cannot advance a turn or apply an ability', () => {
  setup([mk('hero', { aiAbilities: [sword] }), mk('enemy', { attitude: 2, isPlayer: false, init: 0, pos: { x: 5, y: 0 } })]);
  store.setState({ readOnly: true }); const before = JSON.stringify(store.getState().units); const turn = store.getState().turn.currentUnitId;
  store.getState().castAbility('hero', 'sword', 'enemy'); store.getState().nextTurn();
  assert.equal(JSON.stringify(store.getState().units), before); assert.equal(store.getState().turn.currentUnitId, turn); store.setState({ readOnly: false });
});
const { abilityCandidates, abilityPreview, abilityTargetCheck, movementPreview } = require('../src/lib/engine/actionPreview.ts');
test('Healing candidates include caster and downed ally, exclude dead and enemies', () => {
  const actor=mk('hero'); const heal={id:'h',name:'h',kind:'heal',dice:'6',range:30};
  assert.deepEqual(abilityCandidates(actor,heal,[actor,mk('down',{hp:0}),mk('dead',{hp:0,deathSaves:{dead:true}}),mk('enemy',{attitude:2})]).map(u=>u.id),['hero','down']);
});
test('Target and resource previews are pure, cover and exact range agree with execution', () => {
  const actor=mk('hero',{aiAbilities:[sword]});const target=mk('enemy',{attitude:2,pos:{x:5,y:0}});
  assert.equal(abilityTargetCheck(actor,sword,target,[],'equal'),null);
  assert.match(abilityTargetCheck(actor,sword,{...target,pos:{x:10,y:0}},[],'equal'),/射程/);
  assert.match(abilityTargetCheck(actor,{...sword,range:60},{...target,pos:{x:15,y:0}},[{id:'wall',kind:'full',cells:[{cx:1,cy:0}]}],'equal'),/完全掩护/);
  setup([actor,target]);const before=JSON.stringify(store.getState().units);
  const p=abilityPreview(actor,sword,target,[actor,target],[],'equal');assert.equal(p.dist,5);assert.equal(p.mode.mode,'normal');
  assert.equal(JSON.stringify(store.getState().units),before);
});
test('AoE origin and angle preview affect precisely the units settled by engine', () => {
  const aoe={id:'a',name:'锥形',kind:'save-aoe',dice:'6',range:30,aoe:{kind:'cone',size:15}};
  const actor=mk('hero',{aiAbilities:[aoe],pos:{x:10,y:10}});
  const units=[actor,mk('right',{isPlayer:false,playerControlled:false,attitude:2,pos:{x:20,y:10}}),mk('left',{isPlayer:false,playerControlled:false,attitude:2,pos:{x:0,y:10}}),mk('down',{hp:0,pos:{x:20,y:10}})];
  const opts={originPos:{x:10,y:10},angle:0};setup(units);
  const p=abilityPreview(actor,aoe,undefined,store.getState().units,[],'equal',opts);assert.ok(p.affected.some(u=>u.id==='right'));assert.ok(!p.affected.some(u=>u.id==='left'));assert.ok(p.affected.some(u=>u.id==='down'));
  assert.equal(store.getState().castAbility('hero','a',null,opts),true);
  for(const u of units){const after=store.getState().units.find(x=>x.id===u.id);assert.equal(after.hp,Math.max(0,u.hp-(p.affected.some(x=>x.id===u.id)?6:0))); if (u.id==='down') assert.equal(after.deathSaves.failures,1);}
});
test('Movement risk is pure and honors disengage, reaction budget and revalidation', () => {
  const hero=mk('hero',{pos:{x:10,y:10}});const enemy=mk('enemy',{attitude:2,isPlayer:false,pos:{x:10,y:15},aiAbilities:[{...sword,multiAttack:1}]});
  const cfg={width:12,height:12,cellSize:5,diagonal:'equal'};const cell={cx:1,cy:2};const units=[hero,enemy];
  const before=JSON.stringify(units);let p=movementPreview(hero,cell,units,[],cfg,true,'hero');assert.equal(p.reason,null);assert.equal(p.cost,5);assert.equal(p.threats.length,0); // still within 5ft diagonally
  p=movementPreview(hero,{cx:0,cy:2},units,[],cfg,true,'hero');assert.equal(p.threats.length,1);assert.equal(JSON.stringify(units),before);
  assert.equal(movementPreview({...hero,statuses:['disengaging']},{cx:0,cy:2},units,[],cfg,true,'hero').threats.length,0);
  assert.equal(movementPreview(hero,{cx:0,cy:2},[hero,{...enemy,actionEconomy:{...enemy.actionEconomy,reaction:true}}],[],cfg,true,'hero').threats.length,0);
  setup(units);store.setState({mapConfig:cfg});store.getState().updateUnit('hero',{actionEconomy:{...hero.actionEconomy,movementUsed:30}});
  assert.equal(store.getState().requestPlayerMove('hero',{cx:0,cy:2}),false);
});
test('Reset cancels queued reactions and multiattack; snapshots survive save/load', () => {
  setup([mk('hero',{aiAbilities:[sword]}),mk('enemy',{attitude:2,isPlayer:false,pos:{x:5,y:0},hp:100})]);
  store.getState().castAbility('hero','sword','enemy');store.getState().save();
  // load() 的 migrateUnits 会为旧档单位补 effects:[]（持续状态来源特性），
  // 期望侧做同样归一化后再严格比较
  const expected=JSON.stringify(store.getState().turnSnap.units.map(u=>({...u,effects:u.effects??[]})));
  store.setState({turnSnap:null,undoStack:[]});assert.equal(store.getState().load(),true);assert.ok(store.getState().turnSnap);
  store.setState({pendingReactionStep:{attackerId:'enemy',targetId:'hero',spellName:'盾',spellLevel:1},multiAttackQueue:{actorId:'hero',abilityId:'sword',remaining:1}});
  store.getState().resetCurrentTurn();assert.equal(store.getState().pendingReactionStep,null);assert.equal(store.getState().multiAttackQueue,null);assert.equal(JSON.stringify(store.getState().units),expected);
});
test('Explicit history rollback restores the preceding actor start independently', () => {
  setup([mk('hero',{aiAbilities:[sword]}),mk('enemy',{attitude:2,isPlayer:false,pos:{x:5,y:0},hp:100})]);
  store.getState().castAbility('hero','sword','enemy');store.getState().nextTurn();assert.equal(store.getState().undoStack.length,1);
  store.getState().undoTurn();assert.equal(store.getState().turn.currentUnitId,'hero');assert.equal(store.getState().units.find(u=>u.id==='enemy').hp,100);
  assert.equal(store.getState().undoStack.length,0);
});
test('Reinforcements preserve existing runtime values and the current actor', () => {
  setup([mk('hero',{aiAbilities:[sword]}),mk('enemy',{attitude:2,isPlayer:false,pos:{x:5,y:0},hp:100})]);
  store.getState().castAbility('hero','sword','enemy');const hp=store.getState().units.find(u=>u.id==='enemy').hp;
  store.getState().importBattleBlock('<battle>\nhero|hp 30/30|pos 0,0|att 0\n援军|hp 12/12|pos 25,25|att 2\n</battle>');
  assert.equal(store.getState().turn.currentUnitId,'hero');assert.equal(store.getState().units.find(u=>u.id==='enemy').hp,hp);
  assert.equal(store.getState().units.find(u=>u.id==='hero').actionEconomy.action,true);assert.ok(store.getState().units.some(u=>u.name==='援军'));
});
const { hudCandidates, hudTargetReason } = require('../src/lib/engine/hudTargets.ts');
const { useActionUiStore: ui } = require('../src/store/actionUiStore.ts');
test('Canvas HUD drink/feed targets include downed allies and enforce touch range', () => {
  const hero=mk('hero');const down=mk('down',{hp:0,pos:{x:5,y:0}});const enemy=mk('enemy',{attitude:2});
  const request={playerAction:'potion',ability:{id:'potion',name:'药水',kind:'heal',dice:'0',range:5}};const units=[hero,down,enemy];
  assert.deepEqual(hudCandidates(request,hero,units).map(u=>u.id),['hero','down']);
  assert.equal(hudTargetReason(request,hero,down,units,[],'equal'),null);
  assert.match(hudTargetReason(request,hero,{...down,pos:{x:10,y:0}},units,[],'equal'),/5 尺/);
  assert.match(hudTargetReason(request,hero,enemy,units,[],'equal'),/合法目标/);
});
test('Canvas HUD grapple checks size and help excludes the actor', () => {
  const hero=mk('hero');const huge=mk('huge',{attitude:2,size:'huge',pos:{x:5,y:0}});const ally=mk('ally');const units=[hero,huge,ally];
  const ability={id:'g',name:'擒抱',kind:'melee',dice:'0',range:5};
  assert.match(hudTargetReason({playerAction:'grapple',ability},hero,huge,units,[],'equal'),/体型/);
  assert.deepEqual(hudCandidates({playerAction:'help',ability},hero,units).map(u=>u.id),['ally']);
});
test('Movement and targeting modes are exclusive; inspecting enemies keeps the actor', () => {
  setup([mk('hero',{aiAbilities:[sword]}),mk('enemy',{attitude:2,isPlayer:false,pos:{x:5,y:0}})]);
  ui.getState().move('hero');assert.equal(ui.getState().request,null);
  ui.getState().begin({actorId:'hero',ability:sword});assert.equal(ui.getState().movingActorId,null);
  store.getState().setSelectedId('enemy');assert.equal(ui.getState().request.actorId,'hero');
  store.getState().nextTurn();assert.equal(ui.getState().request,null);assert.equal(ui.getState().movingActorId,null);
});
test('HUD potion remains usable after attacking when bonus action is available', () => {
  setup([mk('hero',{aiAbilities:[sword]}),mk('down',{hp:0,pos:{x:0,y:5}}),mk('enemy',{attitude:2,isPlayer:false,hp:100,pos:{x:5,y:0}})]);
  store.getState().castAbility('hero','sword','enemy');const hero=store.getState().units.find(u=>u.id==='hero');
  const before=JSON.stringify(store.getState().units);ui.getState().begin({actorId:'hero',playerAction:'potion',ability:{id:'p',name:'药水',kind:'heal',dice:'0',range:5}});
  assert.equal(JSON.stringify(store.getState().units),before);
  store.getState().playerAction('potion','hero','down');assert.equal(store.getState().units.find(u=>u.id==='hero').actionEconomy.bonus,true);assert.ok(store.getState().units.find(u=>u.id==='down').hp>0);
  assert.equal(hero.actionEconomy.action,true);
});
console.log({ passed, failed }); process.exitCode = failed ? 1 : 0;
