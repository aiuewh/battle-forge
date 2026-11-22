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
import { useActionUiStore } from '@/store/actionUiStore';
import { hudCandidates, hudTargetReason } from '@/lib/engine/hudTargets';
import { abilityPreview, abilityTargetCheck, movementPreview } from '@/lib/engine/actionPreview';
import {
  CELL, posToCell, cellToFeet, cellCenter, cellKey, unitOccupiedCells,
  reachableCells, gridDistanceCells, aoeCells,
  AOE_PRESETS,
} from '@/lib/engine/geometry';
import type { AoeTemplate, MapObstacle, Cell } from '@/lib/engine/types';
import { SIZE_META } from '@/lib/engine/types';
import { CONDITIONS } from '@/lib/engine/conditions';
import { remainingMovement } from '@/lib/engine/rules';
import { EMBLEM_ASSETS } from '@/lib/engine/emblemAssets';
import { resolveCreatureKind } from '@/lib/engine/creatures';
import { getIconStage, resolveIconKind } from './emblem3d/stage';
import {
  makeProjector, strHash, drawFloorTile, drawCellOverlay, drawCube, drawShadow,
  drawSphere, drawPyramid, drawLabel, drawRing, STAGE_PALETTE,
  drawFloorGrit, drawStageGlow, drawStageVignette, drawFloorLightSweep, drawAbyss, drawTerrainDetail, drawSlabWall,
  plateLayout, drawNameplate, type NameplateInfo,
  drawSlash, drawFloatText, drawBadge, drawSpotlight, TILE_W, TILE_H,
  type IsoCam,
} from './iso/isoScene';
import { TokenQuickMenu } from './TokenQuickMenu';
import { Button } from '@/components/ui/button';
import { HudMenu } from './HudMenu';
import { cn } from '@/lib/utils';
import {
  MousePointer2, Ruler, Flame, BrickWall, Trash2, ZoomIn, ZoomOut, Maximize,
} from 'lucide-react';

type Tool = 'select' | 'measure' | 'aoe' | 'obstacle';

/** 敌方徽章开关：true = 3D 图标徽章（按族类/名字映射）；false = 回退最初版红四棱锥。友方恒为绿球 */
const USE_ICON_BADGES = true;

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

