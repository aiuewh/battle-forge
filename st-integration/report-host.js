/* Embedded in the existing Tavern Helper host script, not loaded from a network. */
function createBattleReportHost(options) {
  var owners = new WeakMap();
  var receipts = new Map();
  function current(owner) {
    var ctx = options.getContext();
    return ctx && ctx.chat === owner.chat && ctx.characterId === owner.characterId && ctx.chatId === owner.chatId;
  }
  function normalize(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
  function bind(source) {
    var ctx = options.getContext();
    if (!ctx || !Array.isArray(ctx.chat)) return;
    var owner = owners.get(source);
    if (owner && !current(owner)) return; // An old iframe may never bind itself to another chat.
    if (!owner) {
      owner = { chat: ctx.chat, characterId: ctx.characterId, chatId: ctx.chatId,
        contextId: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) };
      owners.set(source, owner);
    }
    options.reply(source, { __bpReportBound: true, contextId: owner.contextId });
  }
  function reply(source, request, status, detail) {
    options.reply(source, { __bpReportResult: true, requestId: request.requestId, contextId: request.contextId, status: status, detail: detail });
  }
  async function receive(source, request, query) {
    var owner = owners.get(source);
    if (!request || typeof request.requestId !== 'string' || request.requestId.length > 160) return;
    if (!owner || request.contextId !== owner.contextId || !current(owner) || !options.connected(source)) {
      reply(source, request, 'failed', '聊天已切换或面板已失效，请重新打开当前面板'); return;
    }
    var old = receipts.get(request.requestId);
    if (old) {
      if (old.source !== source || old.contextId !== request.contextId) return;
      if (old.status) reply(source, request, old.status, old.detail);
      return;
    }
    if (query) { reply(source, request, 'unknown', '没有找到已完成的回执，请先检查对话；未重复发送战报'); return; }
    if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 500000) {
      reply(source, request, 'failed', '战报为空或过长'); return;
    }
    if (options.busy && options.busy()) { reply(source, request, 'failed', '酒馆仍在生成，请完成后重试'); return; }
    var record = { source: source, contextId: owner.contextId, status: null, detail: '' };
    receipts.set(request.requestId, record); // Register before any asynchronous command.
    function finish(status, detail) {
      record.status = status; record.detail = detail;
      reply(source, request, status, detail);
      if (receipts.size > 200) {
        for (var entry of receipts) { if (entry[1].status) { receipts.delete(entry[0]); break; } }
      }
    }
    var body = request.text.trim().replace(/\r?\n/g, ' ').replace(/\|/g, '｜');
    var escaped = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    var from = owner.chat.length;
    var sent = false;
    function observed() {
      return owner.chat.slice(from).some(function (m) { return m.is_user && normalize(m.mes) === normalize(body); });
    }
    try {
      if (!current(owner) || !options.connected(source)) { finish('failed', '面板所属聊天已变化，未发送'); return; }
      await options.executeSlash('/send "' + escaped + '"');
      // Some helpers return before their message append; require observable insertion.
      for (var i = 0; i < 40 && !observed() && current(owner); i++) await new Promise(function (resolve) { setTimeout(resolve, 50); });
      sent = observed();
      if (!sent) { finish('unknown', '命令已执行，但未观察到战报进入对话。请先检查对话，勿重复发送'); return; }
      if (!current(owner) || !options.connected(source)) { finish('sent-trigger-failed', '战报已进入原聊天；聊天已切换，未触发回复'); return; }
      try { await options.executeSlash('/trigger'); }
      catch (e) { finish('sent-trigger-failed', '战报已送入对话，DM 回复未触发；可手动继续，勿重复发送'); return; }
      finish('sent', '酒馆已确认战报进入对话，已请求 DM 回复');
    } catch (e) {
      sent = observed();
      // A command error does not prove that the send had no side effects.
      finish(sent ? 'sent-trigger-failed' : 'unknown', sent ? '战报已送入对话，后续命令失败' : '发送命令异常，送达状态未确认；请检查对话');
    }
  }
  return { bind: bind, receive: receive };
}
