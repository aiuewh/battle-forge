const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const path = require('path');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const { ReportDelivery } = require('../src/lib/engine/reportDelivery.ts');
const scope = { setTimeout, Map, WeakMap, Promise };
vm.createContext(scope); vm.runInContext(fs.readFileSync(path.join(__dirname, '../st-integration/report-host.js'), 'utf8'), scope);
async function main() {
  const posts = []; const d = new ReportDelivery(m => posts.push(m), 10);
  d.bind('chat1'); d.send('report'); d.send('report'); assert.equal(posts.length, 1);
  d.acknowledge({ requestId: 'wrong', contextId: 'chat1', status: 'sent' }); assert.equal(d.snapshot().status, 'sending');
  d.acknowledge({ requestId: posts[0].requestId, contextId: 'wrong', status: 'sent' }); assert.equal(d.snapshot().status, 'sending');
  await new Promise(r => setTimeout(r, 20)); assert.equal(d.snapshot().status, 'unknown');
  d.send('report'); assert.equal(posts[1].type, 'bp:report:query');
  d.acknowledge({ requestId: posts[0].requestId, contextId: 'chat1', status: 'sent' }); assert.equal(d.snapshot().status, 'sent');
  d.send('report'); assert.equal(posts.length, 2);
  console.log('PASS transport: duplicate send, spoofed receipts, timeout query, confirmed receipt');
  let context = { chat: [], characterId: 1, chatId: 'chat1' }; let commands = []; let replies = [];
  const source = {};
  const host = scope.createBattleReportHost({ getContext: () => context, connected: () => true, reply: (s,m) => replies.push(m),
    executeSlash: async cmd => { commands.push(cmd); if (cmd.startsWith('/send')) context.chat.push({ is_user: true, mes: 'report' }); } });
  host.bind(source); const contextId = replies.at(-1).contextId;
  const request = { requestId: 'r1', contextId, text: 'report' };
  await Promise.all([host.receive(source, request), host.receive(source, request)]);
  assert.equal(commands.filter(c => c.startsWith('/send')).length, 1); assert.equal(commands.filter(c => c === '/trigger').length, 1);
  assert.equal(replies.at(-1).status, 'sent');
  await host.receive(source, request, true); assert.equal(commands.length, 2);
  context = { chat: [], characterId: 2, chatId: 'chat2' };
  await host.receive(source, { ...request, requestId: 'r2' }); assert.equal(replies.at(-1).status, 'failed'); assert.equal(commands.length, 2);
  console.log('PASS host: async duplicate handling, observable message insertion, query, chat switch');
  context = { chat: [], characterId: 1, chatId: 'chat1' }; replies = [];
  const badSource = {};
  const badHost = scope.createBattleReportHost({ getContext: () => context, connected: () => true, reply: (s,m) => replies.push(m),
    executeSlash: async cmd => { if (cmd.startsWith('/send')) context.chat.push({ is_user: true, mes: 'report' }); else throw Error('trigger failed'); } });
  badHost.bind(badSource);
  await badHost.receive(badSource, { requestId: 'bad-trigger', contextId: replies.at(-1).contextId, text: 'report' });
  assert.equal(replies.at(-1).status, 'sent-trigger-failed'); assert.equal(context.chat.length, 1);
  console.log('PASS host: trigger failure keeps successful send receipt');
  // Both live card paths must parse as executable JavaScript.
  const card = JSON.parse(fs.readFileSync(path.join(__dirname,'../../../【D&D 2024版】.json'),'utf8'));
  const bootstrap = card.data.extensions.regex_scripts.find(r=>r.scriptName==='battle-forge-panel').replaceString;
  for (const m of bootstrap.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
  const heal = card.data.extensions.tavern_helper.scripts.find(s=>s.name==='自愈（启动守卫+战斗面板）').content;
  new vm.Script(heal);
  console.log('PASS active card bootstrap and self-heal script syntax');
  const ast=ts.createSourceFile('heal.js',heal,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const functions=[];
  function walk(n){if(ts.isFunctionDeclaration(n)&&['miniTemplate','buildSrcdoc'].includes(n.name?.text))functions.push(n.getText(ast));ts.forEachChild(n,walk);}
  walk(ast);
  const miniScope={};vm.createContext(miniScope);
  const mini=vm.runInContext('var BS=String.fromCharCode(92);function buildHostRoster(){return null;}\n'+functions.join('\n')+'\nbuildSrcdoc(miniTemplate(),"<battle>\\nhero|hp 30/30\\n</battle>")',miniScope);
  let scripts=0;for(const m of mini.matchAll(/<script>([\s\S]*?)<\/script>/g)){new vm.Script(m[1]);scripts++;}assert.ok(scripts>=2);
  console.log('PASS generated mini fallback and srcdoc relay syntax');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
