"""Update only the active card bridge fields; preserve all other JSON tokens.
Run from any directory. Historical packs are deliberately not regenerated.
"""
from pathlib import Path
import json, re
ROOT=Path(__file__).resolve().parent.parent
WORKSPACE=ROOT.parent.parent
CARD=WORKSPACE/'【D&D 2024版】.json'
BACKUP=ROOT.parent/'_改进备份_20261013'/'【D&D 2024版】.json'
original=BACKUP.read_bytes().decode('utf-8')
card=json.loads(original)
regex=next(r for r in card['data']['extensions']['regex_scripts'] if r['scriptName']=='battle-forge-panel')
heal=next(s for s in card['data']['extensions']['tavern_helper']['scripts'] if s['name']=='自愈（启动守卫+战斗面板）')
old_boot=regex['replaceString']; old_heal=heal['content']
def once(s,a,b):
    assert s.count(a)==1, (a[:80],s.count(a))
    return s.replace(a,b,1)
boot=old_boot
boot=once(boot,'roster: buildRosterPayload(), depth: DEPTH, ts: Date.now()', 'roster: buildRosterPayload(), depth: DEPTH, contextId: reportContext, ts: Date.now()')
boot=once(boot,'    if (msg.__bpRoster && typeof msg.__bpRoster === "object") {','    if (msg.__bpRoster && (ev.source === window.parent || ev.source === window.top) && typeof msg.__bpRoster === "object") {')
boot=once(boot,'    if (msg.type === "bp:report" && typeof msg.text === "string") {\n      deliverReport(msg.text);\n    }', '''    if ((msg.type === "bp:report" || msg.type === "bp:report:query") && typeof msg.requestId === "string") {
      window.parent.postMessage({ __bpReportRequest: true, query: msg.type === "bp:report:query", request: msg }, "*");
    } else if (msg.type === "bp:report" && typeof msg.text === "string") {
      // Transitional support for the previously deployed engine, with host-side deduplication.
      if (!legacyReport || legacyReport.text !== msg.text) legacyReport = { type: "bp:report", text: msg.text, contextId: reportContext, requestId: "legacy-" + Date.now() + "-" + Math.random().toString(36).slice(2) };
      badge.textContent = "战报发送中，等待酒馆确认";
      window.parent.postMessage({ __bpReportRequest: true, request: legacyReport }, "*");
    }''')
a=boot.index('  // ---- 战报自动回注：'); b=boot.index('  function onTimeout()',a)
boot=boot[:a]+'''  // Host receipts are forwarded only from this panel's parent.
  var reportContext = null;
  var legacyReport = null;
  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent || !ev.data) return;
    var msg = ev.data;
    if (msg.__bpReportBound && typeof msg.contextId === "string") {
      reportContext = msg.contextId;
      frame.contentWindow.postMessage({ type: "bp:host-context", contextId: reportContext }, "*");
    }
    if (msg.__bpReportResult && typeof msg.requestId === "string") {
      if (legacyReport && msg.requestId === legacyReport.requestId) {
        badge.textContent = msg.status === "sent" ? "战报已送入对话" : msg.status === "sent-trigger-failed" ? "战报已发送，回复未触发" : "战报未确认送达，请检查对话";
        if (msg.status !== "sent" && warnEl) { warnEl.style.display = "block"; warnEl.textContent = msg.detail || "请检查对话中的战报"; }
      }
      frame.contentWindow.postMessage({ ...msg, type: "bp:report:ack" }, "*");
    }
  });
  frame.addEventListener("load", function () {
    if (reportContext) frame.contentWindow.postMessage({ type: "bp:host-context", contextId: reportContext }, "*");
    window.parent.postMessage({ __bpReportBind: true }, "*");
  });
  window.parent.postMessage({ __bpReportBind: true }, "*");

'''+boot[b:]

# Build one verified host handler in the Tavern Helper script environment.
h=old_heal
host=(ROOT/'st-integration/report-host.js').read_text(encoding='utf-8')
h=once(h,'  function main() {', host+'\n  function main() {')
h=once(h,'    // ---- 中继接收端（v1.0 死信修复 + P1 名单请求）', '''    var reportHost = createBattleReportHost({
      getContext: function () {
        try { if (w.SillyTavern && w.SillyTavern.getContext) return w.SillyTavern.getContext(); } catch (e) {}
        return getCtx();
      },
      executeSlash: function (command) {
        var slash = findApi('triggerSlash');
        if (!slash) throw new Error('酒馆命令接口不可用');
        return slash(command);
      },
      reply: function (source, message) { try { source.postMessage(message, '*'); } catch (e) {} },
      connected: function (source) {
        return Array.from(w.document.querySelectorAll('iframe')).some(function (f) { return f.isConnected && f.contentWindow === source; });
      },
      busy: function () { var stop = w.document.getElementById('mes_stop'); return !!(stop && stop.getClientRects().length); }
    });
    // ---- 中继接收端（v1.0 死信修复 + P1 名单请求）''')
h=once(h,'      if (d.__bpWantRoster) {', '''      if (d.__bpReportBind || d.__bpReportRequest) {
        var isPanel = isHeal;
        try { isPanel = isPanel || !!src.contentDocument.getElementById('bp-root'); } catch (e) {}
        if (!isPanel) return;
        if (d.__bpReportBind) reportHost.bind(ev.source);
        else reportHost.receive(ev.source, d.request, d.query === true);
        return;
      }
      if (d.__bpWantRoster) {''')
