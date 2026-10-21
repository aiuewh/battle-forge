'use client';
import React, { useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { useActionUiStore } from '@/store/actionUiStore';
import { conditionName } from '@/lib/engine/conditions';
import { ENGINE_VERSION, SAVE_VERSION, PROTOCOL_VERSION } from '@/lib/engine/version';
import { BattleMapIso } from './BattleMapIso';
import { InitiativeTrackerStrip } from './InitiativeTrackerStrip';
import { ActionBar } from './ActionBar';
import { HudMenu } from './HudMenu';
import { InitiativeBar } from './InitiativeBar';
import { UnitDetailCard } from './UnitDetailCard';
import { BattleLog } from './BattleLog';
import { ReportSendButton } from './ReportSendButton';
import { AttackPanel } from './AttackPanel';
import { DiceRoller } from './DiceRoller';
import { MonsterPicker } from './MonsterPicker';
import { RosterPanel } from './RosterPanel';
import { EnemyDesigner } from './EnemyDesigner';
import { ImportPanel, ExportPanel } from './ImportExportPanel';
import { SettingsPanel } from './SettingsPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ListOrdered, ScrollText, MoreHorizontal, X, Maximize2 } from 'lucide-react';

export function BattleWorkspace({ compact = false }: { compact?: boolean }) {
  const store = useBattleStore();
  const ui = useActionUiStore();
  const [boundary, setBoundary] = useState<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<'initiative' | 'more' | null>(null);
  const [panel, setPanel] = useState<'log' | 'unit' | 'tools' | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState('');
  const [showNext, setShowNext] = useState(true);
  const current = store.units.find(u => u.id === store.turn.currentUnitId);
  const selected = store.units.find(u => u.id === store.selectedId);
  const inspected = selected && selected.id !== current?.id && !ui.request && !ui.movingActorId ? selected : null;
  const recent = [...store.events].reverse().find(e => ['attack', 'damage', 'heal', 'save', 'move'].includes(e.type));
  const showUnit = (id: string) => { setDetailId(id); setPanel('unit'); };
  const copyReport = async () => {
    try { await navigator.clipboard.writeText(store.generateBattleResult()); setCopyNote('战报已复制'); }
    catch { setCopyNote('复制失败，请到导入导出里手动选择战报'); }
  };
  async function fullscreen() {
    // Optional enhancement; the stage continues working if the host disallows fullscreen.
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (boundary?.requestFullscreen) await boundary.requestFullscreen();
    } catch { setCopyNote('宿主未开放全屏权限，当前战场仍可正常操作'); }
  }

  return <div ref={setBoundary} data-testid="battle-stage" className={`battle-workspace ${compact ? 'battle-workspace-embedded' : ''}`}>
    <BattleMapIso workspace boundary={boundary} onInspect={showUnit} />
    <InitiativeTrackerStrip />
    <div className="stage-header">
      <div className="stage-title"><strong>{store.battleName}</strong><span>{store.battleActive ? `第 ${store.turn.round} 轮 · ${current?.name ?? '等待行动'}` : store.turn.round > 0 ? '战斗已结束' : '准备开战'}{store.readOnly ? ' · 同步视图' : ''}</span></div>
      <div className="stage-header-buttons">
        {!store.battleActive && store.turn.round === 0 && <button disabled={store.readOnly} onClick={() => store.startCombat()}>掷先攻·开战</button>}
        <HudMenu boundary={boundary} open={menu === 'initiative'} onOpenChange={v => setMenu(v ? 'initiative' : null)} side="bottom" align="end" label="战斗先攻"
          trigger={<button aria-label="先攻顺序"><ListOrdered size={18}/><span>先攻</span></button>}>
          <div className="hud-menu-heading"><strong>先攻顺序</strong><button aria-label="关闭先攻" onClick={() => setMenu(null)}><X size={16}/></button></div><InitiativeBar compact showControls={false} />
        </HudMenu>
        <button aria-label="战斗记录" onClick={() => setPanel('log')}><ScrollText size={18}/><span>记录</span></button>
        <button className="stage-fullscreen" aria-label="全屏战场" disabled={typeof document !== 'undefined' && !document.fullscreenEnabled} title="全屏战场（需要宿主允许）" onClick={() => { void fullscreen(); }}><Maximize2 size={18}/></button>
        <HudMenu boundary={boundary} open={menu === 'more'} onOpenChange={v => setMenu(v ? 'more' : null)} side="bottom" align="end" label="战场菜单"
          trigger={<button aria-label="战场菜单"><MoreHorizontal size={20}/></button>}>
          <div className="hud-menu-heading"><strong>战场菜单</strong><button aria-label="关闭战场菜单" onClick={() => setMenu(null)}><X size={16}/></button></div>
          <div className="hud-menu-list">
            <small className="hud-version">引擎 {ENGINE_VERSION} · 存档 v{SAVE_VERSION} · 协议 v{PROTOCOL_VERSION}</small>
            <label className="hud-setting"><span>AI 自动行动</span><input type="checkbox" disabled={store.readOnly} checked={store.aiAutoPlay} onChange={e => store.setAiAutoPlay(e.target.checked)}/></label>
            <label className="hud-setting"><span>AI 速度</span><select disabled={store.readOnly} value={store.aiSpeed} onChange={e => store.setAiSpeed(Number(e.target.value))}><option value={900}>慢</option><option value={450}>标准</option><option value={220}>快</option><option value={80}>极速</option></select></label>
            <button className="hud-list-item" disabled={store.readOnly || !store.turnSnap} onClick={() => { store.resetCurrentTurn(); setMenu(null); }}><span>重置本回合</span><small>恢复当前回合起点，暂停 AI</small></button>
            <button className="hud-list-item" disabled={store.readOnly || !store.undoStack.length} onClick={() => { store.undoTurn(); setMenu(null); }}><span>回到上一回合</span><small>独立回退历史回合</small></button>
            <div className="hud-report"><ReportSendButton copy={() => { void copyReport(); }}/><button onClick={() => { void copyReport(); }}>复制战报</button>{copyNote && <small role="status">{copyNote}</small>}</div>
            <button className="hud-list-item" onClick={() => { setMenu(null); setPanel('tools'); }}><span>规则与工具</span><small>骰子、角色、敌卡、导入导出与手动结算</small></button>
            <button className="hud-list-item hud-danger" disabled={store.readOnly || !store.battleActive || !!store.pendingReactionStep} onClick={() => { if (window.confirm('结束当前战斗？')) { store.endCombat(); setMenu(null); } }}><span>结束战斗</span></button>
          </div>
        </HudMenu>
      </div>
    </div>
    {store.battleActive && <div className="stage-turn-preview">
      <button aria-label={showNext ? '收起回合摘要' : '展开回合摘要'} onClick={() => setShowNext(!showNext)}>{showNext ? '接下来 ›' : '先攻 ›'}</button>
      {showNext && [1,2,3].map(offset => { const id = store.turn.order[(store.turn.turnIndex + offset) % Math.max(1, store.turn.order.length)]; const unit = store.units.find(u => u.id === id); return unit && unit.id !== current?.id ? <button key={`${id}-${offset}`} onClick={() => store.setSelectedId(id)}><span className={`turn-side side-${unit.attitude}`}/>{unit.name}</button> : null; })}
    </div>}
    {inspected && <div className="stage-inspector">
      <div><strong>{inspected.name}</strong><button aria-label="关闭单位速览" onClick={() => store.setSelectedId(null)}><X size={15}/></button></div>
      <span>HP {Math.max(0, inspected.hp)}/{inspected.maxHp} · AC {inspected.ac}</span>
      {inspected.statuses.length > 0 && <small>{inspected.statuses.map(conditionName).join('、')}</small>}
      <button onClick={() => showUnit(inspected.id)}>查看完整人物卡</button>
    </div>}
    {recent && <button className="stage-recent" onClick={() => setPanel('log')} title={recent.text}>{recent.text}</button>}
    {copyNote && menu !== 'more' && <div className="stage-notice" role="status">{copyNote}<button aria-label="关闭战场提示" onClick={() => setCopyNote('')}><X size={14}/></button></div>}
    <ActionBar key={store.interactionEpoch} compact={compact} boundary={boundary} onInspect={showUnit}/>
    <Dialog open={!!panel} onOpenChange={v => { if (!v) setPanel(null); }}>
      <DialogContent portalContainer={boundary} className="dnd-theme battle-dialog"><DialogHeader><DialogTitle>{panel === 'log' ? '战斗记录' : panel === 'unit' ? '人物卡' : '规则与工具'}</DialogTitle></DialogHeader>
        {panel === 'log' && <BattleLog />}
        {panel === 'unit' && <fieldset disabled={store.readOnly}><UnitDetailCard unitId={detailId}/></fieldset>}
        {panel === 'tools' && <Tabs defaultValue="rules"><TabsList className="battle-tool-tabs">
          {([['rules','规则'],['dice','骰子'],['units','单位'],['roster','角色'],['enemy','敌卡'],['io','导入导出'],['manual','手动结算']] as const).map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
        </TabsList><fieldset disabled={store.readOnly} className="battle-tool-body">
          <TabsContent value="rules"><SettingsPanel/></TabsContent><TabsContent value="dice"><DiceRoller/></TabsContent><TabsContent value="units"><MonsterPicker/></TabsContent><TabsContent value="roster"><RosterPanel/></TabsContent><TabsContent value="enemy"><EnemyDesigner/></TabsContent><TabsContent value="io"><ImportPanel/><ExportPanel/></TabsContent><TabsContent value="manual"><AttackPanel defaultAttackerId={store.turn.currentUnitId}/></TabsContent>
        </fieldset></Tabs>}
      </DialogContent>
    </Dialog>
  </div>;
}
