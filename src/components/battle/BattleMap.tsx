'use client';

/**
 * 战术地图：SVG 5尺网格
 * - token 拖拽（网格吸附 + 移动成本实时显示 + 超速警告）
 * - 移动范围高亮（A* 洪水填充）
 * - AoE 模板放置（圆/锥/线/方）+ 命中单位高亮
 * - 测距工具（对角线规则）
 * - 掩体绘制（半身/四分三/完全）
 * - 上回合移动轨迹（diff）
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import {
  CELL, posToCell, cellToFeet, cellCenter, cellKey, unitOccupiedCells,
  buildBlockedCells, reachableCells, gridDistanceCells, aoeCells,
  AOE_PRESETS,
} from '@/lib/engine/geometry';
import type { AoeTemplate, AoeShapeKind, MapObstacle } from '@/lib/engine/types';
import { SIZE_META, ATTITUDE_META } from '@/lib/engine/types';
import { remainingMovement } from '@/lib/engine/rules';
import { CONDITIONS } from '@/lib/engine/conditions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  MousePointer2, Ruler, Flame, BrickWall, Trash2, ZoomIn, ZoomOut,
  Maximize, MousePointerClick, Swords,
} from 'lucide-react';

const RENDER_CELL = 44; // 每格渲染像素
type Tool = 'select' | 'measure' | 'aoe' | 'obstacle';

interface DragState {
  kind: 'token' | 'pan' | 'measure' | 'aoe' | 'obstacle' | null;
  unitId?: string;
  startX: number; startY: number;   // 世界坐标（格）
  curX: number; curY: number;
  obstacleCells?: Cell[];
}

import type { Cell } from '@/lib/engine/types';

export function BattleMap({ compact = false }: { compact?: boolean }) {
  const store = useBattleStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [aoePreset, setAoePreset] = useState<(typeof AOE_PRESETS)[number] | null>(null);
  const [obstacleKind, setObstacleKind] = useState<MapObstacle['kind']>('full');
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverCell, setHoverCell] = useState<Cell | null>(null);

  const { units, obstacles, aoeTemplates, mapConfig, turn, lastDiff } = store;
  const W = mapConfig.width * RENDER_CELL;
  const H = mapConfig.height * RENDER_CELL;

  // ---- 动态边界：画布自动扩展覆盖负坐标/超界单位 ----
  const bounds = useMemo(() => {
    let minX = 0, minY = 0, maxX = mapConfig.width, maxY = mapConfig.height;
    for (const u of units) {
      const c = posToCell(u.pos);
      minX = Math.min(minX, c.cx);
      minY = Math.min(minY, c.cy);
      maxX = Math.max(maxX, c.cx + 1);
      maxY = Math.max(maxY, c.cy + 1);
    }
    for (const o of obstacles) {
      for (const c of o.cells) {
        minX = Math.min(minX, c.cx);
        minY = Math.min(minY, c.cy);
        maxX = Math.max(maxX, c.cx + 1);
        maxY = Math.max(maxY, c.cy + 1);
      }
    }
    // 外边距 1 格
    return {
      minX: minX - 1, minY: minY - 1, maxX: maxX + 1, maxY: maxY + 1,
    };
  }, [units, obstacles, mapConfig]);

  const VB = useMemo(() => ({
    x: bounds.minX * RENDER_CELL,
    y: bounds.minY * RENDER_CELL,
    w: (bounds.maxX - bounds.minX) * RENDER_CELL,
    h: (bounds.maxY - bounds.minY) * RENDER_CELL,
  }), [bounds]);

  // ---- 坐标换算（含 viewBox 偏移） ----
  const screenToCell = useCallback((clientX: number, clientY: number): Cell => {
    const svg = svgRef.current;
    if (!svg) return { cx: 0, cy: 0 };
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * VB.w + VB.x;
    const y = ((clientY - rect.top) / rect.height) * VB.h + VB.y;
    return { cx: Math.floor(x / RENDER_CELL), cy: Math.floor(y / RENDER_CELL) };
  }, [VB]);

  // ---- 选中单位（store 联动） ----
  const selectedUnitId = store.selectedId;
  const setSelectedUnitId = store.setSelectedId;
  const selectedUnit = units.find(u => u.id === selectedUnitId);

  const moveRange = useMemo(() => {
    if (!selectedUnit || tool !== 'select') return null;
    const mv = remainingMovement(selectedUnit);
    if (mv <= 0) return null;
    return reachableCells(selectedUnit, units, obstacles, mv, mapConfig.diagonal);
  }, [selectedUnit, units, obstacles, mapConfig.diagonal, tool]);

  // ---- AoE 命中预览 ----
  const aoePreview = useMemo(() => {
    if (drag?.kind === 'aoe' && aoePreset) {
      const o = cellCenter({ cx: drag.startX, cy: drag.startY });
      const dx = drag.curX - drag.startX, dy = drag.curY - drag.startY;
      const angle = (dx === 0 && dy === 0) ? 0 : Math.atan2(dy, dx);
      const t: AoeTemplate = {
        id: 'preview', kind: aoePreset.kind, size: aoePreset.size,
        origin: o, angle, color: aoePreset.color, label: aoePreset.label,
      };
      return { template: t, hit: aoeCells(t, units).affectedUnitIds };
    }
    return null;
  }, [drag, aoePreset, units]);

  // ---- 已放置 AoE 命中单位 ----
  const aoeHits = useMemo(() => {
    const hits = new Set<string>();
    for (const t of aoeTemplates) {
      for (const id of aoeCells(t, units).affectedUnitIds) hits.add(id);
    }
    return hits;
  }, [aoeTemplates, units]);

  // ---- 拖拽事件 ----
  const onPointerDownBackground = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && tool === 'select' && e.shiftKey)) {
      setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY });
      return;
    }
    const cell = screenToCell(e.clientX, e.clientY);
    if (tool === 'measure') {
      setDrag({ kind: 'measure', startX: cell.cx, startY: cell.cy, curX: cell.cx, curY: cell.cy });
    } else if (tool === 'aoe' && aoePreset) {
      setDrag({ kind: 'aoe', startX: cell.cx, startY: cell.cy, curX: cell.cx, curY: cell.cy });
    } else if (tool === 'obstacle') {
      setDrag({ kind: 'obstacle', startX: cell.cx, startY: cell.cy, curX: cell.cx, curY: cell.cy, obstacleCells: [cell] });
    } else {
      setSelectedUnitId(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const cell = screenToCell(e.clientX, e.clientY);
    setHoverCell(cell);
    if (!drag) return;
    if (drag.kind === 'pan') {
      setView(v => ({ ...v, tx: v.tx + (e.clientX - drag.curX), ty: v.ty + (e.clientY - drag.curY) }));
      setDrag(d => (d ? { ...d, curX: e.clientX, curY: e.clientY } : d));
      return;
    }
    setDrag(d => {
      if (!d) return d;
      if (d.kind === 'obstacle') {
        const cells = paintLine({ cx: d.startX, cy: d.startY }, cell);
        return { ...d, curX: cell.cx, curY: cell.cy, obstacleCells: cells };
      }
      return { ...d, curX: cell.cx, curY: cell.cy };
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const cell = screenToCell(e.clientX, e.clientY);
    if (drag.kind === 'aoe' && aoePreset) {
      const o = cellCenter({ cx: drag.startX, cy: drag.startY });
      const dx = cell.cx - drag.startX, dy = cell.cy - drag.startY;
      const angle = (dx === 0 && dy === 0) ? 0 : Math.atan2(dy, dx);
      store.addAoeTemplate({
        kind: aoePreset.kind, size: aoePreset.size, origin: o, angle,
        color: aoePreset.color, label: aoePreset.label,
      });
    } else if (drag.kind === 'obstacle' && drag.obstacleCells && drag.obstacleCells.length > 0) {
      store.addObstacle(drag.obstacleCells, obstacleKind);
    }
    setDrag(null);
  };

  // token 拖拽
  const onTokenPointerDown = (e: React.PointerEvent, unitId: string) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const cell = screenToCell(e.clientX, e.clientY);
    setSelectedUnitId(unitId);
    setDrag({ kind: 'token', unitId, startX: cell.cx, startY: cell.cy, curX: cell.cx, curY: cell.cy });
  };

  const onTokenPointerMove = (e: React.PointerEvent) => {
    if (drag?.kind !== 'token') return;
    const cell = screenToCell(e.clientX, e.clientY);
    setDrag(d => (d ? { ...d, curX: cell.cx, curY: cell.cy } : d));
  };

  const onTokenPointerUp = () => {
    if (drag?.kind === 'token' && drag.unitId) {
      const unit = units.find(u => u.id === drag.unitId);
      if (unit) {
        const dx = drag.curX - drag.startX;
        const dy = drag.curY - drag.startY;
        if (dx !== 0 || dy !== 0) {
          // 检查目标格未占用
          const occupied = new Set(units.filter(u => u.id !== unit.id).flatMap(u => unitOccupiedCells(u).map(cellKey)));
          const span = SIZE_META[unit.size].cells;
          let blocked = false;
          for (let i = 0; i < span; i++) {
            for (let j = 0; j < span; j++) {
              if (occupied.has(cellKey({ cx: drag.curX + i, cy: drag.curY + j }))) blocked = true;
            }
          }
          if (!blocked) {
            store.moveUnit(unit.id, { x: cellToFeet(drag.curX), y: cellToFeet(drag.curY) });
          }
        }
      }
    }
    setDrag(null);
  };

  // ---- 渲染辅助 ----
  const draggingUnit = drag?.kind === 'token' ? units.find(u => u.id === drag.unitId) : null;
  const dragCost = draggingUnit && drag
    ? gridDistanceCells({ cx: drag.startX, cy: drag.startY }, { cx: drag.curX, cy: drag.curY }, mapConfig.diagonal) * CELL
    : 0;
  const dragMax = draggingUnit ? remainingMovement(draggingUnit) : 0;

  const measureDist = drag?.kind === 'measure'
    ? gridDistanceCells({ cx: drag.startX, cy: drag.startY }, { cx: drag.curX, cy: drag.curY }, mapConfig.diagonal) * CELL
    : null;

  // diff 轨迹
  const trails = useMemo(() => {
    if (!lastDiff) return [];
    const out: Array<{ id: string; from: Cell; to: Cell }> = [];
    for (const d of lastDiff.unitDiffs) {
      if (!d.posDelta) continue;
      const u = units.find(x => x.id === d.id);
      if (!u) continue;
      out.push({
        id: d.id,
        from: { cx: posToCell({ x: u.pos.x - d.posDelta.x, y: u.pos.y - d.posDelta.y }).cx, cy: posToCell({ x: u.pos.x - d.posDelta.x, y: u.pos.y - d.posDelta.y }).cy },
        to: posToCell(u.pos),
      });
    }
    return out;
  }, [lastDiff, units]);

  const zoomAt = (factor: number) => {
    setView(v => {
      const s = Math.min(3, Math.max(0.4, v.scale * factor));
      return { ...v, scale: s };
    });
  };

  const fitView = () => setView({ scale: 1, tx: 0, ty: 0 });

  // 工具按钮
  const tools = [
    { key: 'select' as Tool, icon: MousePointer2, label: '选择/拖拽' },
    { key: 'measure' as Tool, icon: Ruler, label: '测距' },
    { key: 'aoe' as Tool, icon: Flame, label: 'AoE 模板' },
    { key: 'obstacle' as Tool, icon: BrickWall, label: '绘制掩体' },
  ];

  return (
    <div className={cn('relative overflow-hidden rounded-xl parchment-panel', compact ? 'h-[320px] md:h-[380px]' : 'h-[440px] md:h-[560px]')}>
      {/* 顶部工具栏 */}
      <div className="absolute top-2 left-2 right-2 z-20 flex flex-wrap items-center gap-1.5">
        {tools.map(t => (
          <Button
            key={t.key}
            size="sm"
            variant={tool === t.key ? 'default' : 'secondary'}
            className={cn('h-8 gap-1 px-2 text-xs', tool === t.key && 'bg-primary text-primary-foreground')}
            onClick={() => { setTool(t.key); if (t.key !== 'aoe') setAoePreset(null); }}
            title={t.label}
          >
            <t.icon className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{t.label}</span>
          </Button>
        ))}
        <div className="grow" />
        <Button size="sm" variant="secondary" className="h-8 w-8 p-0" onClick={() => zoomAt(1.25)}><ZoomIn className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="secondary" className="h-8 w-8 p-0" onClick={() => zoomAt(0.8)}><ZoomOut className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="secondary" className="h-8 w-8 p-0" onClick={fitView}><Maximize className="h-3.5 w-3.5" /></Button>
      </div>

      {/* AoE 预设选择条 */}
      {tool === 'aoe' && (
        <div className="absolute top-12 left-2 right-2 z-20 flex flex-wrap gap-1 rounded-lg bg-black/60 p-1.5 backdrop-blur">
          {AOE_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => setAoePreset(p)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] leading-tight border transition-colors',
                aoePreset?.label === p.label
                  ? 'bg-primary/90 text-primary-foreground border-primary'
                  : 'border-transparent text-foreground/80 hover:bg-white/10',
              )}
              title={p.note}
            >
              {p.label}
            </button>
          ))}
          <div className="grow" />
          <button
            onClick={() => store.clearAoeTemplates()}
            className="rounded-md px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/20"
            title="清除全部模板"
          >
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
              className={cn(
                'rounded-md px-2 py-1 text-[11px]',
                obstacleKind === k ? 'bg-primary/90 text-primary-foreground' : 'text-foreground/80 hover:bg-white/10',
              )}
            >
              {label}
            </button>
          ))}
          <button onClick={() => store.clearObstacles()} className="rounded-md px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/20">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 地图 SVG */}
      <svg
        ref={svgRef}
        viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
        className={cn('h-full w-full touch-none select-none', tool === 'select' ? 'cursor-grab' : 'cursor-crosshair')}
        onPointerDown={onPointerDownBackground}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { if (drag?.kind === 'token') onTokenPointerUp(); setDrag(null); }}
        onWheel={(e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.1 : 0.9); }}
        style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: 'center' }}
      >
        <defs>
          <pattern id="grid" width={RENDER_CELL} height={RENDER_CELL} patternUnits="userSpaceOnUse">
            <path d={`M ${RENDER_CELL} 0 L 0 0 0 ${RENDER_CELL}`} fill="none" stroke="rgba(216,178,122,0.22)" strokeWidth="1" />
          </pattern>
          <pattern id="gridMajor" width={RENDER_CELL * 5} height={RENDER_CELL * 5} patternUnits="userSpaceOnUse">
            <path d={`M ${RENDER_CELL * 5} 0 L 0 0 0 ${RENDER_CELL * 5}`} fill="none" stroke="rgba(216,178,122,0.40)" strokeWidth="1.6" />
          </pattern>
        </defs>

        {/* 地形底（全画布） */}
        <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="#1d1710" />
        {/* 主区域（配置范围）稍亮 */}
        <rect x={0} y={0} width={W} height={H} fill="#282016" />
        <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="url(#grid)" />
        <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="url(#gridMajor)" />
        {/* 主区域边界描边 */}
        <rect x={0} y={0} width={W} height={H} fill="none" stroke="rgba(216,178,122,0.4)" strokeWidth="2.5" />

        {/* 移动范围高亮 */}
        {moveRange && [...moveRange.entries()].map(([k, cost]) => {
          const [cx, cy] = k.split(',').map(Number);
          return (
            <rect
              key={k} x={cx * RENDER_CELL} y={cy * RENDER_CELL}
              width={RENDER_CELL} height={RENDER_CELL}
              fill={cost > (moveRange.get(cellKey({ cx: Math.floor(selectedUnit!.pos.x / CELL), cy: Math.floor(selectedUnit!.pos.y / CELL) })) ?? 0) ? 'rgba(110,180,220,0.13)' : 'rgba(110,180,220,0.2)'}
              stroke="rgba(110,180,220,0.25)" strokeWidth="0.5"
            />
          );
        })}

        {/* 掩体 */}
        {obstacles.map((o, i) => (
          <g key={i}>
            {o.cells.map(c => (
              <rect
                key={cellKey(c)}
                x={c.cx * RENDER_CELL + 1} y={c.cy * RENDER_CELL + 1}
                width={RENDER_CELL - 2} height={RENDER_CELL - 2} rx="3"
                fill={o.kind === 'full' ? 'rgba(90,72,50,0.9)' : o.kind === 'threeQuarters' ? 'rgba(110,90,60,0.6)' : 'rgba(120,100,70,0.35)'}
                stroke={o.kind === 'full' ? 'rgba(216,178,122,0.4)' : 'rgba(216,178,122,0.25)'}
                strokeWidth="1"
              />
            ))}
          </g>
        ))}

        {/* 移动轨迹 */}
        {trails.map(t => (
          <g key={`trail-${t.id}`}>
            <line
              x1={t.from.cx * RENDER_CELL + RENDER_CELL / 2} y1={t.from.cy * RENDER_CELL + RENDER_CELL / 2}
              x2={t.to.cx * RENDER_CELL + RENDER_CELL / 2} y2={t.to.cy * RENDER_CELL + RENDER_CELL / 2}
              stroke="rgba(240,194,137,0.5)" strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round"
            />
            <circle cx={t.from.cx * RENDER_CELL + RENDER_CELL / 2} cy={t.from.cy * RENDER_CELL + RENDER_CELL / 2} r="3" fill="rgba(240,194,137,0.4)" />
          </g>
        ))}

        {/* 已放置 AoE 模板 */}
        {aoeTemplates.map(t => renderAoe(t, units.map(u => u.id)))}

        {/* AoE 预览 */}
        {aoePreview && renderAoe(aoePreview.template, aoePreview.hit)}

        {/* 测距线 */}
        {drag?.kind === 'measure' && (
          <g>
            <line
              x1={(drag.startX + 0.5) * RENDER_CELL} y1={(drag.startY + 0.5) * RENDER_CELL}
              x2={(drag.curX + 0.5) * RENDER_CELL} y2={(drag.curY + 0.5) * RENDER_CELL}
              stroke="#7ec8f0" strokeWidth="2.5" strokeDasharray="8 5" strokeLinecap="round"
            />
            <circle cx={(drag.startX + 0.5) * RENDER_CELL} cy={(drag.startY + 0.5) * RENDER_CELL} r="4" fill="#7ec8f0" />
            <circle cx={(drag.curX + 0.5) * RENDER_CELL} cy={(drag.curY + 0.5) * RENDER_CELL} r="4" fill="#7ec8f0" />
            <rect
              x={(drag.curX + 0.5) * RENDER_CELL - 30} y={(drag.curY + 0.5) * RENDER_CELL - 30}
              width="60" height="22" rx="6" fill="rgba(0,0,0,0.8)" stroke="#7ec8f0" strokeWidth="0.5"
            />
            <text x={(drag.curX + 0.5) * RENDER_CELL} y={(drag.curY + 0.5) * RENDER_CELL - 15} textAnchor="middle" fill="#7ec8f0" fontSize="13" fontWeight="bold">
              {measureDist} 尺
            </text>
          </g>
        )}

        {/* 掩体绘制预览 */}
        {drag?.kind === 'obstacle' && drag.obstacleCells?.map(c => (
          <rect
            key={`p-${cellKey(c)}`}
            x={c.cx * RENDER_CELL + 1} y={c.cy * RENDER_CELL + 1}
            width={RENDER_CELL - 2} height={RENDER_CELL - 2} rx="3"
            fill="rgba(216,178,122,0.3)" stroke="rgba(216,178,122,0.6)" strokeWidth="1"
          />
        ))}

        {/* 单位 token */}
        {units.filter(u => !u.deathSaves?.dead).map(u => {
          const cell = posToCell(u.pos);
          const span = SIZE_META[u.size].cells;
          const isDragging = drag?.kind === 'token' && drag.unitId === u.id;
          const dx = isDragging ? (drag!.curX - drag!.startX) * RENDER_CELL : 0;
          const dy = isDragging ? (drag!.curY - drag!.startY) * RENDER_CELL : 0;
          const isCurrent = turn.currentUnitId === u.id && store.battleActive;
          const isAoeHit = aoeHits.has(u.id);
          const meta = ATTITUDE_META[u.attitude];
          const hpRatio = u.maxHp > 0 ? Math.max(0, u.hp) / u.maxHp : 0;
          const radius = (span * RENDER_CELL) / 2 - 3;

          return (
            <g
              key={u.id}
              transform={`translate(${cell.cx * RENDER_CELL + dx}, ${cell.cy * RENDER_CELL + dy})`}
              onPointerDown={e => onTokenPointerDown(e, u.id)}
              onPointerMove={onTokenPointerMove}
              onPointerUp={onTokenPointerUp}
              className={tool === 'select' ? 'cursor-move' : 'cursor-crosshair'}
              style={{ transition: isDragging ? 'none' : 'transform 0.25s ease' }}
            >
              {/* 选择环 / 回合光圈 */}
              {(isCurrent || selectedUnitId === u.id) && (
                <circle
                  cx={span * RENDER_CELL / 2} cy={span * RENDER_CELL / 2} r={radius + 4}
                  fill="none" stroke={isCurrent ? '#f0c289' : '#7ec8f0'} strokeWidth="2.5"
                  strokeDasharray={isCurrent ? undefined : '5 4'}
                  className={isCurrent ? 'turn-glow' : undefined}
                />
              )}
              {/* AoE 命中标记 */}
              {isAoeHit && (
                <circle cx={span * RENDER_CELL / 2} cy={span * RENDER_CELL / 2} r={radius + 7}
                  fill="none" stroke="#f0a050" strokeWidth="2" strokeDasharray="3 3" />
              )}
              {/* token 主体 */}
              <circle
                cx={span * RENDER_CELL / 2} cy={span * RENDER_CELL / 2} r={radius}
                fill={meta.color}
                opacity={u.hp <= 0 ? 0.35 : 0.92}
                stroke="rgba(0,0,0,0.7)" strokeWidth="2"
              />
              {/* HP 环 */}
              <circle
                cx={span * RENDER_CELL / 2} cy={span * RENDER_CELL / 2} r={radius + 1.5}
                fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="3"
                strokeDasharray={`${2 * Math.PI * (radius + 1.5)}`}
                transform={`rotate(-90 ${span * RENDER_CELL / 2} ${span * RENDER_CELL / 2})`}
                style={{ strokeDashoffset: 0 }}
              />
              <circle
                cx={span * RENDER_CELL / 2} cy={span * RENDER_CELL / 2} r={radius + 1.5}
                fill="none"
                stroke={hpRatio > 0.5 ? '#6dbf5e' : hpRatio > 0.25 ? '#e0b040' : '#e05252'}
                strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * (radius + 1.5) * hpRatio} ${2 * Math.PI * (radius + 1.5)}`}
                transform={`rotate(-90 ${span * RENDER_CELL / 2} ${span * RENDER_CELL / 2})`}
                style={{ transition: 'stroke-dasharray 0.5s ease' }}
              />
              {/* 头像/首字 */}
              {u.portrait ? (
                <clipPath id={`clip-${u.id}`}>
                  <circle cx={span * RENDER_CELL / 2} cy={span * RENDER_CELL / 2} r={radius - 3} />
                </clipPath>
              ) : null}
              {u.portrait ? (
                <image
                  href={u.portrait}
                  x={RENDER_CELL * span / 2 - radius + 2} y={RENDER_CELL * span / 2 - radius + 2}
                  width={(radius - 2) * 2} height={(radius - 2) * 2}
                  clipPath={`url(#clip-${u.id})`}
                  preserveAspectRatio="xMidYMid slice"
                />
              ) : (
                <text
                  x={span * RENDER_CELL / 2} y={span * RENDER_CELL / 2}
                  textAnchor="middle" dominantBaseline="central"
                  fill="rgba(0,0,0,0.8)" fontSize={radius * 0.9} fontWeight="900"
                >
                  {u.name.slice(0, 2)}
                </text>
              )}
              {/* 濒死标记 */}
              {u.hp <= 0 && (
                <text x={span * RENDER_CELL / 2} y={span * RENDER_CELL / 2 + 2} textAnchor="middle" fontSize={radius} fill="#ff6b6b">
                  ✕
                </text>
              )}
              {/* 状态图标 */}
              {u.statuses.slice(0, 4).map((s, i) => {
                const def = CONDITIONS[s];
                if (!def) return null;
                return (
                  <g key={s} transform={`translate(${span * RENDER_CELL / 2 - (Math.min(4, u.statuses.length) * 13) / 2 + i * 13}, ${span * RENDER_CELL - 6})`}>
                    <circle r="7" fill="rgba(0,0,0,0.75)" stroke={def.color} strokeWidth="1" />
                    <text textAnchor="middle" dominantBaseline="central" fontSize="8">{def.icon}</text>
                  </g>
                );
              })}
              {/* 名牌 */}
              <text
                className="token-label"
                x={span * RENDER_CELL / 2} y={-4} textAnchor="middle"
                fill={meta.color} fontSize="11" fontWeight="700"
              >
                {u.name}
              </text>
            </g>
          );
        })}

        {/* 拖拽成本提示 */}
        {draggingUnit && drag && (
          <g transform={`translate(${(drag.curX + 0.5) * RENDER_CELL}, ${(drag.curY - 0.6) * RENDER_CELL})`}>
            <rect x="-42" y="-12" width="84" height="20" rx="6"
              fill={dragCost > dragMax ? 'rgba(180,50,50,0.9)' : 'rgba(20,60,40,0.9)'}
              stroke={dragCost > dragMax ? '#ff8080' : '#6dbf5e'} strokeWidth="1" />
            <text textAnchor="middle" dominantBaseline="central" fill="white" fontSize="11" fontWeight="bold">
              {dragCost}/{dragMax} 尺{dragCost > dragMax ? ' ⚠' : ''}
            </text>
          </g>
        )}
      </svg>

      {/* 底部状态栏 */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-3 border-t border-border/40 bg-black/50 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
        <span className="flex items-center gap-1"><MousePointerClick className="h-3 w-3" />{hoverCell ? `(${hoverCell.cx * 5}, ${hoverCell.cy * 5}) 尺` : '—, —'}</span>
        <span className="flex items-center gap-1"><Swords className="h-3 w-3" />第 {turn.round} 轮</span>
        {selectedUnit && (
          <span className="text-primary">
            选中：{selectedUnit.name} · 速度剩余 {remainingMovement(selectedUnit)} 尺
          </span>
        )}
        <div className="grow" />
        <span className="hidden md:inline">拖 token 移动 · Shift+拖 平移 · 滚轮缩放</span>
      </div>
    </div>
  );
}