# The mini fallback uses the same host path rather than fire-and-forget slash relay.
a=h.index("      '    if (ev.data.type === \"bp:report\" && typeof ev.data.text === \"string\") {'")
b=h.index("      '  });',",a)
h=h[:a]+'''      '    if ((ev.data.type === "bp:report" || ev.data.type === "bp:report:query") && typeof ev.data.requestId === "string") parent.postMessage({__bpReportRequest:true,query:ev.data.type==="bp:report:query",request:ev.data}, "*");',
      '    else if (ev.data.type === "bp:report" && typeof ev.data.text === "string") {if(!window.__miniLegacy || window.__miniLegacy.text!==ev.data.text) window.__miniLegacy={type:"bp:report",text:ev.data.text,contextId:window.__miniContext,requestId:"legacy-"+Date.now()+"-"+Math.random().toString(36).slice(2)};parent.postMessage({__bpReportRequest:true,request:window.__miniLegacy},"*");}',
'''+h[b:]
h=h.replace('roster: window.__BP_ROSTER__ || null, depth: null, ts: Date.now()', 'roster: window.__BP_ROSTER__ || null, depth: null, contextId: window.__miniContext || null, ts: Date.now()')
# srcdoc shim forwards context/receipt only for mini fallback; full template owns its own forwarding.
h=once(h,"    var shim = '<scr' + 'ipt>window.__BP_ROSTER__ = '", "    var shim = '<scr' + 'ipt>window.__BP_ROSTER__ = '")
line="      + 'window.addEventListener(\"load\", function(){ try { parent.postMessage({__bpHealH: Math.max(60, document.body.scrollHeight)}, \"*\"); } catch(e){} });'"
new='''      + 'var __miniContext=null;window.addEventListener("message",function(e){if(e.source!==parent||!e.data)return;var f=document.getElementById("eng");if(!f)return;if(e.data.__bpReportBound){__miniContext=e.data.contextId;f.contentWindow.postMessage({type:"bp:host-context",contextId:__miniContext},"*");}if(e.data.__bpReportResult)f.contentWindow.postMessage(Object.assign({},e.data,{type:"bp:report:ack"}),"*");});'
      + 'window.addEventListener("load", function(){var f=document.getElementById("eng");if(f)f.addEventListener("load",function(){parent.postMessage({__bpReportBind:true},"*");});parent.postMessage({__bpReportBind:true},"*");try { parent.postMessage({__bpHealH: Math.max(60, document.body.scrollHeight)}, "*"); } catch(e){} });' '''
h=once(h,line,new.rstrip())

# Replace exact JSON string tokens. json.dumps may differ from original escape choices,
# so use the JSON decoder to locate the strings without reformatting the whole card.
def replace_token(raw, old, new):
    decoder=json.JSONDecoder(); positions=[]
    i=0
    while i<len(raw):
        if raw[i]!='"': i+=1; continue
        value,end=decoder.raw_decode(raw,i)
        if value==old: positions.append((i,end))
        i=end
    assert len(positions)==1,len(positions)
    a,b=positions[0]
    return raw[:a]+json.dumps(new,ensure_ascii=False)+raw[b:]
result=replace_token(original,old_boot,boot)
result=replace_token(result,old_heal,h)
after=json.loads(result)
regex['replaceString']=boot; heal['content']=h
assert after==card,'Unexpected structural changes'
current=json.loads(CARD.read_text(encoding='utf-8'))
current_regex=next(r for r in current['data']['extensions']['regex_scripts'] if r['scriptName']=='battle-forge-panel')
current_heal=next(s for s in current['data']['extensions']['tavern_helper']['scripts'] if s['name']=='自愈（启动守卫+战斗面板）')
current_regex['replaceString']=boot; current_heal['content']=h
assert current==after, 'Card has other user changes; refusing to overwrite them from the baseline backup'
CARD.write_text(result,encoding='utf-8',newline='')

# Active current templates + standalone import package: preserve regex metadata.
lines=boot.strip().splitlines(); template='\n'.join(lines[1:-1]).strip()+'\n'
(ROOT/'st-integration/bootstrap-template.html').write_text(template.replace('var APP_URL_DEFAULT = "https://aiuewh.github.io/battle-forge/"','var APP_URL_DEFAULT = "{{APP_URL}}"'),encoding='utf-8')
(ROOT.parent/'bootstrap-template.html').write_text(template,encoding='utf-8')
pack=ROOT/'download/battle-forge-st-pack'
pack.mkdir(exist_ok=True)
(pack/'battle-forge-panel.json').write_text(json.dumps([regex],ensure_ascii=False,indent=2),encoding='utf-8')
local=json.loads(json.dumps(regex)); local['replaceString']=boot.replace('var APP_URL_DEFAULT = "https://aiuewh.github.io/battle-forge/"','var APP_URL_DEFAULT = "http://localhost:3000/"')
local['id']='battle-forge-panel-local'; local['scriptName']='battle-forge-panel-local'
(pack/'battle-forge-panel-local.json').write_text(json.dumps([local],ensure_ascii=False,indent=2),encoding='utf-8')
(ROOT/'public/st-bootstrap.html').write_text(template,encoding='utf-8')
(ROOT.parent/'_改进备份_20261013/selfheal_updated.js').write_text(h,encoding='utf-8')
print('Card changed fields: battle-forge-panel.replaceString; self-heal.content. All other fields preserved.')
