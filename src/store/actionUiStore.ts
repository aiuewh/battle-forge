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
  begin: (request: ActionRequest) => void; select: (id: string | null) => void;
  place: (pos: { x: number; y: number }) => void; rotate: (angle: number) => void;
  fail: (reason: string | null) => void; clear: () => void;
  move: (actorId: string) => void;
}>((set) => ({
  request: null, targetId: null, originPos: undefined, angle: undefined, error: null, movingActorId: null,
  begin: request => set({ request, targetId: null, originPos: undefined, angle: undefined, error: null, movingActorId: null }),
  select: targetId => set({ targetId, originPos: undefined, angle: undefined, error: null }),
  place: originPos => set({ originPos, targetId: null, error: null }),
  rotate: angle => set({ angle }), fail: error => set({ error }),
  clear: () => set({ request: null, targetId: null, originPos: undefined, angle: undefined, error: null, movingActorId: null }),
  move: movingActorId => set({ request: null, targetId: null, originPos: undefined, angle: undefined, error: null, movingActorId }),
}));
