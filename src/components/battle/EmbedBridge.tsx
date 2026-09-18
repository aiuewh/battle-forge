'use client';

/**
 * 嵌入模式桥接器 + 多面板运行时：
 * - 酒馆 bootstrap iframe 通过 postMessage 发送 {type:'bp:battle', payload, depth}
 * - payload 统一走 importDmMessage 全路由：<battle> 合并 / <UpdateVariable> 变量同步 / <encounter> 敌卡暂存
 * - 回复 {type:'bp:ready'} 握手；内容高度变化回传 {type:'bp:height'}
 * - 多面板共存（最近 N 楼各一个 iframe）：领导者选举 —— 仅领导者跑 AI 驱动器并写存储；
 *   非领导者只读 + 周期同步，防止 AI 双驱动与旧楼过期状态回写
 * - URL ?embed=1 时启用
 */
import React, { useEffect, useRef, useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { parseDmMessage } from '@/lib/engine/protocol';
import { EmbedPanel } from '@/lib/engine/embedSync';

/** 全局唯一面板实例（嵌入模式 = 当前楼层；独立模式 = 参与多标签页选举） */
let panelSingleton: EmbedPanel | null = null;

export function getEmbedPanel(): EmbedPanel | null {
  return panelSingleton;
}

/**
 * 应用运行时：领导者选举 + 只读锁 + 非领导者状态同步
 * 返回 { ready, isLeader }（独立模式恒为 leader）
 */
export function useAppRuntime(embedded: boolean) {
  const [state, setState] = useState({ ready: false, isLeader: true });
  const panelRef = useRef<EmbedPanel | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const store = useBattleStore.getState();

    // 独立模式：深度 0 参与选举（多标签页防双驱动）；嵌入模式：深度由 bootstrap 回传，初始 null
    const panel = new EmbedPanel(embedded ? null : 0);
    panelSingleton = panel;
    panelRef.current = panel;

    const unsub = panel.onLeaderChange(isLeader => {
      const st = useBattleStore.getState();
      st.setReadOnly(!isLeader);
      if (isLeader) {
        // 接管领导权：先对齐一次共享存储
        st.hydrateFromPersisted();
      }
      setState({ ready: true, isLeader });
    });

    panel.start();
    store.setReadOnly(!panel.isLeader);
    // 初始领导状态经微任务回填（避免 effect 内同步 setState 级联渲染）
    queueMicrotask(() => setState({ ready: true, isLeader: panel.isLeader }));

    // 非领导者：周期同步共享存储，保持视图跟进领导者
    const syncTimer = setInterval(() => {
      if (!panel.isLeader) {
        useBattleStore.getState().hydrateFromPersisted();
      }
    }, 2000);

    return () => {
      unsub();
      clearInterval(syncTimer);
      panel.stop();
      if (panelSingleton === panel) panelSingleton = null;
    };
  }, [embedded]);

  return state;
}

export function useEmbedBridge(active: boolean) {
  const lastPayloadTs = useRef(0);

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;

    // 高度上报（ResizeObserver 监听内容根节点）
    const reportHeight = () => {
      const h = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        480,
      );
      try {
        window.parent.postMessage({ type: 'bp:height', height: h }, '*');
      } catch { /* noop */ }
    };

    const ro = new ResizeObserver(() => reportHeight());
    ro.observe(document.body);
    reportHeight();

    // 握手：通知 bootstrap 应用已就绪
    try {
      window.parent.postMessage({ type: 'bp:ready' }, '*');
    } catch { /* noop */ }

    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'bp:battle' && typeof msg.payload === 'string') {
        // 防重复（bootstrap 加载成功 + ready 握手可能各发一次）
        if (msg.ts && msg.ts <= lastPayloadTs.current) return;
        if (msg.ts) lastPayloadTs.current = msg.ts;
        // 楼层深度回填到面板注册表（领导者选举用）
        const panel = getEmbedPanel();
        if (panel && typeof msg.depth === 'number') panel.setDepth(msg.depth);
        // 全路由：battle 快照合并 + UpdateVariable 变量同步 + encounter 敌卡暂存 + 自动配装
        // 哈希链门控在 store 内部完成（重复导入/过期楼层自动跳过）
        const parsed = parseDmMessage(msg.payload);
        if (parsed.latestBattle || parsed.patches.length > 0 || parsed.statblockBlocks.length > 0) {
          useBattleStore.getState().importDmMessage(
            msg.payload,
            'embed',
            typeof msg.depth === 'number' ? msg.depth : null,
          );
        }
        reportHeight();
      }
      if (msg.type === 'bp:ping') {
        try {
          window.parent.postMessage({ type: 'bp:pong' }, '*');
        } catch { /* noop */ }
      }
      if (msg.type === 'bp:query') {
        // 调试探针：返回面板当前状态摘要（酒馆控制台可用，E2E 验证用）
        try {
          const st = useBattleStore.getState();
          window.parent.postMessage({
            type: 'bp:state',
            state: {
              units: st.units.map(u => `${u.name} ${u.hp}/${u.maxHp} AC${u.ac}`),
              battleActive: st.battleActive,
              round: st.turn.round,
              chainLen: st.importChain.appliedHashes.length,
              readOnly: st.readOnly,
              staged: (st.stagedStatblocks ?? []).map(s => s.name),
            },
          }, '*');
        } catch { /* noop */ }
      }
    };
    window.addEventListener('message', onMessage);

    // 兜底周期上报（字体加载/图片加载改变高度）
    const interval = setInterval(reportHeight, 2000);

    return () => {
      ro.disconnect();
      window.removeEventListener('message', onMessage);
      clearInterval(interval);
    };
  }, [active]);
}

/** 检测是否处于嵌入环境（iframe 内） */
export function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('embed') === '1' || (window.self !== window.top && window.location.hostname !== window.parent?.location?.hostname);
}
