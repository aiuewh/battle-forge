from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent.parent
card=json.loads((ROOT.parent.parent/'【D&D 2024版】.json').read_text(encoding='utf-8'))
boot=next(r for r in card['data']['extensions']['regex_scripts'] if r['scriptName']=='battle-forge-panel')['replaceString']
boot='\n'.join(boot.strip().splitlines()[1:-1])
boot=boot.replace('var APP_URL_DEFAULT = "https://aiuewh.github.io/battle-forge/"','var APP_URL_DEFAULT = "http://localhost:3000/"')
host=(ROOT/'st-integration/report-host.js').read_text(encoding='utf-8')
page='''<!DOCTYPE html><html lang="zh"><meta charset="utf-8"><title>Battle Forge 首轮交互验证</title>
<style>body{margin:12px;background:#20180f;color:#f4ddae;font:14px/1.6 sans-serif}button{padding:10px;margin:4px}#stage{max-width:100%;margin:auto}iframe{border:1px solid #856848;width:100%}#results{white-space:pre-wrap}</style>
<h1>首轮交互验证（本地测试）</h1>
<div><button id="reset">重置测试战场</button><button id="multi">续打测试场景</button><button id="mobile">390px</button><button id="tablet">768px</button><button id="desktop">1200px</button><button id="mirror">添加旧楼层镜像</button><button id="fail">切换触发失败</button><button id="switch">切换模拟聊天</button></div>
<div id="results">等待加载</div><div id="stage" style="width:1200px"><div id="frames"></div></div>
<script>__HOST__
const template=__BOOT__;
const ctx={chat:[],characterId:1,chatId:'harness'};let triggerFailure=false;
const ownerFrames=new Set();let multiScene=false;
function show(){document.getElementById('results').textContent='已发送战报：'+ctx.chat.filter(m=>m.is_user).length+' 条；DM 触发：'+ctx.triggers+' 次';}
const host=createBattleReportHost({getContext:()=>ctx,connected:s=>Array.from(ownerFrames).some(f=>f.isConnected&&f.contentWindow===s),reply:(s,m)=>s.postMessage(m,'*'),
executeSlash:async c=>{if(c.startsWith('/send ')){let t=c.slice(6).trim();if(t.startsWith('"'))t=t.slice(1,-1).replace(/\\\\"/g,'"').replace(/\\\\\\\\/g,'\\\\');ctx.chat.push({is_user:true,mes:t});show();}else{if(triggerFailure)throw Error('模拟触发失败');ctx.triggers++;show();}},busy:()=>false});
window.addEventListener('message',e=>{if(!Array.from(ownerFrames).some(f=>f.contentWindow===e.source))return;let m=e.data||{};if(m.__bpReportBind)host.bind(e.source);if(m.__bpReportRequest)host.receive(e.source,m.request,m.query===true);if(m.__bpWantRoster)e.source.postMessage({__bpRoster:{'角色列表':{}}},'*');if(m.__bpHealH){let f=Array.from(ownerFrames).find(f=>f.contentWindow===e.source);f.style.height=m.__bpHealH+'px';}});
const ability=(id,name,kind,dice,range,extra={})=>({id,name,kind,dice,range,...extra});
function unit(id,name,pos,extra={}){return{id,name,init:10,initMod:0,initRolled:true,hp:30,maxHp:30,tempHp:0,ac:12,speed:30,pos,attitude:0,statuses:[],isPlayer:false,playerControlled:true,size:'medium',resistances:[],immunities:[],vulnerabilities:[],hasActed:false,abilities:{str:16,dex:14,con:12,int:16,wis:12,cha:10},actionEconomy:{action:false,bonus:false,reaction:false,movementUsed:0},...extra};}
function addFrame(depth=0){const frame=document.createElement('iframe');frame.title=depth?'旧楼层镜像':'主持战斗面板';frame.style.height='840px';let text=template.replace('$1','<battle>\\n测试勇者|hp 30/30|pos 10,10|att 0\\n濒死队友|hp 0/30|pos 15,10|att 0\\n训练地精甲|hp 8/30|pos 10,15|att 2\\n训练地精乙|hp 30/30|pos 25,10|att 2\\n</battle>');
text=text.replace('var DEPTH = detectDepth();','var DEPTH = '+depth+';');text=text.replace('</head>','<script>window.addEventListener("load",()=>{setInterval(()=>parent.postMessage({__bpHealH:document.body.scrollHeight},"*"),1000)});<\\/script></head>');frame.srcdoc=text;ownerFrames.add(frame);document.getElementById('frames').append(frame);}
function reset(){document.getElementById('frames').replaceChildren();ownerFrames.clear();localStorage.removeItem('bf-embed-panels');localStorage.setItem('bf_app_url','http://localhost:3000/');ctx.chat=[];ctx.chatId='harness-'+Date.now();ctx.triggers=0;
let units=[unit('测试勇者','测试勇者',{x:10,y:10},{isPlayer:true,init:20,spellSlots:{1:{current:3,max:3},3:{current:2,max:2}},aiAbilities:[ability('sword','训练长剑','melee',multiScene?'20':'1d8+3',5,{attackBonus:20,multiAttack:2}),ability('bow','训练长弓','ranged','1d8+2',60,{attackBonus:5}),ability('heal','治疗真言','heal','6',30,{spellLevel:1,bonusAction:true}),ability('fire','训练火球','save-aoe','2d6',60,{spellLevel:3,saveAbility:'dex',saveDc:13,halfOnSuccess:true,aoe:{kind:'sphere',size:10}}),ability('cone','训练锥形','save-aoe','1d6',30,{saveAbility:'dex',saveDc:13,aoe:{kind:'cone',size:15}})]}),unit('濒死队友','濒死队友',{x:15,y:10},{hp:0,deathSaves:{successes:0,failures:1,stable:false,dead:false}}),unit('训练地精甲','训练地精甲',{x:10,y:15},{attitude:2,hp:8,playerControlled:false,aiAbilities:[ability('claw','爪击','melee','1d4',5,{attackBonus:4})]}),unit('训练地精乙','训练地精乙',{x:25,y:10},{attitude:2,playerControlled:false,aiAbilities:[ability('claw','爪击','melee','1d4',5,{attackBonus:4})]})];
let turn={round:1,currentUnitId:'测试勇者',order:units.map(u=>u.id),turnIndex:0,ended:false,surprisedIds:[]};let snap={units,turn,escapedUnits:[],aoeTemplates:[],obstacles:[],events:[],battleActive:true};localStorage.setItem('dnd-battle-state-v1',JSON.stringify({...snap,mapConfig:{width:12,height:12,cellSize:5,diagonal:'equal'},battleName:'首轮测试战场',aiAutoPlay:false,aiSpeed:450,turnSnap:snap,undoStack:[]}));show();addFrame();}
document.getElementById('reset').onclick=()=>{multiScene=false;reset();};document.getElementById('multi').onclick=()=>{multiScene=true;reset();};for(const [id,w]of[['mobile',390],['tablet',768],['desktop',1200]])document.getElementById(id).onclick=()=>{document.getElementById('stage').style.width=w+'px';};document.getElementById('mirror').onclick=()=>addFrame(2);document.getElementById('fail').onclick=()=>{triggerFailure=!triggerFailure;document.getElementById('fail').textContent=triggerFailure?'当前：触发失败':'当前：触发正常';};document.getElementById('switch').onclick=()=>{ctx.chat=[];ctx.chatId='switched';show();};reset();
</script></html>'''
page=page.replace('__HOST__',host).replace('__BOOT__',json.dumps(boot,ensure_ascii=False).replace('</','<\\/'))
(ROOT/'public/action-flow-harness.html').write_text(page,encoding='utf-8')
print('Built double-iframe action-flow harness')
