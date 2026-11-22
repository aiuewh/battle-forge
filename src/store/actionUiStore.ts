'use client';
import { create } from 'zustand';
import type { AiAbility } from '@/lib/engine/types';
import type { HudPlayerAction } from '@/lib/engine/hudTargets';

export interface ActionRequest {
  actorId: string;
  ability: AiAbility;
  continuation?: boolean;
  castLevel?: number;
  consumeSlot?: boolean;
  playerAction?: HudPlayerAction;
}
// Ephemeral selection only: never persisted or exported in battle reports.
export const useActionUiStore = create<{
  request: ActionRequest | null; targetId: string | null; originPos: { x: number; y: number } | undefined;
  angle: number | undefined; error: string | null;
  movingActorId: string | null;
  /** 当前打开的浮层菜单标识。同一时刻只允许一个，
   *  否则战场菜单（BattleWorkspace）和 HUD 动作菜单（ActionBar）会叠着显示、
   *  且互相不认对方的 outside-click，两个都能停在屏幕上。 */
  openMenu: string | null;
  begin: (request: ActionRequest) => void; select: (id: string | null) => void;
  place: (pos: { x: number; y: number }) => void; rotate: (angle: number) => void;
  fail: (reason: string | null) => void; clear: () => void;
  move: (actorId: string) => void;
  /** 打开/关闭浮层；打开时自动关掉其他浮层 */
  setMenu: (id: string | null) => void;
  /** 关闭某个浮层（仅当它确实是当前打开的） */
  closeMenu: (id: string) => void;
}>((set, get) => ({
  request: null, targetId: null, originPos: undefined, angle: undefined, error: null, movingActorId: null,
  openMenu: null,
  begin: request => set({ request, targetId: null, originPos: undefined, angle: undefined, error: null, movingActorId: null }),
  select: targetId => set({ targetId, originPos: undefined, angle: undefined, error: null }),
  place: originPos => set({ originPos, targetId: null, error: null }),
  rotate: angle => set({ angle }), fail: error => set({ error }),
  clear: () => set({ request: null, targetId: null, originPos: undefined, angle: undefined, error: null, movingActorId: null }),
  move: movingActorId => set({ request: null, targetId: null, originPos: undefined, angle: undefined, error: null, movingActorId }),
  setMenu: id => set({ openMenu: id }),
  closeMenu: id => { if (get().openMenu === id) set({ openMenu: null }); },
}));
