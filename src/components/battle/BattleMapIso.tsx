'use client';

/**
 * 2.5D 等距战术地图（Canvas 渲染）
 * - 绿色圆球 = 玩家与队友（玩家带金环★）、红色四棱锥 = 敌方、灰色立方体 = 掩体
 * - token 拖拽（成本徽章 + 占用校验）、移动范围高亮、AoE 模板、测距、掩体绘制
 * - 伤害/治疗飘字、攻击突进与挥砍、死亡变灰
 * - 滚轮缩放（光标中心）、拖拽平移、自动适配视野
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import {
  CELL, posToCell, cellToFeet, cellCenter, cellKey, unitOccupiedCells,
  reachableCells, gridDistanceCells, aoeCells,
  AOE_PRESETS,
} from '@/lib/engine/geometry';
import type { AoeTemplate, MapObstacle, Cell } from '@/lib/engine/types';
import { SIZE_META } from '@/lib/engine/types';
import { CONDITIONS } from '@/lib/engine/conditions';
import { remainingMovement } from '@/lib/engine/rules';
import {
  makeProjector, strHash, drawFloorTile, drawCellOverlay, drawCube, drawShadow,
  drawSphere, drawPyramid, drawHpBar, drawLabel, drawRing,
  drawSlash, drawFloatText, drawBadge, TILE_W, TILE_H,
  type IsoCam,
} from './iso/isoScene';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  MousePointer2, Ruler, Flame, BrickWall, Trash2, ZoomIn, ZoomOut, Maximize,
} from 'lucide-react';

type Tool = 'select' | 'measure' | 'aoe' | 'obstacle';

interface DragState {
  kind: 'token' | 'pan' | 'measure' | 'aoe' | 'obstacle' | null;
  unitId?: string;
  startX: number; startY: number;   // 起点（格）
  curX: number; curY: number;       // 当前（格；pan 时为屏幕）
  lastScreenX: number; lastScreenY: number; // 上次屏幕位置（pan 增量用）
  screenStartX: number; screenStartY: number;
  moved: boolean;
  obstacleCells?: Cell[];
}

interface FloatEffect {
  id: string;
  unitId: string;
  text: string;
  color: string;
  born: number;
  big: boolean;
}
interface SlashEffect {
  id: string;
  x: number; y: number;   // 网格坐标（攻击时换算）
  born: number;
}
interface LungeState { dirX: number; dirY: number; born: number }

const ALLY_COLORS = { hi: '#b8f7c6', mid: '#3ecf6a', lo: '#0c5e2c' };
const NEUTRAL_COLORS = { hi: '#ffe9b0', mid: '#e3ba55', lo: '#7d5c17' };

export function BattleMapIso({ compact = false }: { compact?: boolean }) {
  const store = useBattleStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [tool, setTool] = useState<Tool>('select');
  const [aoePreset, setAoePreset] = useState<(typeof AOE_PRESETS)[number] | null>(null);
  const [obstacleKind, setObstacleKind] = useState<MapObstacle['kind']>('full');
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ unitId: string; sx: number; sy: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });

  // 渲染循环内部状态（不走 React，避免高频 setState）
  const camRef = useRef<IsoCam>({ scale: 0.9, panX: 0, panY: 0 });
  const sizeRef = useRef({ w: 800, h: 500 });
  const dragRef = useRef<DragState | null>(null);
  const tokenHitsRef = useRef<Array<{ id: string; sx: number; sy: number; r: number }>>([]);
  const animPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const lungeRef = useRef<Map<string, LungeState>>(new Map());
  const floatsRef = useRef<FloatEffect[]>([]);
  const slashesRef = useRef<SlashEffect[]>([]);
  const seenEventsRef = useRef<Set<string>>(new Set());
  const fittedRef = useRef('');

  const setDragBoth = (d: DragState | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // ---------- 画布尺寸 ----------
  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const ro = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { w: rect.width, h: rect.height };
      setSize(prev => (Math.abs(prev.w - rect.width) > 1 || Math.abs(prev.h - rect.height) > 1) ? { w: rect.width, h: rect.height } : prev);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------- 视野适配 ----------
  const fitView = useCallback(() => {
    const s = useBattleStore.getState();
    const { units, obstacles, mapConfig } = s;
    let minX = 0, minY = 0, maxX = mapConfig.width, maxY = mapConfig.height;
    for (const u of units) {
      const c = posToCell(u.pos);
      minX = Math.min(minX, c.cx); minY = Math.min(minY, c.cy);
      maxX = Math.max(maxX, c.cx + 1); maxY = Math.max(maxY, c.cy + 1);
    }
    for (const o of obstacles) {
      for (const c of o.cells) {
        minX = Math.min(minX, c.cx); minY = Math.min(minY, c.cy);
        maxX = Math.max(maxX, c.cx + 1); maxY = Math.max(maxY, c.cy + 1);
      }
    }
    minX -= 1; minY -= 1; maxX += 1; maxY += 1;
    // 反 DoS：包围盒跨度上限 240 格（纵深防御——协议层已钳制 pos，此处防其他入口的离谱坐标冻结画布）
    maxX = Math.min(maxX, minX + 240); maxY = Math.min(maxY, minY + 240);
    // 投影包围盒
    const hw = TILE_W / 2, hh = TILE_H / 2;
    const leftX = (minX - maxY) * hw;
    const rightX = (maxX - minY) * hw;
    const topY = (minX + minY) * hh;
    const bottomY = (maxX + maxY) * hh;
    const bboxW = rightX - leftX;
    const bboxH = bottomY - topY + 90; // 顶部余量（token高度）
    const { w, h } = sizeRef.current;
    const scale = Math.min(1.5, Math.max(0.28, Math.min(w / bboxW, h / bboxH) * 0.94));
    camRef.current = {
      scale,
      panX: w / 2 - (leftX + rightX) / 2 * scale,
      panY: h / 2 - (topY + bottomY) / 2 * scale + 20 * scale,
    };
  }, []);

  // 单位数变化时自动适配（首次载入/演示）
  useEffect(() => {
    const s = useBattleStore.getState();
    const sig = `${s.units.length}:${s.mapConfig.width}x${s.mapConfig.height}`;
    if (s.units.length > 0 && fittedRef.current !== sig) {
      fittedRef.current = sig;
      // 等画布尺寸就绪
      requestAnimationFrame(() => fitView());
    }
    if (s.units.length === 0) fittedRef.current = '';
  }, [store.units.length, store.mapConfig.width, store.mapConfig.height, fitView]);

  // ---------- 事件特效（伤害飘字/攻击突进/挥砍） ----------
  useEffect(() => {
    const evs = store.events;
    for (let i = Math.max(0, evs.length - 15); i < evs.length; i++) {
      const ev = evs[i];
      if (seenEventsRef.current.has(ev.id)) continue;
      seenEventsRef.current.add(ev.id);
      if (Date.now() - ev.ts > 8000) continue; // 载入存档的历史事件不触发特效
      if (ev.type === 'damage' && ev.actorId) {
        const m = /受到 (\d+)/.exec(ev.text);
        if (m) {
          floatsRef.current.push({
            id: ev.id, unitId: ev.actorId, text: `-${m[1]}`,
            color: ev.level === 'crit' ? '#ff5a3c' : '#ff8570', born: performance.now(), big: ev.level === 'crit',
          });
        }
      } else if (ev.type === 'heal' && ev.actorId) {
        const m = /恢复 (\d+)/.exec(ev.text);
        if (m) {
          floatsRef.current.push({
            id: ev.id, unitId: ev.actorId, text: `+${m[1]}`, color: '#6fe08a', born: performance.now(), big: false,
          });
        }
      } else if (ev.type === 'attack' && ev.actorId && ev.targetId) {
        // 攻击突进
        const units = useBattleStore.getState().units;
        const a = units.find(u => u.id === ev.actorId);
        const t = units.find(u => u.id === ev.targetId);
        if (a && t) {
          const from = posToCell(a.pos), to = posToCell(t.pos);
          const dx = to.cx - from.cx, dy = to.cy - from.cy;
          const len = Math.hypot(dx, dy) || 1;
          lungeRef.current.set(ev.actorId, { dirX: dx / len, dirY: dy / len, born: performance.now() });
          slashesRef.current.push({ id: ev.id, x: to.cx + 0.5, y: to.cy + 0.5, born: performance.now() });
        }
      } else if (ev.type === 'death' && ev.actorId) {
        floatsRef.current.push({
          id: ev.id, unitId: ev.actorId, text: '☠ 死亡', color: '#c9c9c9', born: performance.now(), big: true,
        });
      }
    }
    // 清理
    if (seenEventsRef.current.size > 800) seenEventsRef.current = new Set([...seenEventsRef.current].slice(-400));
  }, [store.events]);

  // ---------- 渲染主循环 ----------
  useEffect(() => {
    let raf = 0;
    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const s = useBattleStore.getState();
      const cam = camRef.current;
      const proj = makeProjector(cam);
      const { w, h } = sizeRef.current;
      const t = time;

      // 背景
      ctx.clearRect(0, 0, w, h);
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#100d09');
      bg.addColorStop(1, '#1a1410');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // ---- 边界 ----
      let minX = 0, minY = 0, maxX = s.mapConfig.width, maxY = s.mapConfig.height;
      for (const u of s.units) {
        const c = posToCell(u.pos);
        minX = Math.min(minX, c.cx); minY = Math.min(minY, c.cy);
        maxX = Math.max(maxX, c.cx + 1); maxY = Math.max(maxY, c.cy + 1);
      }
      for (const o of s.obstacles) {
        for (const c of o.cells) {
          minX = Math.min(minX, c.cx); minY = Math.min(minY, c.cy);
          maxX = Math.max(maxX, c.cx + 1); maxY = Math.max(maxY, c.cy + 1);
        }
      }
      minX -= 2; minY -= 2; maxX += 2; maxY += 2;
      // 反 DoS：地面绘制跨度上限 240 格（恶意/异常坐标不冻结画布；合法地图 ≤ 60×60）
      maxX = Math.min(maxX, minX + 240); maxY = Math.min(maxY, minY + 240);

      // ---- 地面 ----
      for (let cx = minX; cx < maxX; cx++) {
        for (let cy = minY; cy < maxY; cy++) {
          const inBounds = cx >= 0 && cy >= 0 && cx < s.mapConfig.width && cy < s.mapConfig.height;
          drawFloorTile(ctx, proj, cx, cy, inBounds);
        }
      }

      // ---- 移动范围（选中单位） ----
      const selected = s.units.find(u => u.id === s.selectedId);
      const dragUnit = dragRef.current?.kind === 'token' && dragRef.current.unitId
        ? s.units.find(u => u.id === dragRef.current!.unitId)
        : null;
      const rangeUnit = dragUnit ?? (tool === 'select' ? selected : null);
      let moveRange: Map<string, number> | null = null;
      if (rangeUnit && rangeUnit.hp > 0) {
        const mv = remainingMovement(rangeUnit);
        if (mv > 0) moveRange = reachableCells(rangeUnit, s.units, s.obstacles, mv, s.mapConfig.diagonal);
      }
      if (moveRange) {
        for (const k of moveRange.keys()) {
          const [cx, cy] = k.split(',').map(Number);
          drawCellOverlay(ctx, proj, cx, cy, 'rgba(110,190,235,0.16)', 'rgba(110,190,235,0.28)');
        }
      }

      // ---- AoE 模板（已放置） ----
      for (const tpl of s.aoeTemplates) {
        const hit = new Set(aoeCells(tpl, s.units).affectedUnitIds);
        for (const c of aoeCells(tpl, s.units).cells) {
          drawCellOverlay(ctx, proj, c.cx, c.cy, tpl.color, 'rgba(255,170,90,0.4)');
        }
        if (tpl.label) {
          const o = proj.p(tpl.origin.x / CELL, tpl.origin.y / CELL);
          drawLabel(ctx, o.x, o.y, tpl.label, '#ffcf9e', cam.scale, 10);
        }
        hit.forEach(id => {
          const u = s.units.find(x => x.id === id);
          if (!u) return;
          const c = posToCell(u.pos);
          const p = proj.p(c.cx + 0.5, c.cy + 0.5);
          drawRing(ctx, p.x, p.y, 26 * cam.scale, 'rgba(255,120,60,0.8)', t * 0.05, 2.5);
        });
      }

      // ---- AoE 拖拽预览 / 掩体绘制预览 ----
      const d = dragRef.current;
      if (d?.kind === 'aoe' && aoePreset) {
        const o = cellCenter({ cx: d.startX, cy: d.startY });
        const angle = Math.atan2(d.curY - d.startY, d.curX - d.startX) || 0;
        const preview: AoeTemplate = {
          id: 'preview', kind: aoePreset.kind, size: aoePreset.size, origin: o,
          angle: (d.curX === d.startX && d.curY === d.startY) ? 0 : angle,
          color: aoePreset.color, label: aoePreset.label,
        };
        const res = aoeCells(preview, s.units);
        for (const c of res.cells) drawCellOverlay(ctx, proj, c.cx, c.cy, aoePreset.color, 'rgba(255,190,110,0.55)');
        res.affectedUnitIds.forEach(id => {
          const u = s.units.find(x => x.id === id);
          if (!u) return;
          const c = posToCell(u.pos);
          const p = proj.p(c.cx + 0.5, c.cy + 0.5);
          drawRing(ctx, p.x, p.y, 26 * cam.scale, '#ffb060', t * 0.05, 2.5);
        });
        drawLabel(ctx, proj.p(d.startX + 0.5, d.startY + 0.5).x, proj.p(d.startX + 0.5, d.startY + 0.5).y - 30, aoePreset.label, '#ffcf9e', cam.scale, 11);
      }
      if (d?.kind === 'obstacle' && d.obstacleCells) {
        for (const c of d.obstacleCells) {
          drawCellOverlay(ctx, proj, c.cx, c.cy, 'rgba(160,160,170,0.4)', 'rgba(200,200,210,0.7)');
        }
      }

      // ---- 轨迹（上一快照 diff） ----
      if (s.lastDiff) {
        for (const df of s.lastDiff.unitDiffs) {
          if (!df.posDelta) continue;
          const u = s.units.find(x => x.id === df.id);
          if (!u) continue;
          const fromC = posToCell({ x: u.pos.x - df.posDelta.x, y: u.pos.y - df.posDelta.y });
          const toC = posToCell(u.pos);
          ctx.save();
          ctx.strokeStyle = 'rgba(230,210,160,0.5)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          const p1 = proj.p(fromC.cx + 0.5, fromC.cy + 0.5);
          const p2 = proj.p(toC.cx + 0.5, toC.cy + 0.5);
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      // ---- 物体深度排序（掩体立方体 + 单位 token） ----
      interface DrawObj { depth: number; draw: () => void }
      const objs: DrawObj[] = [];

      for (const o of s.obstacles) {
        for (const c of o.cells) {
          objs.push({
            depth: c.cx + c.cy - 0.1,
            draw: () => drawCube(ctx, proj, c.cx, c.cy, o.kind),
          });
        }
      }

      const seenPos = new Set<string>();
      const hitsThisFrame: Array<{ id: string; sx: number; sy: number; r: number }> = [];
      for (const u of s.units) {
        const cell = posToCell(u.pos);
        const span = SIZE_META[u.size]?.cells ?? 1;
        // 动画位置插值（lerp 平滑移动）
        const target = { x: u.pos.x, y: u.pos.y };
        const prev = animPosRef.current.get(u.id);
        if (!prev) {
          animPosRef.current.set(u.id, { ...target });
        } else {
          prev.x += (target.x - prev.x) * 0.22;
          prev.y += (target.y - prev.y) * 0.22;
          if (Math.abs(target.x - prev.x) < 0.6 && Math.abs(target.y - prev.y) < 0.6) { prev.x = target.x; prev.y = target.y; }
        }
        seenPos.add(u.id);
        const anim = animPosRef.current.get(u.id)!;
        const aCellF = { x: anim.x / CELL, y: anim.y / CELL };
        const centerG = { x: aCellF.x + span / 2, y: aCellF.y + span / 2 };
        const isDead = !!u.deathSaves?.dead;
        const isDown = u.hp <= 0 && !isDead;
        const isEnemy = u.attitude === 2;

        objs.push({
          depth: centerG.x + centerG.y,
          draw: () => {
            const cp = proj.p(centerG.x, centerG.y);
            const groundY = cp.y + span * 2 * cam.scale;
            // 命中区域（拾取用）
            const tokenR = isEnemy ? span * 24 * cam.scale : (12 + span * 7.5) * cam.scale;
            hitsThisFrame.push({ id: u.id, sx: cp.x, sy: groundY - tokenR * 0.8, r: tokenR * 1.15 });
            const lunge = lungeRef.current.get(u.id);
            let ox = 0, oy = 0;
            if (lunge && t - lunge.born < 260) {
              const prog = Math.sin(Math.PI * (t - lunge.born) / 260);
              ox = lunge.dirX * 12 * cam.scale * prog;
              oy = lunge.dirY * 6 * cam.scale * prog;
            }
            const bob = isDead || isDown ? 0 : Math.sin(t * 0.0035 + strHash(u.id) % 10) * 2.6 * cam.scale;

            // 光环：当前行动者（金色脉冲）/ 选中（青色虚线）
            if (s.turn.currentUnitId === u.id && s.battleActive) {
              const pulse = 0.55 + 0.35 * Math.sin(t * 0.006);
              drawRing(ctx, cp.x, groundY, (span * 26 + 6) * cam.scale, `rgba(245,197,66,${pulse})`, t * 0.04, 3);
            }
            if (s.selectedId === u.id) {
              drawRing(ctx, cp.x, groundY, (span * 24 + 4) * cam.scale, 'rgba(90,200,250,0.9)', -t * 0.05, 2);
            }

            const alpha = isDead ? 0.22 : isDown ? 0.75 : 1;
            const squash = isDown ? 0.45 : 1;

            if (isEnemy) {
              const ex = span * 24 * cam.scale * 0.92;
              const ey = span * 12 * cam.scale * 0.92;
              drawShadow(ctx, cp.x, groundY, ex * 0.95, isDead ? 0.15 : 0.3);
              drawPyramid(ctx, {
                x: cp.x + ox, groundY: groundY + oy,
                baseRx: ex, baseRy: ey,
                height: span * 26 * cam.scale + bob,
                alpha, squash,
                hi: isDead ? '#8a8886' : '#e05a4a',
                lo: isDead ? '#5f5d5b' : '#9c2418',
              });
            } else {
              const r = (12 + span * 7.5) * cam.scale;
              drawShadow(ctx, cp.x, groundY, r * 0.95, isDead ? 0.15 : 0.32);
              // 玩家金环
              if (u.isPlayer && !isDead) {
                drawRing(ctx, cp.x, groundY, r * 1.15, 'rgba(245,197,66,0.95)', t * 0.03, 2.5);
              }
              drawSphere(ctx, {
                x: cp.x + ox,
                y: groundY - r * 0.85 - bob + oy,
                radius: r,
                colors: u.attitude === 1 ? NEUTRAL_COLORS : ALLY_COLORS,
                alpha, squash,
              });
              if (isDown) {
                drawLabel(ctx, cp.x, groundY - r * 0.5, '✚', '#ff6b6b', cam.scale, 14);
              }
            }

            // 死亡不再画 UI 元件
            if (isDead) return;

            // 名字（含操控标记）
            const topY = isEnemy
              ? groundY - (span * 26 * cam.scale + bob) - 6
              : groundY - (12 + span * 7.5) * cam.scale * 1.85 - bob - 6;
            const controlTag = u.attitude === 0 && !u.isPlayer ? (u.playerControlled ? ' 👤' : ' 🤖') : '';
            const nameColor = u.isPlayer ? '#f5c542' : u.attitude === 2 ? '#ff8a75' : u.attitude === 1 ? '#e3ba55' : '#7fe0a0';
            drawLabel(ctx, cp.x, topY - 34 * cam.scale, `${u.isPlayer ? '★' : ''}${u.name}${controlTag}`, nameColor, cam.scale, Math.max(9, 10.5));

            // HP 条
            const ratio = u.maxHp > 0 ? Math.max(0, u.hp) / u.maxHp : 0;
            const barW = Math.max(30, Math.min(64, 26 + span * 12)) * cam.scale;
            const showText = s.selectedId === u.id || s.turn.currentUnitId === u.id || hoverInfo?.unitId === u.id;
            drawHpBar(ctx, cp.x, topY - 22 * cam.scale, barW, 5 * cam.scale, ratio, cam.scale,
              showText ? `${Math.max(0, u.hp)}/${u.maxHp}` : undefined);

            // 状态图标
            const icons = u.statuses.filter(st => st !== 'disengaging').slice(0, 4);
            if (icons.length > 0) {
              const iw = 13 * cam.scale;
              const startX = cp.x - (icons.length - 1) * iw / 2;
              ctx.font = `${10 * cam.scale}px "Noto Sans SC", system-ui, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              icons.forEach((st, i) => {
                const def = CONDITIONS[st];
                ctx.strokeStyle = 'rgba(0,0,0,0.8)';
                ctx.lineWidth = 3;
                const ix = startX + i * iw;
                const iy = topY - 40 * cam.scale;
                ctx.strokeText(def?.icon ?? '❓', ix, iy);
                ctx.fillStyle = def?.color ?? '#aaa';
                ctx.fillText(def?.icon ?? '❓', ix, iy);
              });
            }
          },
        });
      }
      // 清理已移除单位
      for (const id of [...animPosRef.current.keys()]) {
        if (!seenPos.has(id)) animPosRef.current.delete(id);
      }

      objs.sort((a, b) => a.depth - b.depth);
      for (const o of objs) o.draw();
      tokenHitsRef.current = hitsThisFrame;

      // ---- 拖拽 token 幽灵与成本 ----
      if (dragRef.current?.kind === 'token' && dragUnit) {
        const dd = dragRef.current;
        const cost = gridDistanceCells({ cx: dd.startX, cy: dd.startY }, { cx: dd.curX, cy: dd.curY }, s.mapConfig.diagonal) * CELL;
        const max = remainingMovement(dragUnit);
        const valid = cost <= max;
        const p = proj.p(dd.curX + 0.5, dd.curY + 0.5);
        // 路径箭头
        const p0 = proj.p(dd.startX + 0.5, dd.startY + 0.5);
        ctx.save();
        ctx.strokeStyle = valid ? 'rgba(120,220,255,0.9)' : 'rgba(255,110,110,0.9)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
        drawBadge(ctx, p.x, p.y - 18, `移动 ${cost}尺 / 剩余 ${max}尺`, valid ? 'rgba(30,90,120,0.92)' : 'rgba(140,40,40,0.92)', cam.scale);
      }

      // ---- 测距 ----
      if (dragRef.current?.kind === 'measure') {
        const dd = dragRef.current;
        const dist = gridDistanceCells({ cx: dd.startX, cy: dd.startY }, { cx: dd.curX, cy: dd.curY }, s.mapConfig.diagonal) * CELL;
        const p0 = proj.p(dd.startX + 0.5, dd.startY + 0.5);
        const p1 = proj.p(dd.curX + 0.5, dd.curY + 0.5);
        ctx.save();
        ctx.strokeStyle = 'rgba(240,220,160,0.95)';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
        // 端点
        for (const pp of [p0, p1]) {
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#f0dca0';
          ctx.fill();
        }
        ctx.restore();
        drawBadge(ctx, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2 - 16, `${dist} 尺（${dist / CELL} 格）`, 'rgba(60,50,20,0.92)', cam.scale);
      }

      // ---- 特效层 ----
      const now = t;
      slashesRef.current = slashesRef.current.filter(sl => now - sl.born < 320);
      for (const sl of slashesRef.current) {
        const p = proj.p(sl.x, sl.y);
        drawSlash(ctx, p.x, p.y - 14 * cam.scale, (now - sl.born) / 320);
      }
      floatsRef.current = floatsRef.current.filter(f => now - f.born < 1500);
      for (const f of floatsRef.current) {
        const u = s.units.find(x => x.id === f.unitId);
        if (!u) continue;
        const prev = animPosRef.current.get(u.id) ?? u.pos;
        const span = SIZE_META[u.size]?.cells ?? 1;
        const p = proj.p(prev.x / CELL + span / 2, prev.y / CELL + span / 2);
        drawFloatText(ctx, p.x, p.y - 42 * cam.scale, f.text, f.color, (now - f.born) / 1500, f.big);
      }

      // ---- 悬停提示（记录命中区域） ----
      void hoverInfo;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [tool, aoePreset, hoverInfo]);

  // ---------- 指针交互 ----------
  const pickCell = (clientX: number, clientY: number): Cell => {
    const canvas = canvasRef.current;
    if (!canvas) return { cx: 0, cy: 0 };
    const rect = canvas.getBoundingClientRect();
    const proj = makeProjector(camRef.current);
    const g = proj.unproject(clientX - rect.left, clientY - rect.top);
    return { cx: Math.floor(g.gx), cy: Math.floor(g.gy) };
  };

  const pickToken = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left, sy = clientY - rect.top;
    let best: { id: string; dist: number } | null = null;
    for (const hit of tokenHitsRef.current) {
      const dist = Math.hypot(hit.sx - sx, hit.sy - sy);
      if (dist < hit.r * 1.35 && (!best || dist < best.dist)) best = { id: hit.id, dist };
    }
    return best?.id ?? null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const cell = pickCell(e.clientX, e.clientY);
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const sx = e.clientX - (rect?.left ?? 0);
    const sy = e.clientY - (rect?.top ?? 0);

    if (tool === 'measure') {
      setDragBoth({ kind: 'measure', startX: cell.cx, startY: cell.cy, curX: cell.cx, curY: cell.cy, lastScreenX: sx, lastScreenY: sy, screenStartX: sx, screenStartY: sy, moved: false });
      return;
    }
    if (tool === 'aoe') {
      if (!aoePreset) return;
      setDragBoth({ kind: 'aoe', startX: cell.cx, startY: cell.cy, curX: cell.cx, curY: cell.cy, lastScreenX: sx, lastScreenY: sy, screenStartX: sx, screenStartY: sy, moved: false });
      return;
    }
    if (tool === 'obstacle') {
      setDragBoth({ kind: 'obstacle', startX: cell.cx, startY: cell.cy, curX: cell.cx, curY: cell.cy, lastScreenX: sx, lastScreenY: sy, screenStartX: sx, screenStartY: sy, moved: false, obstacleCells: [cell] });
      return;
    }
    // select 工具
    const tokenId = e.button === 0 ? pickToken(e.clientX, e.clientY) : null;
    if (e.button === 0 && tokenId) {
      store.setSelectedId(tokenId);
      setDragBoth({ kind: 'token', unitId: tokenId, startX: cell.cx, startY: cell.cy, curX: cell.cx, curY: cell.cy, lastScreenX: sx, lastScreenY: sy, screenStartX: sx, screenStartY: sy, moved: false });
      return;
    }
    // 背景：平移（点击=取消选中）
    setDragBoth({ kind: 'pan', startX: cell.cx, startY: cell.cy, curX: e.clientX, curY: e.clientY, lastScreenX: e.clientX, lastScreenY: e.clientY, screenStartX: e.clientX, screenStartY: e.clientY, moved: false });
  };

  const paintLine = (a: Cell, b: Cell): Cell[] => {
    const cells: Cell[] = [];
    const steps = Math.max(Math.abs(b.cx - a.cx), Math.abs(b.cy - a.cy));
    for (let i = 0; i <= steps; i++) {
      cells.push({
        cx: a.cx + Math.round((b.cx - a.cx) * i / Math.max(1, steps)),
        cy: a.cy + Math.round((b.cy - a.cy) * i / Math.max(1, steps)),
      });
    }
    return cells;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const cell = pickCell(e.clientX, e.clientY);
    const d = dragRef.current;
    if (!d) {
      // 悬停单位提示
      const tokenId = tool === 'select' ? pickToken(e.clientX, e.clientY) : null;
      if (tokenId !== (hoverInfo?.unitId ?? null)) {
        if (tokenId) {
          const canvas = canvasRef.current;
          const rect = canvas?.getBoundingClientRect();
          setHoverInfo({ unitId: tokenId, sx: e.clientX - (rect?.left ?? 0), sy: e.clientY - (rect?.top ?? 0) });
        } else {
          setHoverInfo(null);
        }
      }
      return;
    }
    if (d.kind === 'pan') {
      if (Math.hypot(e.clientX - d.screenStartX, e.clientY - d.screenStartY) > 4) d.moved = true;
      if (d.moved) {
        camRef.current.panX += e.clientX - d.lastScreenX;
        camRef.current.panY += e.clientY - d.lastScreenY;
      }
      setDragBoth({ ...d, curX: e.clientX, curY: e.clientY, lastScreenX: e.clientX, lastScreenY: e.clientY, moved: d.moved });
      return;
    }
    setDragBoth({
      ...d,
      curX: cell.cx, curY: cell.cy,
      moved: d.moved || cell.cx !== d.startX || cell.cy !== d.startY,
      obstacleCells: d.kind === 'obstacle' ? paintLine({ cx: d.startX, cy: d.startY }, cell) : d.obstacleCells,
    });
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    if (!d) return;
    const s = useBattleStore.getState();
    if (d.kind === 'token' && d.unitId) {
      const unit = s.units.find(u => u.id === d.unitId);
      if (unit && (d.curX !== d.startX || d.curY !== d.startY)) {
        const occupied = new Set(s.units.filter(u => u.id !== unit.id).flatMap(u => unitOccupiedCells(u).map(cellKey)));
        const span = SIZE_META[unit.size].cells;
        let blocked = false;
        for (let i = 0; i < span; i++) {
          for (let j = 0; j < span; j++) {
            if (occupied.has(cellKey({ cx: d.curX + i, cy: d.curY + j }))) blocked = true;
          }
        }
        if (!blocked) {
          s.moveUnit(unit.id, { x: cellToFeet(d.curX), y: cellToFeet(d.curY) });
        }
      }
    } else if (d.kind === 'aoe' && aoePreset && d.moved) {
      const o = cellCenter({ cx: d.startX, cy: d.startY });
      const angle = (d.curX === d.startX && d.curY === d.startY) ? 0 : Math.atan2(d.curY - d.startY, d.curX - d.startX);
      s.addAoeTemplate({ kind: aoePreset.kind, size: aoePreset.size, origin: o, angle, color: aoePreset.color, label: aoePreset.label });
    } else if (d.kind === 'obstacle' && d.obstacleCells && d.obstacleCells.length > 0) {
      s.addObstacle(d.obstacleCells, obstacleKind);
    } else if (d.kind === 'pan' && !d.moved) {
      // 点击空白：取消选中
      s.setSelectedId(null);
      setHoverInfo(null);
    }
    setDragBoth(null);
  };

  // 滚轮缩放（非被动监听）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const cam = camRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const ns = Math.min(2.2, Math.max(0.25, cam.scale * factor));
      const k = ns / cam.scale;
      cam.panX = sx - (sx - cam.panX) * k;
      cam.panY = sy - (sy - cam.panY) * k;
      cam.scale = ns;
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const zoomAt = (factor: number) => {
    const cam = camRef.current;
    const { w, h } = sizeRef.current;
    const ns = Math.min(2.2, Math.max(0.25, cam.scale * factor));
    const k = ns / cam.scale;
    cam.panX = w / 2 - (w / 2 - cam.panX) * k;
    cam.panY = h / 2 - (h / 2 - cam.panY) * k;
    cam.scale = ns;
  };

  // 悬停单位信息
  const hoverUnit = hoverInfo ? store.units.find(u => u.id === hoverInfo.unitId) : null;

  const tools = [
    { key: 'select' as Tool, icon: MousePointer2, label: '选择/拖拽' },
    { key: 'measure' as Tool, icon: Ruler, label: '测距' },
    { key: 'aoe' as Tool, icon: Flame, label: 'AoE 模板' },
    { key: 'obstacle' as Tool, icon: BrickWall, label: '绘制掩体' },
  ];

  const selectedUnit = store.selectedId ? store.units.find(u => u.id === store.selectedId) : null;
  const dragUnitInfo = drag?.kind === 'token' ? store.units.find(u => u.id === drag.unitId) : null;
  const rangeHint = selectedUnit ? `已选 ${selectedUnit.name}` : null;

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden rounded-xl parchment-panel', compact ? 'h-[340px] md:h-[400px]' : 'h-[480px] md:h-[600px]')}
    >
      <canvas
        ref={canvasRef}
        className={cn('absolute inset-0 h-full w-full touch-none select-none', tool === 'select' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* 顶部工具栏 */}
      <div className="absolute top-2 left-2 right-2 z-20 flex flex-wrap items-center gap-1.5">
        {tools.map(tItem => (
          <Button
            key={tItem.key}
            size="sm"
            variant={tool === tItem.key ? 'default' : 'secondary'}
            className={cn('h-8 gap-1 px-2 text-xs', tool === tItem.key && 'bg-primary text-primary-foreground')}
            onClick={() => { setTool(tItem.key); if (tItem.key !== 'aoe') setAoePreset(null); }}
            title={tItem.label}
          >
            <tItem.icon className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{tItem.label}</span>
          </Button>
        ))}
        <div className="grow" />
        {rangeHint && (
          <span className="rounded-md border border-sky-400/30 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-200">
            {rangeHint}
          </span>
        )}
        <Button size="sm" variant="secondary" className="h-8 w-8 p-0" onClick={() => zoomAt(1.25)} title="放大"><ZoomIn className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="secondary" className="h-8 w-8 p-0" onClick={() => zoomAt(0.8)} title="缩小"><ZoomOut className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="secondary" className="h-8 w-8 p-0" onClick={fitView} title="适配视野"><Maximize className="h-3.5 w-3.5" /></Button>
      </div>

      {/* AoE 预设选择条 */}
      {tool === 'aoe' && (
        <div className="absolute top-12 left-2 right-2 z-20 flex flex-wrap gap-1 rounded-lg bg-black/60 p-1.5 backdrop-blur">
          {AOE_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => setAoePreset(p)}
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] leading-tight transition-colors',
                aoePreset?.label === p.label
                  ? 'border-primary bg-primary/90 text-primary-foreground'
                  : 'border-transparent text-foreground/80 hover:bg-white/10',
              )}
              title={p.note}
            >
              {p.label}
            </button>
          ))}
          <div className="grow" />
          <button onClick={() => store.clearAoeTemplates()} className="rounded-md px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/20" title="清除全部模板">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 掩体类型选择 */}
      {tool === 'obstacle' && (
        <div className="absolute top-12 left-2 z-20 flex gap-1 rounded-lg bg-black/60 p-1.5 backdrop-blur">
          {([['full', '完全掩体（墙）'], ['threeQuarters', '3/4 掩体(+5)'], ['half', '半身掩体(+2)']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setObstacleKind(k)}
              className={cn('rounded-md px-2 py-1 text-[11px]', obstacleKind === k ? 'bg-primary/90 text-primary-foreground' : 'text-foreground/80 hover:bg-white/10')}
            >
              {label}
            </button>
          ))}
          <button onClick={() => store.clearObstacles()} className="rounded-md px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/20">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 悬停单位提示卡 */}
      {hoverUnit && (
        <div
          className="pointer-events-none absolute z-30 w-44 rounded-lg border border-border/60 bg-black/85 p-2 text-[11px] leading-relaxed text-foreground/90 shadow-xl backdrop-blur"
          style={{ left: Math.min(Math.max(8, (hoverInfo?.sx ?? 0) + 14), Math.max(8, size.w - 190)), top: Math.min((hoverInfo?.sy ?? 0) - 10, Math.max(8, size.h - 120)) }}
        >
          <div className="mb-0.5 font-bold" style={{ color: hoverUnit.isPlayer ? '#f5c542' : hoverUnit.attitude === 2 ? '#ff8a75' : '#7fe0a0' }}>
            {hoverUnit.isPlayer ? '★' : ''}{hoverUnit.name}
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>HP {Math.max(0, hoverUnit.hp)}/{hoverUnit.maxHp}</span>
            <span>AC {hoverUnit.ac}</span>
          </div>
          {hoverUnit.statuses.length > 0 && (
            <div className="mt-0.5 text-amber-200/80">
              {hoverUnit.statuses.map(st => CONDITIONS[st]?.name ?? st).join('·')}
            </div>
          )}
        </div>
      )}

      {/* 拖拽中单位名 */}
      {dragUnitInfo && drag?.kind === 'token' && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded-md border border-border/50 bg-black/70 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
          拖拽 <span className="font-bold text-foreground">{dragUnitInfo.name}</span> —— 松手落位（移动超出上限会有红色警告，借机攻击将自动结算）
        </div>
      )}

      {/* 图例 */}
      <div className="pointer-events-none absolute bottom-2 right-2 z-10 hidden items-center gap-2.5 rounded-md bg-black/45 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur md:flex">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: 'radial-gradient(circle at 35% 30%, #b8f7c6, #3ecf6a 55%, #0c5e2c)' }} />友方</span>
        <span className="flex items-center gap-1">
          <svg width="12" height="10" viewBox="0 0 12 10"><polygon points="0,9 6,0 12,9 6,7" fill="#c33a2b" /></svg>
          敌方
        </span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: 'linear-gradient(135deg,#8d949e 40%,#565b63)' }} />掩体</span>
        <span className="text-primary/60">👤玩家操控 · 🤖AI托管</span>
      </div>
    </div>
  );
}