/** 渲染 AoE 形状 */
function renderAoe(t: AoeTemplate, hitUnitIds: string[]) {
  const c = posToCell(t.origin);
  const ox = (c.cx + 0.5) * RENDER_CELL;
  const oy = (c.cy + 0.5) * RENDER_CELL;
  const sizePx = (t.size / CELL) * RENDER_CELL;
  const id = `aoe-${t.id}`;

  let shape: React.ReactNode = null;
  switch (t.kind) {
    case 'circle': case 'sphere': case 'cylinder': {
      shape = (
        <>
          <circle cx={ox} cy={oy} r={sizePx} fill={t.color} stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeDasharray="6 4" />
          <circle cx={ox} cy={oy} r={3} fill="#fff" />
        </>
      );
      break;
    }
    case 'cube': case 'square': {
      shape = (
        <>
          <rect x={ox - sizePx / 2} y={oy - sizePx / 2} width={sizePx} height={sizePx}
            fill={t.color} stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeDasharray="6 4" rx="4" />
          <circle cx={ox} cy={oy} r={3} fill="#fff" />
        </>
      );
      break;
    }
    case 'cone': {
      const a = t.angle ?? 0;
      const arc = 60 * Math.PI / 180;
      const x1 = ox + sizePx * Math.cos(a - arc / 2);
      const y1 = oy + sizePx * Math.sin(a - arc / 2);
      const x2 = ox + sizePx * Math.cos(a + arc / 2);
      const y2 = oy + sizePx * Math.sin(a + arc / 2);
      shape = (
        <>
          <path d={`M ${ox} ${oy} L ${x1} ${y1} A ${sizePx} ${sizePx} 0 0 1 ${x2} ${y2} Z`}
            fill={t.color} stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeDasharray="6 4" />
          <circle cx={ox} cy={oy} r={3} fill="#fff" />
        </>
      );
      break;
    }
    case 'line': {
      const a = t.angle ?? 0;
      const w = RENDER_CELL;
      const dx = Math.cos(a), dy = Math.sin(a);
      const px = -dy, py = dx;
      const x1 = ox + px * w / 2, y1 = oy + py * w / 2;
      const x2 = ox - px * w / 2, y2 = oy - py * w / 2;
      const x3 = x2 + dx * sizePx, y3 = y2 + dy * sizePx;
      const x4 = x1 + dx * sizePx, y4 = y1 + dy * sizePx;
      shape = (
        <>
          <polygon points={`${x1},${y1} ${x2},${y2} ${x3},${y3} ${x4},${y4}`}
            fill={t.color} stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeDasharray="6 4" />
          <circle cx={ox} cy={oy} r={3} fill="#fff" />
        </>
      );
      break;
    }
  }

  return (
    <g key={id} style={{ cursor: 'pointer' }}>
      {shape}
      {t.label && (
        <text x={ox} y={oy - 8} textAnchor="middle" fontSize="11" fontWeight="700"
          fill="rgba(255,255,255,0.9)" className="token-label">
          {t.label}
        </text>
      )}
    </g>
  );
}

/** 两格之间的直线刷子（掩体绘制） */
function paintLine(from: Cell, to: Cell): Cell[] {
  const cells: Cell[] = [];
  let x = from.cx, y = from.cy;
  const dx = Math.abs(to.cx - x), dy = Math.abs(to.cy - y);
  const sx = x < to.cx ? 1 : -1, sy = y < to.cy ? 1 : -1;
  let err = dx - dy;
  let guard = 0;
  while (guard++ < 200) {
    cells.push({ cx: x, cy: y });
    if (x === to.cx && y === to.cy) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return cells;
}
