from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'src/components/battle/BattleMapIso.tsx'
t=p.read_text(encoding='utf-8')
t=t.replace('  const fittedRef =', '  const invalidateRef = useRef<() => void>(() => {});\n  const visibleRef = useRef(true);\n  const fittedRef =')
t=t.replace('      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);', '      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);\n      invalidateRef.current();')
t=t.replace('    const usableH = workspace ? Math.max(180, h - 220) : h;', "    const hudHeight = boundary?.querySelector('.token-hud')?.getBoundingClientRect().height ?? 180;\n    const usableH = workspace ? Math.max(130, h - hudHeight - 150) : h;")
t=t.replace('    };\n  }, [workspace]);', '    };\n    invalidateRef.current();\n  }, [workspace, boundary]);')
t=t.replace('    let raf = 0;\n    const draw = (time: number) => {\n      raf = requestAnimationFrame(draw);', '''    let raf = 0;
    let disposed = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wake = () => { if (!disposed && !raf && visibleRef.current && !document.hidden) raf = requestAnimationFrame(draw); };
    const draw = (time: number) => {
      raf = 0;
      if (disposed || document.hidden || !visibleRef.current) return;''')
t=t.replace('      const t = time;', '''      const t = reduced ? 0 : time;
      let animating = false;
      canvas.dataset.renderCount = String(Number(canvas.dataset.renderCount ?? 0) + 1);
      const labelRects: Array<{x:number;y:number;w:number;h:number}> = [];
      const placeLabel = (x:number,y:number,w:number,h:number) => {
        let ly = y;
        for (let attempt=0; attempt<7 && labelRects.some(r => Math.abs(x-r.x)<(w+r.w)/2 && Math.abs(ly-r.y)<(h+r.h)/2); attempt++) ly -= h + 4;
        labelRects.push({x,y:ly,w,h}); return ly;
      };''')
# Idle frame has no bob/spin; transient effects and movement retain animations.
t=t.replace('const bob = isDead || isDown ? 0 : Math.sin(t * 0.0035 + strHash(u.id) % 10) * 2.6 * cam.scale;', 'const bob = 0;')
t=t.replace('const pulse = 0.55 + 0.35 * Math.sin(t * 0.006);', 'const pulse = 0.9;')
t=t.replace('t * 0.04, 3', '0, 3').replace('-t * 0.05, 2', '0, 2').replace('t * 0.03, 2.5', '0, 2.5')
t=t.replace('spin: Math.sin(t * swingSpeed + swingPhase) * 0.6,', 'spin: Math.sin(swingPhase) * 0.18,')
t=t.replace("const swingSpeed = s.battleActive && s.turn.currentUnitId === u.id ? 0.0024 : 0.0009;", '')
t=t.replace('const isDown = u.hp <= 0 && !isDead;', "const isDown = (u.hp <= 0 || u.knockedOut || u.statuses.includes('unconscious')) && !isDead;")
t=t.replace('          prev.x += (target.x - prev.x) * 0.22;', '          animating = true;\n          prev.x += (target.x - prev.x) * 0.22;')
t=t.replace('if (lunge && t - lunge.born < 260) {', 'if (!reduced && lunge && t - lunge.born < 260) {\n              animating = true;')
t=t.replace('            // 光环：', "            drawCellOverlay(ctx, proj, Math.floor(centerG.x), Math.floor(centerG.y), u.attitude === 2 ? 'rgba(160,55,40,.25)' : 'rgba(45,120,105,.22)', u.attitude === 2 ? '#b76c5d' : '#6ebfad');\n            // 光环：")
t=t.replace("            if (isDead) return;", "            if (isDead) { drawLabel(ctx, cp.x, groundY - 14, '† 阵亡', '#a8a6a0', cam.scale, 11); return; }")
# Draw initials on allied tokens and an explicit KO label.
t=t.replace("              if (isDown) {", "              if (!isDown) drawLabel(ctx, cp.x + ox, groundY - r * 0.85 + oy, u.name.slice(0,1), '#e5fff4', cam.scale, 13);\n              if (isDown) {")
t=t.replace("drawLabel(ctx, cp.x, groundY - r * 0.5, '✚'", "drawLabel(ctx, cp.x, groundY - r * 0.5, u.knockedOut ? '昏迷' : '✚'")
# See source-specific label positioning below; only emit a redraw when needed.
t=t.replace('    raf = requestAnimationFrame(draw);\n    return () => cancelAnimationFrame(raf);', '''    invalidateRef.current = wake;
    const unsubStore = useBattleStore.subscribe(wake), unsubSelection = useActionUiStore.subscribe(wake);
    const canvas = canvasRef.current;
    const onVisibility = () => { if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0; } else wake(); };
    document.addEventListener('visibilitychange', onVisibility);
    const io = new IntersectionObserver(entries => { visibleRef.current = entries[0].isIntersecting; if (visibleRef.current) wake(); else if (raf) { cancelAnimationFrame(raf); raf=0; } });
    if (canvas) { io.observe(canvas); for (const event of ['pointermove','pointerdown','pointerup','wheel']) canvas.addEventListener(event, wake, { passive: true }); }
    wake();
    return () => { disposed = true; cancelAnimationFrame(raf); unsubStore(); unsubSelection(); io.disconnect(); document.removeEventListener('visibilitychange', onVisibility); if (canvas) for (const event of ['pointermove','pointerdown','pointerup','wheel']) canvas.removeEventListener(event, wake); invalidateRef.current = () => {}; };''')
