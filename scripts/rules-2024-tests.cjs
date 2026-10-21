const fs = require('fs'), path = require('path'), Module = require('module'), ts = require('typescript'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) { return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args); };
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop:true } }).outputText,f);
const memory = new Map(); let writes = 0;
global.localStorage = { getItem:k=>memory.get(k)??null, setItem:(k,v)=>{memory.set(k,v);writes++;}, removeItem:k=>memory.delete(k) };
const { useBattleStore: store, clearAiPlanCache } = require('../src/store/battleStore.ts');
const { setRng, judgeCheck, rollFormula } = require('../src/lib/engine/dice.ts');
const { resolveSave, resolveAttack, applyTypeModifiers, resolveConcentration } = require('../src/lib/engine/combat.ts');
const { concentrationDc } = require('../src/lib/engine/rules.ts');
const { abilityPreview, movementPreview } = require('../src/lib/engine/actionPreview.ts');
const { addAbilityEffect, endConcentrationEffects, migrateUnits, removeEffects } = require('../src/lib/engine/effects.ts');
const { findPath, reachableCells } = require('../src/lib/engine/geometry.ts');
const { validateStep } = require('../src/lib/engine/ai.ts');
const { parseAttack } = require('../src/lib/engine/statblocks.ts');
const { EmbedPanel } = require('../src/lib/engine/embedSync.ts');
const mk = (id, over={}) => ({ id,name:id,init:20,initMod:0,hp:30,maxHp:30,tempHp:0,ac:10,speed:30,pos:{x:0,y:0},attitude:0,statuses:[],isPlayer:id==='hero',playerControlled:id==='hero',size:'medium',resistances:[],immunities:[],vulnerabilities:[],hasActed:false,abilities:{str:16,dex:14,con:12,int:12,wis:12,cha:10},actionEconomy:{action:false,bonus:false,reaction:false,movementUsed:0},...over });
const sword={id:'sword',name:'长剑',kind:'melee',dice:'6',attackBonus:20,range:5};
const save={id:'save',name:'法术',kind:'save',dice:'20',damageType:'fire',saveAbility:'dex',saveDc:30,range:60};
const setup=units=>{clearAiPlanCache();store.getState().reset();store.setState({units,readOnly:false,aiAutoPlay:false,mapConfig:{width:16,height:16,cellSize:5,diagonal:'equal'}});store.getState().startCombat();store.setState({turn:{...store.getState().turn,currentUnitId:'hero',turnIndex:store.getState().turn.order.indexOf('hero')}});setRng(()=>0.5);};
let passed=0,failed=0;
function test(name, fn) { try { fn(); passed++; console.log('PASS',name); } catch(e) {failed++;console.error('FAIL',name,e.stack);} }
test('普通检定与普通豁免按总值，攻击天然20和1保持特例',()=>{
  assert.equal(judgeCheck(rollFormula('1d20',{forcedRolls:[20]}),30).outcome,'failure');
  assert.equal(resolveSave(mk('u'),{ability:'dex',dc:30,forcedRoll:20}).check.outcome,'failure');
  assert.equal(resolveSave(mk('u',{saveBonuses:{dex:20}}),{ability:'dex',dc:10,forcedRoll:1}).check.outcome,'success');
  assert.equal(resolveAttack(mk('a'),mk('b'),{attackBonus:0,targetAc:99,weaponDamage:'1',forcedAttackRoll:20}).hit,true);
  assert.equal(resolveAttack(mk('a'),mk('b'),{attackBonus:99,targetAc:1,weaponDamage:'1',forcedAttackRoll:1}).hit,false);
});
test('成功免伤、半伤与显式全伤分别处理',()=>{
  const opts={ability:'dex',dc:10,forcedRoll:15,sourceDamage:21};
  assert.equal(resolveSave(mk('u'),opts).damageTaken,0);
  assert.equal(resolveSave(mk('u'),{...opts,halfOnSuccess:true}).damageTaken,10);
  assert.equal(resolveSave(mk('u'),{...opts,damageOnSuccess:'full'}).damageTaken,21);
});
test('石化与已有抗性不重复，奇数抗性先于易伤',()=>{
  assert.equal(applyTypeModifiers(mk('u',{statuses:['petrified'],resistances:['fire']}),20,'fire').final,10);
  assert.equal(applyTypeModifiers(mk('u',{statuses:['petrified'],vulnerabilities:['fire']}),5,'fire').final,4);
  assert.equal(applyTypeModifiers(mk('u',{statuses:['petrified'],immunities:['fire']}),20,'fire').final,0);
});
test('专注DC30封顶，天然20不能自动成功',()=>{
  assert.equal(concentrationDc(100),30);
  assert.equal(resolveConcentration(mk('u',{abilities:{con:10}}),100,20).broken,true);
});
test('临时HP吸收也检定专注，单次伤害只检定一次',()=>{
  setup([mk('hero',{concentration:'专注',tempHp:10,saveBonuses:{con:-5}}),mk('e',{attitude:2,pos:{x:5,y:0}})]);
  store.getState().damageUnit('hero',10,{type:'fire'});
  assert.equal(store.getState().units[0].hp,30); assert.equal(store.getState().units[0].tempHp,0);assert.equal(store.getState().units[0].concentration,undefined);
  assert.equal(store.getState().events.filter(e=>e.type==='concentration').length,1);
});
test('失能、六级力竭和降至零立即结束专注',()=>{
  setup([mk('hero',{concentration:'专注'}),mk('e',{attitude:2})]);store.getState().toggleStatus('hero','incapacitated');assert.equal(store.getState().units[0].concentration,undefined);
  setup([mk('hero',{concentration:'专注'}),mk('e',{attitude:2})]);store.getState().toggleStatus('hero','exhaustion:6');assert.equal(store.getState().units[0].deathSaves.dead,true);assert.equal(store.getState().units[0].concentration,undefined);
  setup([mk('hero',{concentration:'专注'}),mk('e',{attitude:2})]);store.getState().damageUnit('hero',30);assert.equal(store.getState().units[0].concentration,undefined);assert.ok(store.getState().units[0].statuses.includes('unconscious'));
});
test('2024击昏为1HP，不排除传奇目标，治疗可唤醒',()=>{
  setup([mk('hero',{aiAbilities:[{...sword,dice:'100'}]}),mk('e',{attitude:2,hp:5,legendary:{points:3,max:3},pos:{x:5,y:0}})]);
  assert.equal(store.getState().castAbility('hero','sword','e',{nonLethal:true}),true);
  const e=store.getState().units[1]; assert.equal(e.hp,1);assert.equal(e.deathSaves.dead,false);assert.equal(e.knockedOut,true);
  store.getState().healUnit('e',1);assert.equal(store.getState().units[1].knockedOut,false);assert.ok(!store.getState().units[1].statuses.includes('unconscious'));
});
test('天然20死亡豁免苏醒，稳定者受伤重新进入死亡流程',()=>{
  setup([mk('hero',{hp:0,statuses:['unconscious','prone']}),mk('e',{attitude:2})]);store.getState().rollDeathSave('hero',20);assert.equal(store.getState().units[0].hp,1);assert.ok(!store.getState().units[0].statuses.includes('unconscious'));
  store.getState().updateUnit('hero',{hp:0,deathSaves:{successes:0,failures:0,stable:true,dead:false}});store.getState().damageUnit('hero',1);assert.equal(store.getState().units[0].deathSaves.stable,false);assert.equal(store.getState().units[0].deathSaves.failures,1);
});
test('绕墙费用按真实路径，预览与执行一致',()=>{
  const hero=mk('hero',{pos:{x:10,y:10}}), enemy=mk('e',{attitude:2,pos:{x:70,y:70}});
  setup([hero,enemy]);store.setState({obstacles:[{id:'wall',kind:'full',cells:[{cx:3,cy:1},{cx:3,cy:2},{cx:3,cy:3}]}]});
  const s=store.getState(), p=movementPreview(hero,{cx:4,cy:2},s.units,s.obstacles,s.mapConfig,true,'hero');assert.equal(p.reason,null);assert.ok(p.cost>10);
  store.getState().requestPlayerMove('hero',{cx:4,cy:2});assert.equal(store.getState().units[0].actionEconomy.movementUsed,p.cost);
});
test('困难地形扣双倍，分段对角不能重置5/10交替',()=>{
  setup([mk('hero'),mk('e',{attitude:2,pos:{x:70,y:70}})]);store.setState({obstacles:[{id:'rough',kind:'difficult',cells:[{cx:1,cy:0}]}]});store.getState().requestPlayerMove('hero',{cx:1,cy:0});assert.equal(store.getState().units[0].actionEconomy.movementUsed,10);
  setup([mk('hero'),mk('e',{attitude:2,pos:{x:70,y:70}})]);store.setState({mapConfig:{...store.getState().mapConfig,diagonal:'alt'}});
  store.getState().requestPlayerMove('hero',{cx:1,cy:1});store.getState().requestPlayerMove('hero',{cx:2,cy:2});assert.equal(store.getState().units[0].actionEconomy.movementUsed,15);
});
test('借机攻击在离开前结算，击倒停止在触及内',()=>{
  setup([mk('hero',{hp:5,pos:{x:5,y:5}}),mk('e',{attitude:2,pos:{x:5,y:10},aiAbilities:[{...sword,dice:'10'}]})]);
  store.getState().requestPlayerMove('hero',{cx:4,cy:1});const hero=store.getState().units[0];assert.equal(hero.hp,0);assert.ok(hero.pos.x<=10);assert.equal(store.getState().units[1].actionEconomy.reaction,true);
});
test('脱离免借机，强制移动不扣移动力或触发借机',()=>{
  setup([mk('hero',{pos:{x:5,y:5}}),mk('e',{attitude:2,pos:{x:5,y:10},aiAbilities:[sword]})]);store.getState().moveUnit('hero',{x:20,y:5},true,'forced');assert.equal(store.getState().units[0].actionEconomy.movementUsed,0);assert.equal(store.getState().units[1].actionEconomy.reaction,false);
});
test('范围包含自己和倒地者，完全掩护阻挡范围',()=>{
  const ability={id:'a',name:'爆炸',kind:'save-aoe',dice:'6',range:60,aoe:{kind:'sphere',size:20}};
  setup([mk('hero',{aiAbilities:[ability],pos:{x:5,y:5}}),mk('down',{hp:0,pos:{x:10,y:5}}),mk('e',{attitude:2,pos:{x:15,y:5}})]);
  const s=store.getState(), p=abilityPreview(s.units[0],ability,undefined,s.units,[],'equal',{originPos:{x:5,y:5}});assert.ok(p.affected.some(u=>u.id==='hero'));assert.ok(p.affected.some(u=>u.id==='down'));
  assert.equal(store.getState().castAbility('hero','a',null,{originPos:{x:5,y:5}}),true);assert.equal(store.getState().units[0].hp,24);assert.equal(store.getState().units[1].deathSaves.failures,1);
});
test('隔墙单体、治疗和落点拒绝；拒绝不扣法术位或动作',()=>{
  for (const kind of ['save','heal','save-aoe']) {
    const ability={...save,kind,spellLevel:1,aoe:kind==='save-aoe'?{kind:'sphere',size:10}:undefined};
    setup([mk('hero',{aiAbilities:[ability],spellSlots:{1:{current:2,max:2}}}),mk('e',{attitude:2,pos:{x:10,y:0}})]);store.setState({obstacles:[{id:'wall',kind:'full',cells:[{cx:1,cy:0}]}]});
    assert.equal(store.getState().castAbility('hero','save','e'),false);assert.equal(store.getState().units[0].spellSlots[1].current,2);assert.equal(store.getState().units[0].actionEconomy.action,false);
  }
});
test('每回合仅一次消耗法术位施法，下一生物回合刷新',()=>{
  const bonus={...save,id:'bonus',bonusAction:true}, leveled={...save,spellLevel:1};bonus.spellLevel=1;
  setup([mk('hero',{aiAbilities:[leveled,bonus],spellSlots:{1:{current:3,max:3}}}),mk('e',{attitude:2,pos:{x:5,y:0}})]);
  assert.equal(store.getState().castAbility('hero','save','e'),true);assert.equal(store.getState().castAbility('hero','bonus','e'),false);assert.equal(store.getState().units[0].spellSlots[1].current,2);
  store.getState().nextTurn();assert.equal(store.getState().units[0].slotCastThisTurn,false);
});
test('AI严格射程，执行共用玩家豁免伤害规则',()=>{
  const ability={...save,saveDc:1};const hero=mk('hero'),enemy=mk('e',{attitude:2,pos:{x:10,y:0},aiAbilities:[ability]});
  const ctx={units:[hero,enemy],obstacles:[],diagonal:'equal',mapWidth:16,mapHeight:16,playerTargetId:null};assert.equal(validateStep(ctx,enemy,{type:'attack',abilityId:'save',targetId:'hero'}),true);
  assert.equal(validateStep({...ctx,units:[hero,{...enemy,pos:{x:65,y:0}}]}, {...enemy,pos:{x:65,y:0}}, {type:'save-single',abilityId:'save',targetId:'hero'}),false);
  setup([hero,enemy]);store.setState({turn:{...store.getState().turn,currentUnitId:'e'}});store.getState().castAbility('e','save','hero');assert.equal(store.getState().units[0].hp,30);
});
test('多来源状态只解除所属来源，旧手动状态保留',()=>{
  const ab={...save,applyStatus:'paralyzed',concentration:true};const a=mk('a'),b=mk('b');let target=addAbilityEffect(mk('t'),a,ab,'1');target=addAbilityEffect(target,b,ab,'2');
  target=endConcentrationEffects([target],'a')[0];assert.ok(target.statuses.includes('paralyzed'));target=endConcentrationEffects([target],'b')[0];assert.ok(!target.statuses.includes('paralyzed'));
  target=addAbilityEffect(mk('t',{statuses:['paralyzed']}),a,ab,'3');assert.ok(removeEffects(target,()=>true).statuses.includes('paralyzed'));
});
test('专注切换与重复豁免解除正确目标，持续时间可到期',()=>{
  const ab={...save,dice:'0',saveDc:30,applyStatus:'paralyzed',concentration:true,repeatSave:{ability:'wis',dc:1,timing:'end'}};
  setup([mk('hero',{aiAbilities:[ab]}),mk('e',{attitude:2,pos:{x:5,y:0}})]);store.getState().castAbility('hero','save','e');assert.ok(store.getState().units[1].statuses.includes('paralyzed'));store.getState().processEffects('e','end');assert.ok(!store.getState().units[1].statuses.includes('paralyzed'));
  store.getState().applyAbilityEffect('e','hero',{...ab,repeatSave:undefined,durationRounds:1});store.getState().processEffects('e','end');assert.ok(!store.getState().units[1].statuses.includes('paralyzed'));
  store.getState().applyAbilityEffect('e','hero',ab);store.getState().setConcentration('hero','新法术');assert.ok(!store.getState().units[1].statuses.includes('paralyzed'));
});
test('旧存档迁移幂等，已结束导出不会恢复成战斗中',()=>{
  const units=[mk('hero',{statuses:['exhaustion:7','poisoned'],concentration:'旧专注'})];const migrated=migrateUnits(units);assert.equal(migrated[0].deathSaves.dead,true);assert.equal(migrated[0].concentration,undefined);assert.ok(migrated[0].statuses.includes('poisoned'));assert.deepEqual(migrateUnits(migrated),migrated);
  setup([mk('hero'),mk('e',{attitude:2})]);store.getState().endCombat();const report=store.getState().exportWarReport();store.getState().importWarReport(report);assert.equal(store.getState().battleActive,false);
});
test('路径与可达范围共用费用且不越地图边界',()=>{
  const unit=mk('hero'),opts={mapWidth:3,mapHeight:3};const route=findPath({cx:0,cy:0},{cx:2,cy:2},[unit],[],unit,'alt',opts);assert.equal(route.costCells,3);assert.equal(reachableCells(unit,[unit],[],15,'alt',opts).get('2,2'),3);assert.ok(!reachableCells(unit,[unit],[],30,'equal',opts).has('-1,0'));
});
test('效果字段经敌卡解析保持来源所需的语义',()=>{
  const parsed=parseAttack({名称:'束缚',类型:'单体豁免',伤害:'0',豁免:{属性:'感知',DC:17},附加状态:'麻痹',专注:true,持续轮数:10,重复豁免:{属性:'感知',DC:17,时机:'回合结束'},排除自身:true,需要看见:true},0,[]);
  assert.equal(parsed.durationRounds,10);assert.deepEqual(parsed.repeatSave,{ability:'wis',dc:17,timing:'end'});assert.equal(parsed.requiresSight,true);assert.equal(parsed.excludeSelf,true);
});
test('预备法术立即付费，非法目标不消费反应，释放不重复扣位',()=>{
  const ab={...save,spellLevel:1,range:5};setup([mk('hero',{aiAbilities:[ab],spellSlots:{1:{current:2,max:2}}}),mk('e',{attitude:2,pos:{x:10,y:0}})]);
  store.getState().setReadyAction('hero','save','法术','出现');assert.equal(store.getState().units[0].spellSlots[1].current,1);assert.equal(store.getState().units[0].concentration,'预备：法术');
  store.getState().triggerReadyAction('hero','e');assert.equal(store.getState().units[0].actionEconomy.reaction,false);assert.ok(store.getState().units[0].readyAction);
  store.getState().updateUnit('e',{pos:{x:5,y:0}});store.getState().triggerReadyAction('hero','e');assert.equal(store.getState().units[0].spellSlots[1].current,1);assert.equal(store.getState().units[0].actionEconomy.reaction,true);assert.equal(store.getState().units[0].readyAction,undefined);
});
test('急救使用当前行动者属性且唤醒击昏目标',()=>{
  setup([mk('hero',{abilities:{wis:20}}),mk('e',{attitude:2,hp:1,knockedOut:true,statuses:['unconscious','prone'],pos:{x:5,y:0}})]);store.getState().stabilizeUnit('e');assert.equal(store.getState().units[1].knockedOut,false);assert.equal(store.getState().units[0].actionEconomy.action,true);
});
test('忽略护盾反应后AI可继续，不重复弹出同一窗口',()=>{
  setup([mk('hero',{aiAbilities:[{id:'shield',name:'护盾术',kind:'save',dice:'0',range:0,reaction:true,spellLevel:1}],spellSlots:{1:{current:2,max:2}}}),mk('e',{attitude:2,pos:{x:5,y:0},aiAbilities:[sword]})]);store.setState({turn:{...store.getState().turn,currentUnitId:'e'}});
  store.getState().takeAiStep();assert.ok(store.getState().pendingReactionStep);const epoch=store.getState().interactionEpoch;store.getState().resolvePendingReaction(false);assert.equal(store.getState().pendingReactionStep,null);assert.ok(store.getState().units[0].hp<30);
  assert.ok(store.getState().interactionEpoch>epoch,'解析反应后必须递增 interactionEpoch 重启 AiDriver，否则剩余 AI 步骤（续打/结束回合）无人驱动');
});
test('非领导者水合恢复全部持久化字段，force-persist 不清空领导者状态',()=>{
  setup([mk('hero',{aiAbilities:[sword]}),mk('e',{attitude:2,pos:{x:5,y:0}})]);
  store.getState().castAbility('hero','sword','e');store.getState().nextTurn(); // 攻击+推进 → turnSnap/undoStack 均非空
  store.getState().save(); // 落盘含 aoeTemplates/escapedUnits/turnSnap/undoStack/aiAutoPlay/aiSpeed
  const saved=JSON.parse(memory.get('dnd-battle-state-v1'));
  saved.aoeTemplates=[{id:'tpl1',kind:'line',origin:{x:0,y:0},angle:0,size:30,color:'#fff',label:'火墙'}];
  saved.escapedUnits=[saved.units[1]];saved.aiAutoPlay=false;saved.aiSpeed=900;
  memory.set('dnd-battle-state-v1',JSON.stringify(saved));
  store.setState({aoeTemplates:[],escapedUnits:[],turnSnap:null,undoStack:[],aiAutoPlay:true,aiSpeed:450});
  assert.equal(store.getState().hydrateFromPersisted(),true);
  assert.equal(store.getState().aoeTemplates.length,1,'aoeTemplates 未被水合恢复');
  assert.equal(store.getState().escapedUnits.length,1,'escapedUnits 未被水合恢复');
  assert.ok(store.getState().turnSnap,'turnSnap 未被水合恢复');
  assert.ok(store.getState().undoStack.length>0,'undoStack 未被水合恢复');
  assert.equal(store.getState().aiAutoPlay,false,'aiAutoPlay 未被水合恢复');
  assert.equal(store.getState().aiSpeed,900,'aiSpeed 未被水合恢复');
});
test('充能用d6且只在对应行动者开始时恢复',()=>{
  setup([mk('hero',{abilityUses:{a:{used:1,recharge:5}}}),mk('e',{attitude:2,abilityUses:{a:{used:1,recharge:5}}})]);setRng(()=>.5);store.getState().restoreRecharges();assert.equal(store.getState().units[0].abilityUses.a.used,1);setRng(()=>.99);store.getState().restoreRecharges();assert.equal(store.getState().units[0].abilityUses.a.used,0);assert.equal(store.getState().units[1].abilityUses.a.used,1);
});
test('一个完整施法只落盘一次，存档包含最终扣位与伤害',()=>{
  setup([mk('hero',{aiAbilities:[{...save,spellLevel:1}],spellSlots:{1:{current:2,max:2}}}),mk('e',{attitude:2,pos:{x:5,y:0}})]);const before=writes;store.getState().castAbility('hero','save','e');assert.equal(writes-before,1);const saved=JSON.parse(memory.get('dnd-battle-state-v1'));assert.equal(saved.units[0].spellSlots[1].current,1);assert.equal(saved.units[1].hp,10);assert.equal(saved.saveVersion,2);
});
test('同深度面板领导权不会随心跳切换，旧楼层不能夺权',()=>{
  const now=Date.now;let clock=10000;Date.now=()=>clock;const a=new EmbedPanel(0);clock++;const b=new EmbedPanel(0);
  try { a.setDepth(0);b.setDepth(0);assert.equal(b.isLeader,true);for(let i=0;i<3;i++){clock+=100;a.setDepth(0);b.setDepth(0);assert.equal(a.isLeader,false);assert.equal(b.isLeader,true);}b.setDepth(2);a.setDepth(0);assert.equal(a.isLeader,true);assert.equal(b.isLeader,false); }
  finally {a.stop();b.stop();Date.now=now;}
});
test('非法骰子公式拒绝后不扣次数、法术位或替换专注',()=>{
  const ab={...save,dice:'bad formula',spellLevel:1,usesPerDay:1,concentration:true};
  setup([mk('hero',{concentration:'原法术',aiAbilities:[ab],spellSlots:{1:{current:2,max:2}}}),mk('e',{attitude:2,pos:{x:5,y:0}})]);
  const before=JSON.stringify(store.getState().units);
  assert.equal(store.getState().castAbility('hero','save','e'),false);
  assert.equal(JSON.stringify(store.getState().units),before);
});
console.log({passed,failed,writes});if(failed)process.exitCode=1;
