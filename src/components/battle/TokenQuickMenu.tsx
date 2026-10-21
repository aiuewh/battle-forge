'use client';

/**
 * Token 上下文快捷菜单：点击棋子后在其正上方弹出（移动 / 武器攻击 / 详情）
 * 参考 Foundry 的空间局部性——控制出现在被操作对象旁边，而不是底部的远端面板
 */
import React, { useEffect, useRef } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { useActionUiStore } from '@/store/actionUiStore';
import { abilityDisabledReason } from './abilityGate';
import { effectiveSpeed } from '@/lib/engine/rules';
import { Footprints, Info, Swords, X } from 'lucide-react';

const MENU_W = 158;
const ITEM_H = 40;

export function TokenQuickMenu({ unitId, x, y, mapW, mapH, onClose, onInspect }: {
  unitId: string; x: number; y: number; mapW: number; mapH: number;
  onClose: () => void; onInspect?: (id: string) => void;
}) {
  const store = useBattleStore();
  const ui = useActionUiStore();
  const unit = store.units.find(u => u.id === unitId);
  const turnRef = useRef(store.turn.currentUnitId);

  const isCurrent = store.battleActive && store.turn.currentUnitId === unitId;
  const alive = !!unit && unit.hp > 0 && !unit.deathSaves?.dead;
  const canAct = !!unit && !!isCurrent && alive
    && unit.attitude === 0 && (unit.isPlayer || unit.playerControlled)
    && !store.readOnly && !store.pendingReactionStep
    && !ui.request && !ui.movingActorId;

  // 换人/开请求/开移动即关闭：菜单是瞬时轻量入口，不是持久面板
  useEffect(() => { if (turnRef.current !== store.turn.currentUnitId) onClose(); }, [store.turn.currentUnitId, onClose]);
  useEffect(() => { if (ui.request || ui.movingActorId) onClose(); }, [ui.request, ui.movingActorId, onClose]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  if (!unit || !alive) return null;

  const weapons = (unit.aiAbilities ?? []).filter(a => ['melee', 'ranged'].includes(a.kind) && a.spellLevel === undefined).slice(0, 2);
  const movementLeft = Math.max(0, effectiveSpeed(unit) - unit.actionEconomy.movementUsed);
  const moveDisabled = !canAct || movementLeft <= 0;

  const rows: Array<{ key: string; label: string; icon: React.ReactNode; disabled: boolean; title?: string; run: () => void }> = [];
  if (canAct && unit.actionEconomy) {
    rows.push({
      key: 'move', label: '移动', icon: <Footprints size={15} />, disabled: moveDisabled,
      title: movementLeft <= 0 ? '本回合移动力已用尽' : `剩余 ${movementLeft} 尺`,
      run: () => { store.setSelectedId(unit.id); ui.move(unit.id); onClose(); },
    });
    for (const w of weapons) {
      const why = abilityDisabledReason(unit, w, { locked: false, isCurrent: true });
      rows.push({
        key: w.id, label: w.name || '攻击', icon: <Swords size={15} />, disabled: !!why, title: why ?? undefined,
        run: () => { ui.begin({ actorId: unit.id, ability: w }); onClose(); },
      });
    }
  }
  rows.push({ key: 'inspect', label: '详情', icon: <Info size={15} />, disabled: false, run: () => { onInspect?.(unit.id); onClose(); } });

  const estH = rows.length * ITEM_H + 34;
  const left = Math.min(Math.max(8, x - MENU_W / 2), Math.max(8, mapW - MENU_W - 8));
  const top = Math.min(Math.max(8, y - estH - 16), Math.max(8, mapH - estH - 8));

  return (
    <div className="token-quick-menu" role="menu" aria-label={`${unit.name}快捷操作`}
      style={{ left, top, width: MENU_W }}
      onPointerDown={e => e.stopPropagation()}>
      <div className="token-quick-menu-head">
        <strong style={{ color: unit.isPlayer ? '#f5c542' : unit.attitude === 2 ? '#ff8a75' : '#7fe0a0' }}>{unit.name}</strong>
        <button aria-label={`关闭${unit.name}菜单`} onClick={onClose}><X size={14} /></button>
      </div>
      {rows.map(r => (
        <button key={r.key} role="menuitem" disabled={r.disabled} title={r.title ?? r.label}
          onClick={() => r.run()}>
          {r.icon}<span>{r.label}</span>
        </button>
      ))}
    </div>
  );
}