# Wake for non-pointer camera controls and safe-area adjustment.
t=t.replace("  }, [tool, aoePreset, hoverInfo]);", "  }, [tool, aoePreset, hoverInfo]);\n\n  useEffect(() => {\n    invalidateRef.current();\n    if (!workspace || !actionUi.targetId) return;\n    const unit = store.units.find(u => u.id === actionUi.targetId);\n    const hudHeight = boundary?.querySelector('.token-hud')?.getBoundingClientRect().height ?? 180;\n    if (!unit) return;\n    const point = makeProjector(camRef.current).p(unit.pos.x / 5 + .5, unit.pos.y / 5 + .5);\n    const limit = sizeRef.current.h - hudHeight - 45;\n    if (point.y > limit) { camRef.current.panY -= point.y - Math.max(160, limit - 45); invalidateRef.current(); }\n  }, [actionUi.targetId, actionUi.request, workspace, boundary, store.units]);")
t=t.replace("['half','半身掩体']]", "['half','半身掩体'],['difficult','困难地形']]")
# Request next frame only while transient effects/position interpolation are alive.
t=t.replace('      void hoverInfo;', '      void hoverInfo;\n      if (!reduced && (animating || floatsRef.current.length > 0 || slashesRef.current.length > 0)) wake();')
t=t.replace("const cost = gridDistanceCells({ cx: dd.startX, cy: dd.startY }, { cx: dd.curX, cy: dd.curY }, s.mapConfig.diagonal) * CELL;", "const route = movementPreview(dragUnit, { cx: dd.curX, cy: dd.curY }, s.units, s.obstacles, s.mapConfig, s.battleActive, s.turn.currentUnitId);\n        const cost = route.cost;")
t=t.replace('        const valid = cost <= max;', '        const valid = !route.reason;')
t=t.replace('        ctx.lineTo(p.x, p.y);\n        ctx.stroke();', '        for (const c of route.path.slice(1)) { const step = proj.p(c.cx + .5, c.cy + .5); ctx.lineTo(step.x, step.y); }\n        ctx.stroke();', 1)
p.write_text(t,encoding='utf-8')
p=root/'src/app/globals.css'
t=p.read_text(encoding='utf-8')
t=t.replace('top: 82px; left: 65px;', 'top: 105px; left: 65px;')
t=t.replace('top: 90px; left: 12px;', 'top: 112px; left: 12px;').replace('top: 85px; right: 12px;', 'top: 112px; right: 12px;')
t=t.replace('z-index: 35; bottom: 14px;', 'z-index: 35; flex-wrap: wrap; bottom: 14px;')
t=t.replace('  .stage-map-tools { top: 80px;', '  .stage-map-tools { top: 124px;').replace('  .stage-inspector { top: 78px;', '  .stage-inspector { top: 124px;')
t=t.replace('left: 55px; top: 75px;', 'left: 55px; top: 108px;')
t+='''
/* Shared warm neutral palette; gold marks choices and teal marks recovery. */
.battle-workspace { --hud-surface: #242522; --hud-raised: #343630; --hud-border: #565b50; --hud-muted: #bec5b5; --hud-gold: #e5bd7d; --hud-ink: #f2f0e8; }
.stage-title, .hud-menu, .battle-dialog { background: #242522f5; color: #f2f0e8; }
.hud-menu { max-height: min(330px, calc(100dvh - 150px), var(--radix-popover-content-available-height)); border-color: #66705c; }
.hud-menu-arrow { fill: #242522; }
.hud-command-area { min-width: 0; flex: 1 1 380px; }
.hud-status-strip { flex: 1 0 100%; }
.hud-economy > span:not(:first-child) { padding: 2px 5px; border-radius: 4px; background: #234b3e; color: #a9dfc8; }
.hud-economy > span.spent { background: #353631; color: #a5a99d; text-decoration: none; }
@media (max-width: 800px) {
  .stage-turn-preview { top: 71px; left: 8px; right: 8px; }
  .stage-turn-preview button { max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
  .hud-command-area { flex: initial; }
  .hud-menu { max-height: min(270px, calc(100dvh - 180px), var(--radix-popover-content-available-height)); }
  .hud-status-strip { flex: initial; }
  .hud-preview-line { max-height: 85px; overflow-y: auto; }
  .battle-workspace .stage-header-buttons button, .battle-workspace .stage-map-tool-button { min-height: 44px !important; width: 44px; }
}
@media (max-height: 620px) and (min-width: 801px) { .battle-workspace { height: max(440px, 92dvh); } .hud-menu { max-height: 220px; } }
@media (prefers-reduced-motion: reduce) { .battle-workspace *, .hud-menu * { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
'''
p.write_text(t,encoding='utf-8')
