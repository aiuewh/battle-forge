'use client';

/**
 * 常驻先攻追踪条（桌面密度档）：参考 Foundry Combat Tracker——
 * 金色回合徽章 + 先攻数字列 + 当前行动者整块高亮，点击任意单位选中
 * 移动端（≤800px）由 CSS 隐藏，保留原「接下来」折叠条
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { CONDITIONS } from '@/lib/engine/conditions';

export function InitiativeTrackerStrip() {
  const store = useBattleStore();
  const { units, turn, battleActive } = store;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const currentRef = useRef<HTMLButtonElement | null>(null);

  const ordered = useMemo(() => {
    const orderMap = new Map(turn.order.map((id, i) => [id, i]));
    return [...units].sort((a, b) =>
      (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999) || b.init - a.init);
  }, [units, turn.order]);

  useEffect(() => {
    const chip = currentRef.current, sc = scrollRef.current;
    if (!chip || !sc) return;
    const target = chip.offsetLeft - (sc.clientWidth - chip.offsetWidth) / 2;
    sc.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [turn.currentUnitId, ordered.length]);

  if (!battleActive) return null;

  return (
    <div className="stage-tracker" ref={scrollRef} aria-label="先攻顺序追踪">
      <div className="stage-tracker-round">第 {turn.round} 轮</div>
      {ordered.map(u => {
        const isCurrent = u.id === turn.currentUnitId;
        const isDown = u.hp <= 0 || u.deathSaves?.dead;
        return (
          <button key={u.id} ref={isCurrent ? currentRef : undefined}
            className={`stage-tracker-chip${isCurrent ? ' is-current' : ''}${isDown ? ' is-down' : ''}`}
            aria-current={isCurrent || undefined}
            title={`${u.name} · 先攻 ${u.init} · HP ${Math.max(0, u.hp)}/${u.maxHp} · AC ${u.ac}`}
            onClick={() => store.setSelectedId(store.selectedId === u.id ? null : u.id)}>
            <b>{u.init}</b>
            <span>{u.isPlayer ? '★' : ''}{u.name}</span>
            {isDown
              ? <span className="st-ico">💀</span>
              : u.statuses.slice(0, 2).map(st => (
                <span key={st} className="st-ico" style={{ color: CONDITIONS[st]?.color ?? '#aaa' }}>{CONDITIONS[st]?.icon ?? '❓'}</span>
              ))}
          </button>
        );
      })}
    </div>
  );
}