export function BattleMapIso({ compact = false, workspace = false, boundary, onInspect }: { compact?: boolean; workspace?: boolean; boundary?: HTMLElement | null; onInspect?: (id: string) => void }) {
  const store = useBattleStore();
  const actionUi = useActionUiStore();
  const [hoverCell, setHoverCell] = useState<Cell | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{ id: string; cell: Cell; epoch: number } | null>(null);
  const moveUnit = store.units.find(u => u.id === store.selectedId);
  const moveView = moveUnit && hoverCell && !actionUi.request && (!workspace || actionUi.movingActorId === moveUnit.id) ? movementPreview(moveUnit, hoverCell, store.units, store.obstacles, store.mapConfig, store.battleActive, store.turn.currentUnitId) : null;
  const confirmation = moveConfirm && moveConfirm.epoch === store.interactionEpoch && moveConfirm.id === store.selectedId && !actionUi.request ? moveConfirm : null;
  const requestMove = (id: string, cell: Cell, confirmed = false) => {
    const s = useBattleStore.getState();
    const unit = s.units.find(u => u.id === id);
    if (!unit || s.readOnly || s.pendingReactionStep) return;
    const p = movementPreview(unit, cell, s.units, s.obstacles, s.mapConfig, s.battleActive, s.turn.currentUnitId);
    if (p.reason) { actionUi.fail(p.reason); return; }
    if (p.threats.length && !confirmed) { setMoveConfirm({ id, cell, epoch: s.interactionEpoch }); return; }
    if (s.requestPlayerMove(id, cell)) { setMoveConfirm(null); actionUi.fail(null); }
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [toolChoice, setTool] = useState<Tool>('select');
  const tool: Tool = actionUi.request || actionUi.movingActorId ? 'select' : toolChoice;
  const [toolsOpen, setToolsOpen] = useState(false);
  const [aoePreset, setAoePreset] = useState<(typeof AOE_PRESETS)[number] | null>(null);
  const [obstacleKind, setObstacleKind] = useState<MapObstacle['kind']>('full');
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ unitId: string; sx: number; sy: number } | null>(null);
  const [quickMenu, setQuickMenu] = useState<{ unitId: string; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });

  // 渲染循环内部状态（不走 React，避免高频 setState）
  const camRef = useRef<IsoCam>({ scale: 0.9, panX: 0, panY: 0 });
  const sizeRef = useRef({ w: 800, h: 500 });
  const hoverCellRef = useRef<Cell | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const tokenHitsRef = useRef<Array<{ id: string; sx: number; sy: number; r: number }>>([]);
  const animPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const lungeRef = useRef<Map<string, LungeState>>(new Map());
  const floatsRef = useRef<FloatEffect[]>([]);
  const slashesRef = useRef<SlashEffect[]>([]);
  const seenEventsRef = useRef<Set<string>>(new Set());
  const invalidateRef = useRef<() => void>(() => {});
  const visibleRef = useRef(true);
  const fittedRef = useRef('');

  useEffect(() => useActionUiStore.subscribe(selection => {
    if (selection.request || selection.movingActorId) {
      setTool('select'); setAoePreset(null); setToolsOpen(false);
    }
  }), []);

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
      invalidateRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------- 视野适配 ----------
  const fitView = useCallback(() => {
    const s = useBattleStore.getState();
    const { units, obstacles, mapConfig } = s;
    let minX = units.length ? Infinity : 0, minY = units.length ? Infinity : 0;
    let maxX = units.length ? -Infinity : mapConfig.width, maxY = units.length ? -Infinity : mapConfig.height;
    for (const u of units) {
      const c = posToCell(u.pos);
      minX = Math.min(minX, c.cx); minY = Math.min(minY, c.cy);
      const span = SIZE_META[u.size]?.cells ?? 1;
      maxX = Math.max(maxX, c.cx + span); maxY = Math.max(maxY, c.cy + span);
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
    const hudHeight = boundary?.querySelector('.token-hud')?.getBoundingClientRect().height ?? 180;
    const topInset = workspace ? 150 : 0;
    const usableH = workspace ? Math.max(130, h - hudHeight - topInset - 30) : h;
    const scale = Math.min(1.5, Math.max(0.28, Math.min(w / bboxW, usableH / bboxH) * 0.94));
    camRef.current = {
      scale,
      panX: w / 2 - (leftX + rightX) / 2 * scale,
      panY: topInset + usableH / 2 - (topY + bottomY) / 2 * scale + 20 * scale,
    };
    invalidateRef.current();
  }, [workspace, boundary]);

  // 单位数变化时自动适配（首次载入/演示）
  useEffect(() => {
    const s = useBattleStore.getState();
    const sig = `${s.units.length}:${s.mapConfig.width}x${s.mapConfig.height}:${Math.round(size.w)}x${Math.round(size.h)}`;
    if (s.units.length > 0 && fittedRef.current !== sig) {
      fittedRef.current = sig;
      // 等画布尺寸就绪
      requestAnimationFrame(() => fitView());
    }
    if (s.units.length === 0) fittedRef.current = '';
  }, [store.units.length, store.mapConfig.width, store.mapConfig.height, size.w, size.h, fitView]);

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
    let disposed = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wake = () => { if (!disposed && !raf && !document.hidden) raf = requestAnimationFrame(draw); };
    const draw = (time: number) => {
      raf = 0;
      if (disposed || document.hidden) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const s = useBattleStore.getState();
      const cam = camRef.current;
      const proj = makeProjector(cam);
      const { w, h } = sizeRef.current;
      const t = time;
      let animating = false;
      canvas.dataset.renderCount = String(Number(canvas.dataset.renderCount ?? 0) + 1);
      const labelRects: Array<{x:number;y:number;w:number;h:number}> = [];
      const placeLabel = (x:number,y:number,w:number,h:number) => {
        const minY = workspace ? 125 + h / 2 : h / 2;
        let ly = Math.max(minY, y);
        for (let attempt=0; attempt<7 && labelRects.some(r => Math.abs(x-r.x)<(w+r.w)/2 && Math.abs(ly-r.y)<(h+r.h)/2); attempt++) {
          const above = y - (attempt + 1) * (h + 4);
          ly = above >= minY ? above : Math.max(minY, y) + (attempt + 1) * (h + 4);
        }
        labelRects.push({x,y:ly,w,h}); return ly;
      };

      // 背景
      ctx.clearRect(0, 0, w, h);
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, STAGE_PALETTE.bgTop);
      bg.addColorStop(1, STAGE_PALETTE.bgBottom);
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

      // ---- 环境层⑤⑥（必须在地面之前，否则会盖住地图）----
      // ⑤ 边界外深渊：让地图"浮"在黑暗中而不是贴黑布
      drawAbyss(ctx, proj, s.mapConfig.width, s.mapConfig.height, w, h);
      // ⑥ 台面厚度：沿南/东两条前边画出地基侧壁 —— 平面贴图 → 立体石台的转折点
      drawSlabWall(ctx, proj, s.mapConfig.width, s.mapConfig.height, Math.max(10, 22 * cam.scale));

      // ---- 地面 ----
      // 性能：逐格 drawFloorTile 在大地图上是主要开销（30×30 = 900 次/帧）。
      // 缩小到格子不足 3px 时视觉上已是纯色，跳过细格只画底色块。
      const cellPx = TILE_W * cam.scale;
      const detailFloor = cellPx >= 3;
      if (!detailFloor) {
        // 粗画：按 2 格步进，边界内外用同色即可（缩小时分辨不出）
        for (let cx = minX; cx < maxX; cx += 2) {
          for (let cy = minY; cy < maxY; cy += 2) {
            const inBounds = cx >= 0 && cy >= 0 && cx < s.mapConfig.width && cy < s.mapConfig.height;
            drawFloorTile(ctx, proj, cx, cy, inBounds);
          }
        }
      } else {
        // 环境层②：地面颗粒。只在地图内、且格子够大时才画（缩小后是噪点噪声）
        const drawGrit = cellPx >= 22;
        for (let cx = minX; cx < maxX; cx++) {
          for (let cy = minY; cy < maxY; cy++) {
            const inBounds = cx >= 0 && cy >= 0 && cx < s.mapConfig.width && cy < s.mapConfig.height;
            drawFloorTile(ctx, proj, cx, cy, inBounds);
            if (drawGrit && inBounds) {
              drawFloorGrit(ctx, proj, cx, cy, 7);
              // 地形装饰：碎石/裂纹/苔痕/接缝，让地面有信息密度
              drawTerrainDetail(ctx, proj, cx, cy, 7);
            }
          }
        }
      }

      // ---- 战场边界（金线收边 + 外圈压暗） ----
      {
        const cN = proj.p(0, 0), cE = proj.p(s.mapConfig.width, 0);
        const cS = proj.p(s.mapConfig.width, s.mapConfig.height), cW = proj.p(0, s.mapConfig.height);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cN.x, cN.y); ctx.lineTo(cE.x, cE.y); ctx.lineTo(cS.x, cS.y); ctx.lineTo(cW.x, cW.y);
        ctx.closePath();
        ctx.lineJoin = 'round';
        ctx.strokeStyle = STAGE_PALETTE.boundaryEdge;
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = STAGE_PALETTE.boundaryLine;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();
      }

      // ---- 环境层（2026-11-23）----
      // ④ 斜向光照带：纯色棋盘格最大的问题是平坦，一条带方向的亮度梯度能救回体积感
      drawFloorLightSweep(ctx, proj, s.mapConfig.width, s.mapConfig.height);
      // ① 战场光晕：中心暖光衰减，把视线拉到战场中央（在网格之上、单位之下）
      // ③ 边界晕影：四边压暗收拢视线。用 canvas 尺寸而非地图 bbox，
      //    这样地图很小（8x8）时画面四周也不会空得像贴纸。
      drawStageGlow(ctx, w, h);
      drawStageVignette(ctx, w, h, 0.85);

      // ---- 移动范围（选中单位） ----
      const selected = s.units.find(u => u.id === s.selectedId);
      const dragUnit = dragRef.current?.kind === 'token' && dragRef.current.unitId
        ? s.units.find(u => u.id === dragRef.current!.unitId)
        : null;
      const rangeUnit = dragUnit ?? (tool === 'select' && (!workspace || useActionUiStore.getState().movingActorId === selected?.id) ? selected : null);
      let moveRange: Map<string, number> | null = null;
      if (rangeUnit && rangeUnit.hp > 0) {
        const mv = remainingMovement(rangeUnit);
        if (mv > 0) moveRange = reachableCells(rangeUnit, s.units, s.obstacles, mv, s.mapConfig.diagonal, {
          mapWidth: s.mapConfig.width, mapHeight: s.mapConfig.height, ignoreFullObstacles: rangeUnit.moveMode === 'fly',
        });
      }
      if (moveRange) {
        for (const k of moveRange.keys()) {
          const [cx, cy] = k.split(',').map(Number);
          const hoveredCell = hoverCellRef.current;
          const hovered = hoveredCell?.cx === cx && hoveredCell?.cy === cy;
          drawCellOverlay(ctx, proj, cx, cy,
            hovered ? STAGE_PALETTE.rangeFillHover : STAGE_PALETTE.rangeFill, STAGE_PALETTE.rangeStroke);
        }
      }

      // ---- AoE 模板（已放置） ----
      for (const tpl of s.aoeTemplates) {
        const aoe = aoeCells(tpl, s.units);
        const hit = new Set(aoe.affectedUnitIds);
        for (const c of aoe.cells) {
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

      const action = useActionUiStore.getState();
      const actionActor = action.request ? s.units.find(u => u.id === action.request!.actorId) : null;
      if (action.request && actionActor) {
        const ab = action.request.ability;
        const candidateIds = new Set(hudCandidates(action.request, actionActor, s.units).map(u => u.id));
        for (const u of s.units) {
          if (!candidateIds.has(u.id)) continue;
          const reason = hudTargetReason(action.request, actionActor, u, s.units, s.obstacles, s.mapConfig.diagonal);
          for (const c of unitOccupiedCells(u)) drawCellOverlay(ctx, proj, c.cx, c.cy,
            u.id === action.targetId ? 'rgba(255,210,80,.60)' : reason ? 'rgba(180,50,50,.18)' : 'rgba(70,200,130,.38)');
        }
        const preview = abilityPreview(actionActor, ab, s.units.find(u => u.id === action.targetId), s.units, s.obstacles, s.mapConfig.diagonal,
          { ...action.request, originPos: action.originPos, angle: action.angle });
        if (preview.template) {
          for (const c of aoeCells(preview.template, s.units).cells) drawCellOverlay(ctx, proj, c.cx, c.cy, preview.reason ? 'rgba(200,50,50,.32)' : 'rgba(245,160,50,.36)');
        }
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
            draw: () => o.kind === 'difficult' ? drawCellOverlay(ctx, proj, c.cx, c.cy, 'rgba(160,125,65,.45)', 'rgba(210,170,90,.5)') : drawCube(ctx, proj, c.cx, c.cy, o.kind),
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
        } else if (prev.x !== target.x || prev.y !== target.y) {
          animating = !reduced;
          if (reduced) { prev.x = target.x; prev.y = target.y; }
          prev.x += (target.x - prev.x) * 0.22;
          prev.y += (target.y - prev.y) * 0.22;
          if (Math.abs(target.x - prev.x) < 0.6 && Math.abs(target.y - prev.y) < 0.6) { prev.x = target.x; prev.y = target.y; }
        }
        seenPos.add(u.id);
        const anim = animPosRef.current.get(u.id)!;
        const aCellF = { x: anim.x / CELL, y: anim.y / CELL };
        const centerG = { x: aCellF.x + span / 2, y: aCellF.y + span / 2 };
        const isDead = !!u.deathSaves?.dead;
        const isDown = (u.hp <= 0 || u.knockedOut || u.statuses.includes('unconscious')) && !isDead;
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
            if (!reduced && lunge && t - lunge.born < 260) {
              animating = true;
              const prog = Math.sin(Math.PI * (t - lunge.born) / 260);
              ox = lunge.dirX * 12 * cam.scale * prog;
              oy = lunge.dirY * 6 * cam.scale * prog;
            }
            const bob = 0;

            drawCellOverlay(ctx, proj, Math.floor(centerG.x), Math.floor(centerG.y), u.attitude === 2 ? 'rgba(160,55,40,.28)' : 'rgba(45,120,105,.24)', u.attitude === 2 ? '#e0836a' : '#5fd6a8');
            // 光环：当前行动者（金色聚光 + 呼吸细环，虚线感由内缩小半径体现）/ 选中（冷白细环）
            // 两个环用「颜色 + 半径」双重区分：金色大环=当前回合，冷白小环=UI 选中，避免同色叠环打架
            if (s.turn.currentUnitId === u.id && s.battleActive) {
              if (!reduced) animating = true;
              const breathe = reduced ? 0 : Math.sin(t / 300);
              drawSpotlight(ctx, cp.x, groundY, (span * 34 + 10) * cam.scale, 0.17 + 0.07 * breathe);
              drawRing(ctx, cp.x, groundY, (span * 28 + 8) * cam.scale, `rgba(245,197,66,${0.62 + 0.28 * breathe})`, 0, 3);
            }
            if (s.selectedId === u.id) {
              // 选中环内缩 4 尺半径，与当前回合环错开，不与金色主题冲突
              drawRing(ctx, cp.x, groundY, (span * 20 + 2) * cam.scale, STAGE_PALETTE.selectRing, 0, 2);
            }

            const alpha = isDead ? 0.22 : isDown ? 0.75 : 1;
            const squash = isDown ? 0.45 : 1;

            if (isEnemy) {
              const ex = span * 24 * cam.scale * 0.92;
              const ey = span * 12 * cam.scale * 0.92;
              drawShadow(ctx, cp.x, groundY, ex * 0.95, isDead ? 0.15 : 0.3);
              const kind = resolveCreatureKind(u.creatureType, u.name);
              // 哥布林等地表野怪按名字二级映射到专属徽章，不占用剑盾人形徽章
              const iconKind = resolveIconKind(kind, u.name);
              if (USE_ICON_BADGES && (EMBLEM_ASSETS[kind] || iconKind === 'goblin' || iconKind === 'orc')) {
                // 有矢量图标资产的族类 → 3D 金属徽章（挤出 + 斜角 + 金属材质）
                // 自转用往复摆动（±35°）而非全周旋转——扁徽章侧对镜头时会失去辨识度

                const swingPhase = (strHash(u.id) % 100) / 100 * Math.PI;
                getIconStage().drawIcon(ctx, {
                  x: cp.x + ox, groundY: groundY + oy,
                  size: 34 * cam.scale,
                  kind: iconKind,
                  spin: Math.sin(swingPhase) * 0.18,
                  lift: bob, alpha, squash, dead: isDead,
                });
              } else {
                // 其余族类：原版红色四棱锥
                drawPyramid(ctx, {
                  x: cp.x + ox, groundY: groundY + oy,
                  baseRx: ex, baseRy: ey,
                  height: span * 32 * cam.scale + bob,
                  alpha, squash,
                  hi: isDead ? '#8a8886' : '#e05a4a',
                  lo: isDead ? '#5f5d5b' : '#9c2418',
                });
              }
            } else {
              // 友方/中立：与敌方共用 3D 徽章管线（此前是扁平绿球，与地图其余部分质感割裂）
              // 友方兜底为 humanoid（冒险者/剑盾人形），而不是 generic（紫色水晶簇）——
              // 玩家角色名通常不含族类关键词，直接 resolveCreatureKind 会落到 generic
              const resolved = resolveCreatureKind(u.creatureType, u.name);
              const kind = resolved === 'generic' && u.attitude !== 1 ? 'humanoid' : resolved;
              const iconKind = resolveIconKind(kind, u.name);
              const hasBadge = USE_ICON_BADGES && !!(EMBLEM_ASSETS[kind] || iconKind === 'goblin' || iconKind === 'orc');
              if (hasBadge) {
                const swingPhase = (strHash(u.id) % 100) / 100 * Math.PI;
                getIconStage().drawIcon(ctx, {
                  x: cp.x + ox, groundY: groundY + oy,
                  size: 34 * cam.scale,
                  kind: iconKind,
                  spin: Math.sin(swingPhase) * 0.18,
                  lift: bob, alpha, squash, dead: isDead,
                  // 玩家金 / 中立黄 / 队友绿（与先攻条 turn-side 同源）
                  ringColor: u.isPlayer ? 0xf5c542 : u.attitude === 1 ? 0xe3ba55 : 0x3ecf6a,
                });
              } else {
                const r = (12 + span * 7.5) * cam.scale;
                drawShadow(ctx, cp.x, groundY, r * 0.95, isDead ? 0.15 : 0.32);
                // 玩家金环
                if (u.isPlayer && !isDead) {
                  drawRing(ctx, cp.x, groundY, r * 1.15, 'rgba(245,197,66,0.95)', 0, 2.5);
                }
                drawSphere(ctx, {
                  x: cp.x + ox,
                  y: groundY - r * 0.85 - bob + oy,
                  radius: r,
                  colors: u.attitude === 1 ? NEUTRAL_COLORS : ALLY_COLORS,
                  alpha, squash,
                });
                if (!isDown) drawLabel(ctx, cp.x + ox, groundY - r * 0.85 + oy, u.name.slice(0,1), '#e5fff4', cam.scale, 13);
                if (isDown) {
                  drawLabel(ctx, cp.x, groundY - r * 0.5, u.knockedOut ? '昏迷' : '✚', '#ff6b6b', cam.scale, 14);
                }
              }
            }

            // 死亡不再画 UI 元件
            if (isDead) { drawLabel(ctx, cp.x, groundY - 14, '† 阵亡', '#a8a6a0', cam.scale, 11); return; }

            // 名牌卡：名字 + 常显血条 + 状态行（屏幕空间恒定尺寸，低倍率下仍可读）
            // 高度锚点按实际棋子形态：徽章 = 与敌方同高（size 28 * scale），球体 = 球顶
            const nameKindRaw = resolveCreatureKind(u.creatureType, u.name);
            const nameKind = nameKindRaw === 'generic' && u.attitude !== 1 ? 'humanoid' : nameKindRaw;
            const useBadgeTop = USE_ICON_BADGES && !!(EMBLEM_ASSETS[nameKind]
              || ['goblin', 'orc'].includes(resolveIconKind(nameKind, u.name)));
            const tokenTopY = useBadgeTop
              ? groundY - (span * 32 * cam.scale + bob)
              : groundY - (12 + span * 7.5) * cam.scale * 1.85 - bob;
            const controlTag = u.attitude === 0 && !u.isPlayer ? (u.playerControlled ? ' 👤' : ' 🤖') : '';
            const nameColor = u.isPlayer ? '#f5c542' : isEnemy ? '#ff8a75' : u.attitude === 1 ? '#e3ba55' : '#7fe0a0';
            const plateStatuses = u.statuses.filter(st => st !== 'disengaging').slice(0, 4)
              .map(st => ({ icon: CONDITIONS[st]?.icon ?? '❓', color: CONDITIONS[st]?.color ?? '#aaa' }));
            const plate: NameplateInfo = {
              name: `${u.isPlayer ? '★' : ''}${u.name}${controlTag}`,
              nameColor,
              hp: u.hp,
              maxHp: u.maxHp,
              statuses: plateStatuses,
              variant: s.turn.currentUnitId === u.id && s.battleActive ? 'current' : s.selectedId === u.id ? 'selected' : 'default',
            };
            const plateBox = plateLayout(ctx, plate);
            const plateTop = placeLabel(cp.x, tokenTopY - 8 - plateBox.h, plateBox.w, plateBox.h);
            drawNameplate(ctx, cp.x, plateTop, plate, plateBox.w, plateBox.h, plateBox.label);
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
        const route = movementPreview(dragUnit, { cx: dd.curX, cy: dd.curY }, s.units, s.obstacles, s.mapConfig, s.battleActive, s.turn.currentUnitId);
        const cost = route.cost;
        const max = remainingMovement(dragUnit);
        const valid = !route.reason;
        const p = proj.p(dd.curX + 0.5, dd.curY + 0.5);
        // 路径箭头
        const p0 = proj.p(dd.startX + 0.5, dd.startY + 0.5);
        ctx.save();
        ctx.strokeStyle = valid ? STAGE_PALETTE.pathValid : STAGE_PALETTE.pathInvalid;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        for (const c of route.path.slice(1)) { const step = proj.p(c.cx + .5, c.cy + .5); ctx.lineTo(step.x, step.y); }
        ctx.stroke();
        ctx.restore();
        drawBadge(ctx, p.x, p.y - 18, `移动 ${cost}尺 / 剩余 ${max}尺`, valid ? STAGE_PALETTE.pathBadgeBg : 'rgba(140,40,40,0.92)', cam.scale);
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
      // 悬停高亮由 pointermove -> wake() 驱动重绘，此处不读 hoverInfo，
      // 避免每次悬停进出都拆装整个渲染循环（退订 store、销毁 IntersectionObserver）
      if (visibleRef.current && !reduced && (animating || floatsRef.current.length > 0 || slashesRef.current.length > 0)) wake();
    };
    invalidateRef.current = wake;
    const unsubStore = useBattleStore.subscribe(wake), unsubSelection = useActionUiStore.subscribe(wake);
    // Webfonts 就绪后重绘一次，避免 canvas 首帧用到回退字体
    document.fonts?.ready.then(() => invalidateRef.current()).catch(() => {});
    const canvas = canvasRef.current;
    const onVisibility = () => { if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0; } else wake(); };
    document.addEventListener('visibilitychange', onVisibility);
    const io = new IntersectionObserver(entries => { visibleRef.current = entries[0].isIntersecting; if (visibleRef.current) wake(); });
    if (canvas) { io.observe(canvas); for (const event of ['pointermove','pointerdown','pointerup','wheel']) canvas.addEventListener(event, wake, { passive: true }); }
    wake();
    return () => { disposed = true; cancelAnimationFrame(raf); unsubStore(); unsubSelection(); io.disconnect(); document.removeEventListener('visibilitychange', onVisibility); if (canvas) for (const event of ['pointermove','pointerdown','pointerup','wheel']) canvas.removeEventListener(event, wake); invalidateRef.current = () => {}; };
  }, [tool, aoePreset]);

  useEffect(() => {
    invalidateRef.current();
    if (!workspace || !actionUi.targetId) return;
    const unit = store.units.find(u => u.id === actionUi.targetId);
    const hudHeight = boundary?.querySelector('.token-hud')?.getBoundingClientRect().height ?? 180;
    if (!unit) return;
    const point = makeProjector(camRef.current).p(unit.pos.x / 5 + .5, unit.pos.y / 5 + .5);
    const limit = sizeRef.current.h - hudHeight - 45;
    if (point.y > limit) { camRef.current.panY -= point.y - Math.max(160, limit - 45); invalidateRef.current(); }
  }, [actionUi.targetId, actionUi.request, workspace, boundary, store.units]);

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
    if (store.readOnly && tool !== 'select' && tool !== 'measure') return;
    setQuickMenu(null);
    const cell = pickCell(e.clientX, e.clientY);
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const sx = e.clientX - (rect?.left ?? 0);
    const sy = e.clientY - (rect?.top ?? 0);

    const req = useActionUiStore.getState().request;
    if (req && !store.readOnly && e.button === 0) {
      const tokenId = pickToken(e.clientX, e.clientY);
      if (tokenId) {
        const actor = store.units.find(u => u.id === req.actorId);
        const target = store.units.find(u => u.id === tokenId);
        if (actor && target) {
          const candidate = hudCandidates(req, actor, store.units).some(u => u.id === target.id);
          const reason = candidate ? hudTargetReason(req, actor, target, store.units, store.obstacles, store.mapConfig.diagonal) : '该单位不是此动作的合法目标';
          if (reason) actionUi.fail(reason); else actionUi.select(tokenId);
        }
        setDragBoth(null);
        return;
      }
      // Ground click may place AoE on pointer-up; dragging still pans the view.
      setDragBoth({ kind: 'pan', startX: cell.cx, startY: cell.cy, curX: e.clientX, curY: e.clientY, lastScreenX: e.clientX, lastScreenY: e.clientY, screenStartX: e.clientX, screenStartY: e.clientY, moved: false });
      return;
    }
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
    // select 工具：点选式——点击棋子=选中+快捷菜单；已武装移动的棋子可直接拖拽换位
    if (e.button === 0) {
      const tokenId = pickToken(e.clientX, e.clientY);
      if (tokenId) {
        const unit = store.units.find(u => u.id === tokenId);
        const s = useBattleStore.getState();
        const canDragToken = !!unit && unit.hp > 0 && !s.pendingReactionStep
          && (!s.battleActive || useActionUiStore.getState().movingActorId === unit.id);
        if (canDragToken && unit) {
          setDragBoth({ kind: 'token', unitId: tokenId, startX: cell.cx, startY: cell.cy, curX: cell.cx, curY: cell.cy, lastScreenX: e.clientX, lastScreenY: e.clientY, screenStartX: e.clientX, screenStartY: e.clientY, moved: false });
        } else {
          store.setSelectedId(store.selectedId === tokenId ? null : tokenId);
          if (unit && unit.hp > 0) setQuickMenu({ unitId: tokenId, x: sx, y: sy });
        }
        return;
      }
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
    hoverCellRef.current = cell;
    setHoverCell(prev => prev?.cx === cell.cx && prev?.cy === cell.cy ? prev : cell);
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

  const onPointerUp = (e: React.PointerEvent) => {
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
          requestMove(unit.id, { cx: d.curX, cy: d.curY });
        }
      } else if (unit) {
        // 未拖动 = 点击：选中切换 + 弹出快捷菜单（Foundry 式就近操作）
        s.setSelectedId(s.selectedId === unit.id ? null : unit.id);
        const rect = canvasRef.current?.getBoundingClientRect();
        setQuickMenu({ unitId: unit.id, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
      }
    } else if (d.kind === 'aoe' && aoePreset && d.moved) {
      const o = cellCenter({ cx: d.startX, cy: d.startY });
      const angle = (d.curX === d.startX && d.curY === d.startY) ? 0 : Math.atan2(d.curY - d.startY, d.curX - d.startX);
      s.addAoeTemplate({ kind: aoePreset.kind, size: aoePreset.size, origin: o, angle, color: aoePreset.color, label: aoePreset.label });
    } else if (d.kind === 'obstacle' && d.obstacleCells && d.obstacleCells.length > 0) {
      s.addObstacle(d.obstacleCells, obstacleKind);
    } else if (d.kind === 'pan' && !d.moved) {
      const req = useActionUiStore.getState().request;
      if (req) {
        const actor = s.units.find(u => u.id === req.actorId);
        if (req.ability.kind === 'save-aoe' && actor && !s.readOnly) {
          const cell = pickCell(e.clientX, e.clientY);
          const origin = { x: cellToFeet(cell.cx), y: cellToFeet(cell.cy) };
          const reason = abilityTargetCheck(actor, req.ability, undefined, s.obstacles, s.mapConfig.diagonal, origin);
          if (reason) actionUi.fail(reason); else actionUi.place(origin);
        } else actionUi.fail('请点选地图上的合法目标');
        setDragBoth(null); return;
      }
      // 点在棋子上：选中/取消已在 down 处理，这里仅结束
      if (pickToken(e.clientX, e.clientY)) { setDragBoth(null); return; }
      // 点选式移动：选中棋子 + 点击可抵达的空格 → 移动
      if (tool === 'select' && e.button === 0 && s.selectedId && (!workspace || useActionUiStore.getState().movingActorId === s.selectedId)) {
        const unit = s.units.find(u => u.id === s.selectedId);
        const target = pickCell(e.clientX, e.clientY);
        if (unit && unit.hp > 0) {
          const cur = posToCell(unit.pos);
          if (target.cx !== cur.cx || target.cy !== cur.cy) {
            requestMove(unit.id, target);
            setDragBoth(null);
            return;
          }
        }
      }
      // 无效目标（超范围/被阻挡/无选中）：维持原「取消选中」
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
    invalidateRef.current();
    cam.scale = ns;
  };

  // 悬停单位信息
  const hoverUnit = hoverInfo ? store.units.find(u => u.id === hoverInfo.unitId) : null;

  const tools = [
    { key: 'select' as Tool, icon: MousePointer2, label: '点选/移动' },
    { key: 'measure' as Tool, icon: Ruler, label: '测距' },
    { key: 'aoe' as Tool, icon: Flame, label: 'AoE 模板' },
    { key: 'obstacle' as Tool, icon: BrickWall, label: '绘制掩体' },
  ];

  const selectedUnit = store.selectedId ? store.units.find(u => u.id === store.selectedId) : null;
  const rangeHint = selectedUnit ? `已选 ${selectedUnit.name}` : null;

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden rounded-xl parchment-panel', workspace ? 'battle-map-fill' : compact ? 'embed-map h-[280px] md:h-[340px]' : 'h-[480px] md:h-[640px]')}
    >
      <canvas
        ref={canvasRef}
        className={cn('absolute inset-0 h-full w-full touch-none select-none', tool === 'select' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDragBoth(null)}
      />

      <div className={cn('map-tools absolute z-20', workspace ? 'stage-map-tools' : 'top-2 left-2 right-2')}>
        <HudMenu boundary={boundary} label="地图工具" open={toolsOpen} onOpenChange={setToolsOpen} side="bottom"
          trigger={<button className="stage-map-tool-button" aria-label="地图工具" disabled={!!actionUi.request || !!actionUi.movingActorId}><MousePointer2 size={18}/></button>}>
          <div className="hud-menu-heading"><strong>地图工具</strong><button aria-label="关闭地图工具" onClick={() => setToolsOpen(false)}>×</button></div>
          <div className="hud-map-tool-list">{tools.map(tItem => <button key={tItem.key} aria-pressed={tool === tItem.key}
            disabled={store.readOnly && !['select','measure'].includes(tItem.key)}
            onClick={() => { setTool(tItem.key); if (tItem.key !== 'aoe') setAoePreset(null); if (['select','measure'].includes(tItem.key)) setToolsOpen(false); }}>
            <tItem.icon size={16}/>{tItem.label}</button>)}</div>
          {toolChoice === 'aoe' && <div className="hud-menu-list">{AOE_PRESETS.map(p => <button key={p.label} className="hud-list-item" disabled={store.readOnly} onClick={() => { setAoePreset(p); setToolsOpen(false); }}><span>{p.label}</span><small>{p.note}</small></button>)}<button disabled={store.readOnly} onClick={() => store.clearAoeTemplates()}>清除范围模板</button></div>}
          {toolChoice === 'obstacle' && <div className="hud-menu-list">{([['full','完全掩体'],['threeQuarters','四分之三掩体'],['half','半身掩体'],['difficult','困难地形']] as const).map(([k,label]) => <button key={k} disabled={store.readOnly} onClick={() => { setObstacleKind(k); setToolsOpen(false); }}>{label}</button>)}<button disabled={store.readOnly} onClick={() => store.clearObstacles()}>清除掩体</button></div>}
        </HudMenu>
        <button className="stage-map-tool-button" onClick={() => zoomAt(1.25)} aria-label="放大"><ZoomIn size={18}/></button>
        <button className="stage-map-tool-button" onClick={() => zoomAt(.8)} aria-label="缩小"><ZoomOut size={18}/></button>
        <button className="stage-map-tool-button" onClick={fitView} aria-label="适配视野"><Maximize size={18}/></button>
      </div>

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

      {/* 选中提示（点选式移动） */}
      {selectedUnit && tool === 'select' && !drag && !actionUi.request && !confirmation && !workspace && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded-md border border-border/50 bg-black/70 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
          已选中 <span className="font-bold text-foreground">{selectedUnit.name}</span> —— 点击青色范围内的格子移动，再点该棋子取消
        </div>
      )}

      {actionUi.request && workspace && <div className="stage-target-hint">{actionUi.request.ability.name} · {actionUi.request.ability.kind === 'save-aoe' ? '点选地图落点' : '点选高亮棋子'}</div>}
      {moveView && !drag && !confirmation && !actionUi.request && !hoverInfo && (
        <div className={cn("pointer-events-none absolute z-20 rounded-md bg-black/85 p-2 text-xs text-sky-100", workspace ? "stage-move-preview" : "bottom-12 left-2 right-2")}>
          {moveView.reason ?? `移动 ${moveView.cost} 尺，剩余 ${moveView.left} 尺`}
          {moveView.threats.length > 0 && <div className="text-amber-200">可能受到借机攻击：{moveView.threats.map(t => t.unit.name).join('、')}</div>}
        </div>
      )}
      {confirmation && (() => {
        const unit = store.units.find(u => u.id === confirmation.id);
        const p = unit ? movementPreview(unit, confirmation.cell, store.units, store.obstacles, store.mapConfig, store.battleActive, store.turn.currentUnitId) : null;
        return <div role="alertdialog" aria-label="确认危险移动" className={cn("absolute z-40 rounded-lg border border-amber-400/60 bg-black/95 p-3 text-xs text-amber-100", workspace ? "stage-move-confirm" : "bottom-2 left-2 right-2")}>
          <div>{p?.reason ?? `移动 ${p?.cost} 尺，剩余 ${p?.left} 尺`}</div>
          <div>可能受到借机攻击：{p?.threats.map(t => t.unit.name).join('、') || '当前无威胁'}</div>
          <div className="mt-2 flex gap-2"><Button size="sm" disabled={!!p?.reason || store.readOnly || !!store.pendingReactionStep} onClick={() => requestMove(confirmation.id, confirmation.cell, true)}>确认移动</Button>
            <Button size="sm" variant="secondary" onClick={() => setMoveConfirm(null)}>取消</Button></div>
        </div>;
      })()}
      {/* Token 上下文快捷菜单：点击棋子后弹出在棋子旁（移动/攻击/详情） */}
      {quickMenu && <TokenQuickMenu unitId={quickMenu.unitId} x={quickMenu.x} y={quickMenu.y}
        mapW={size.w} mapH={size.h} onClose={() => setQuickMenu(null)} onInspect={onInspect} />}
      {/* 图例 */}
      {!workspace && <div className="pointer-events-none absolute bottom-2 right-2 z-10 hidden items-center gap-2.5 rounded-md bg-black/45 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur md:flex">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: 'radial-gradient(circle at 35% 30%, #b8f7c6, #3ecf6a 55%, #0c5e2c)' }} />友方</span>
        <span className="flex items-center gap-1">
          <svg width="12" height="10" viewBox="0 0 12 10"><polygon points="0,9 6,0 12,9 6,7" fill="#c33a2b" /></svg>
          敌方
        </span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: 'linear-gradient(135deg,#8d949e 40%,#565b63)' }} />掩体</span>
        <span className="text-primary/60">👤玩家操控 · 🤖AI托管</span>
      </div>}
    </div>
  );
}
