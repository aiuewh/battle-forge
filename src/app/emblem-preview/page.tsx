'use client';

/**
 * 校验页：resource 矢量图标的 3D 徽章（逐图标 × 逐转台相位）+ 红四棱锥对照 + 真实地图实景
 */
import React, { useEffect, useRef, useState } from 'react';
import { getIconStage, type IconKind } from '@/components/battle/emblem3d/stage';
import { BattleMapIso } from '@/components/battle/BattleMapIso';
import { useBattleStore } from '@/store/battleStore';
import { MONSTER_PRESETS, unitFromPreset } from '@/lib/engine/presets';
import type { CreatureKind } from '@/lib/engine/types';

const ROWS: Array<{ label: string; kind: IconKind }> = [
  { label: '龙类（大龙.svg）', kind: 'dragon' },
  { label: '飞龙（小龙.svg）', kind: 'wyvern' },
  { label: '恶魔（恶魔.svg）', kind: 'demon' },
  { label: '亡灵（亡灵.svg·狰狞v5）', kind: 'undead' },
  { label: '精灵（精怪.svg）', kind: 'fey' },
  { label: '邪信徒（邪信徒.svg）', kind: 'cultist' },
  { label: '野兽（野兽.svg）', kind: 'beast' },
  { label: '构装体（构装体.svg）', kind: 'construct' },
  { label: '人类（人形.svg·剑盾）', kind: 'humanoid' },
  { label: '兽人（兽人.svg·獠牙）', kind: 'orc' },
  { label: '未知（未知.svg）', kind: 'generic' },
  { label: '哥布林/野怪（哥布林.svg）', kind: 'goblin' },
];
const PHASES = [-0.5, -0.25, 0, 0.25, 0.8];
const COLS = PHASES.map((_, i) => 210 + i * 128);
const ROW_H = 150;
const GRID_TOP = 46;
const W = 960;
const H = GRID_TOP + ROWS.length * ROW_H + 40;

export default function EmblemPreviewPage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  // 真实地图：载入演示遭遇 + 龙类敌人（观察 3D 徽章实景）
  useEffect(() => {
    const s = useBattleStore.getState();
    s.loadDemoBattle();
    const extra: Array<{ preset: string; cx: number; cy: number; type?: CreatureKind; name?: string }> = [
      { preset: '成年红火龙', cx: 12, cy: 4 },
      { preset: '双足飞龙', cx: 12, cy: 6 },
      { preset: '死灵法师', cx: 20, cy: 7, type: 'demon', name: '恶魔卫士' },
    ];
    const units = extra.map((e, i) => ({
      ...unitFromPreset(MONSTER_PRESETS.find(m => m.name === e.preset)!, 20 + i, true),
      ...(e.type ? { creatureType: e.type } : {}),
      ...(e.name ? { name: e.name } : {}),
      pos: { x: e.cx * 5, y: e.cy * 5 },
    }));
    useBattleStore.setState(st => ({ units: [...st.units, ...units] }));
    setReady(true);
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#100d09');
    bg.addColorStop(1, '#1a1410');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.font = '12px "Noto Sans SC", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8a8578';
    PHASES.forEach((p, i) => ctx.fillText(`${Math.round((p * 180) / Math.PI)}°`, COLS[i], 24));

    const stage = getIconStage();
    ROWS.forEach(({ label, kind }, row) => {
      const cy = GRID_TOP + row * ROW_H;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#c9c2b4';
      ctx.fillText(label, 92, cy + 60);
      PHASES.forEach((p, i) => {
        stage.drawIcon(ctx, {
          x: COLS[i], groundY: cy + 108, size: 92, kind,
          spin: p, lift: i === 2 ? 5 : 0,
        });
      });
    });
  }, []);

  return (
    <div className="min-h-screen bg-[#100d09] p-4">
      <canvas ref={ref} />
      <div className="mt-6 w-[1240px] max-w-full">{ready && <BattleMapIso />}</div>
    </div>
  );
}
