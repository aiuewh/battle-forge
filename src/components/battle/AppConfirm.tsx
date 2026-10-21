'use client';

/**
 * 应用内确认弹窗（window.confirm 的替代）
 *
 * 嵌入酒馆的沙箱 iframe 未必带 allow-modals：原生 confirm 在其中会静默返回
 * false，令「结束战斗 / AoE 波及友军 / 放弃续打」等关键操作看似按钮失灵。
 * 所有需要二次确认的入口一律 `await appConfirm('…')`，由挂在页面顶层的
 * AppConfirmHost 统一渲染；宿主环境正常时视觉与原生模态一致且可键盘操作。
 */
import React from 'react';
import { create } from 'zustand';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface PendingConfirm {
  message: string;
  title: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

const useAppConfirmStore = create<{
  pending: PendingConfirm | null;
  ask: (message: string, opts?: { title?: string; danger?: boolean }) => Promise<boolean>;
  settle: (ok: boolean) => void;
}>(set => ({
  pending: null,
  ask: (message, opts) => new Promise<boolean>(resolve => {
    const prev = useAppConfirmStore.getState().pending;
    set({ pending: { message, title: opts?.title ?? '确认操作', danger: opts?.danger ?? false, resolve } });
    prev?.resolve(false); // 同一时刻只保留最后一条请求，被顶替的按取消结算
  }),
  settle: ok => {
    const p = useAppConfirmStore.getState().pending;
    set({ pending: null });
    p?.resolve(ok);
  },
}));

/** promise 化确认：`if (!(await appConfirm('…'))) return;` danger=true 时确认键为红色危险样式。 */
export function appConfirm(message: string, opts?: { title?: string; danger?: boolean }): Promise<boolean> {
  return useAppConfirmStore.getState().ask(message, opts);
}

/** 确认弹窗是否打开（供全局按键处理器避让，避免 Escape 连带清掉底层操作状态）。 */
export function appConfirmOpen(): boolean {
  return !!useAppConfirmStore.getState().pending;
}

export function AppConfirmHost() {
  const pending = useAppConfirmStore(s => s.pending);
  const settle = useAppConfirmStore(s => s.settle);
  return (
    <Dialog open={!!pending} onOpenChange={v => { if (!v) settle(false); }}>
      <DialogContent className="dnd-theme battle-dialog app-confirm"
        onOpenAutoFocus={e => { e.preventDefault(); document.getElementById('app-confirm-yes')?.focus(); }}>
        <DialogHeader><DialogTitle>{pending?.title ?? '确认操作'}</DialogTitle></DialogHeader>
        <p className="app-confirm-message">{pending?.message}</p>
        <div className="app-confirm-actions">
          <button type="button" onClick={() => settle(false)}>取消</button>
          <button type="button" id="app-confirm-yes" className={pending?.danger ? 'app-confirm-danger' : 'app-confirm-primary'} onClick={() => settle(true)}>确认</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
