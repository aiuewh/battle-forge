export type DeliveryStatus = 'idle' | 'sending' | 'sent' | 'sent-trigger-failed' | 'failed' | 'unknown';
export interface DeliveryState { status: DeliveryStatus; detail: string; requestId?: string; }

/** Shared, testable transport. A timeout never automatically resends a report. */
export class ReportDelivery {
  private state: DeliveryState = { status: 'idle', detail: '' };
  private request: { requestId: string; text: string; contextId?: string } | null = null;
  private contextId?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();
  constructor(private post: (message: unknown) => void, private timeoutMs = 12000) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(state: DeliveryState) { this.state = state; this.listeners.forEach(fn => fn()); }
  bind(contextId: string) {
    if (this.contextId && this.contextId !== contextId) {
      clearTimeout(this.timer);
      this.update({ status: 'unknown', detail: '聊天上下文已变化，请重新打开当前面板' });
      this.request = null;
    }
    this.contextId = contextId;
  }
  send(text: string) {
    if (this.state.status === 'sending') return;
    if (this.request?.text === text && ['sent', 'sent-trigger-failed'].includes(this.state.status)) return;
    if (this.request && this.state.status === 'unknown') { this.query(); return; }
    this.request = { requestId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, text, contextId: this.contextId };
    this.dispatch('bp:report');
  }
  query() { if (this.request) this.dispatch('bp:report:query'); }
  private dispatch(type: string) {
    if (!this.request) return;
    this.update({ status: 'sending', detail: type.endsWith('query') ? '正在查询回执，不重复发送战报' : '正在等待酒馆确认', requestId: this.request.requestId });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update({ status: 'unknown', requestId: this.request?.requestId, detail: '未确认送达。请先检查对话，查询回执不会重复发送；也可复制战报。' }), this.timeoutMs);
    try { this.post({ type, ...this.request }); }
    catch { clearTimeout(this.timer); this.update({ status: 'failed', detail: '发送通道不可用', requestId: this.request.requestId }); }
  }
  acknowledge(message: { requestId?: string; contextId?: string; status?: string; detail?: string }) {
    if (!this.request || message.requestId !== this.request.requestId || (this.contextId && message.contextId !== this.contextId)) return;
    if (!['sent', 'sent-trigger-failed', 'failed', 'unknown'].includes(message.status ?? '')) return;
    clearTimeout(this.timer);
    this.update({ status: message.status as DeliveryStatus, detail: message.detail ?? '', requestId: message.requestId });
  }
}

export const reportDelivery = new ReportDelivery(message => {
  if (typeof window === 'undefined' || window.parent === window) throw new Error('No host');
  window.parent.postMessage(message, '*');
});

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  idle: '战报送回对话', sending: '发送中…', sent: '已送入对话',
  'sent-trigger-failed': '已发送，回复未触发', failed: '重试发送', unknown: '查询送达回执',
};
