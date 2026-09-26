'use client';

/**
 * 角色名单面板：把酒馆 <UpdateVariable> 变量流变成可战斗的角色卡
 * - 粘贴含 <UpdateVariable> 的 DM 消息 → 变量树累积 → 角色名单自动同步
 * - 角色卡预览：HP/AC/六维/武器（含命中与伤害公式）/法术位/法术书
 * - 一键上阵：玩家身份 / 队友身份（默认 AI 托管，可切换玩家操控）
 */
import React, { useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import type { CharSheet } from '@/lib/engine/sheetbridge';
import { DAMAGE_TYPE_TO_CN } from '@/lib/engine/statblocks';
import { abilityMod, proficiencyBonus } from '@/lib/engine/rules';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ClipboardPaste, UserPlus, Bot, RefreshCw, Trash2, Swords, Wand2 } from 'lucide-react';

const ABILITY_NAMES: Record<string, string> = { str: '力', dex: '敏', con: '体', int: '智', wis: '感', cha: '魅' };

function SheetCard({ sheet }: { sheet: CharSheet }) {
  const store = useBattleStore();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/40 bg-card/60 p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-bold text-sky-300">{sheet.name}</span>
        <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">Lv.{sheet.level}</span>
        <span className="font-mono text-[11px] text-muted-foreground">HP {sheet.hp}/{sheet.maxHp} · AC {sheet.ac} · 先攻{sheet.initMod >= 0 ? '+' : ''}{sheet.initMod}</span>
        <div className="grow" />
        <div className="flex gap-1">
          <Button size="sm" className="h-7 gap-1 bg-primary px-2 text-[10px] text-primary-foreground"
            onClick={() => store.addUnitFromSheet(sheet.name, true)} title="以玩家身份上阵">
            <UserPlus className="h-3 w-3" />玩家
          </Button>
          <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-[10px]"
            onClick={() => store.addUnitFromSheet(sheet.name, false)} title="以队友身份上阵（AI 托管，可切换操控）">
            <Bot className="h-3 w-3" />队友
          </Button>
          <button className="rounded p-1 text-muted-foreground hover:bg-red-500/20 hover:text-red-300"
            title="从名单移除" onClick={() => store.rosterRemove(sheet.name)}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground">
        {Object.entries(sheet.abilities).map(([k, v]) => (
          <span key={k}>{ABILITY_NAMES[k]} {v}({Math.floor((v - 10) / 2) >= 0 ? '+' : ''}{Math.floor((v - 10) / 2)})</span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-primary"
          onClick={() => setExpanded(v => !v)}
        >
          <Swords className="h-3 w-3" />
          武器 {sheet.weapons.length} · 法术书 {sheet.spells.length}（{sheet.spells.filter(s => s.matched || s.custom).length} 可结算）
          {sheet.traitActions.length > 0 ? ` · 特性动作 ${sheet.traitActions.length}` : ''}
          {expanded ? ' ▴' : ' ▾'}
        </button>
        {sheet.spellSlots && (
          <span className="flex flex-wrap items-center gap-1">
            <Wand2 className="h-3 w-3 text-muted-foreground" />
            {Object.entries(sheet.spellSlots).map(([lv, s]) => (
              <span key={lv} className={cn('rounded px-1 font-mono text-[10px]', s.current > 0 ? 'bg-violet-500/15 text-violet-300' : 'bg-black/40 text-muted-foreground')}>
                {lv}环{s.current}/{s.max}
              </span>
            ))}
          </span>
        )}
        {sheet.statuses.length > 0 && (
          <span className="text-[10px] text-amber-300">状态：{sheet.statuses.join('、')}</span>
        )}
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/30 bg-black/25 p-2 text-[10px]">
          {sheet.weapons.length > 0 && (
            <div className="flex flex-col gap-1">
              {sheet.weapons.map(w => {
                const mod = abilityMod(sheet.abilities[w.ability] ?? 10);
                const pb = proficiencyBonus(sheet.level);
                const toHit = mod + (w.proficient ? pb : 0) + w.magicBonus;
                return (
                  <div key={w.name} className="flex flex-wrap items-center gap-x-2">
                    <span className={cn('font-semibold', w.equipped ? 'text-foreground' : 'text-muted-foreground')}>
                      {w.equipped ? '⭐' : '·'} {w.name}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      命中 +{toHit} · 伤害 {w.formula}{mod + w.magicBonus >= 0 ? '+' : ''}{mod + w.magicBonus} {w.damageType ? DAMAGE_TYPE_TO_CN[w.damageType] : ''}
                    </span>
                    {w.ranged && <span className="text-sky-300">远程 {w.range}尺</span>}
                  </div>
                );
              })}
            </div>
          )}
          {sheet.spells.length > 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {sheet.spells.map(s => (
                <span key={s.name} className={cn(s.matched || s.custom ? 'text-violet-300' : 'text-muted-foreground')}
                  title={s.custom ? '自定义结构化法术：按敌卡解析器自动结算' : s.matched ? '内置法术库命中：自动结算' : '未匹配内置库且无结构化字段：仅展示，不可自动结算'}>
                  {s.matched ? '✨' : s.custom ? '🛠' : '○'}{s.name}（{s.level === 0 ? '戏法' : `${s.level}环`}{s.prepared ? '·已准备' : ''}）
                </span>
              ))}
            </div>
          )}
          {sheet.traitActions.length > 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {sheet.traitActions.map(a => (
                <span key={a.name} className="text-emerald-300" title="特性动作：结构化字段自动结算">
                  ⚡{a.name}（{a.dice}{a.saveAbility ? ` · ${a.saveAbility.toUpperCase()}豁免DC${a.saveDc ?? '?'}` : ''}）
                </span>
              ))}
            </div>
          )}
          {sheet.weapons.length === 0 && sheet.spells.length === 0 && sheet.traitActions.length === 0 && (
            <span className="text-muted-foreground">无武器与法术数据 —— 检查变量中的 物品.武器 / 施法.法术书 字段</span>
          )}
        </div>
      )}
    </div>
  );
}

export function RosterPanel() {
  const store = useBattleStore();
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const doImport = () => {
    if (!text.trim()) return;
    const before = store.rosterSheets.length;
    store.importDmMessage(text, 'import');
    const after = store.rosterSheets.length;
    setFeedback(after > before
      ? `✅ 已同步 —— 名单 ${after} 人（新增 ${after - before}）`
      : '✅ 已处理（名单人数未变：变量树已累积更新）');
    setText('');
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 导入区 */}
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
          <ClipboardPaste className="h-3.5 w-3.5" />粘贴含 <code className="text-primary">&lt;UpdateVariable&gt;</code> 的 DM 消息
        </span>
        <textarea
          className="log-scroll h-24 w-full resize-none rounded-lg border border-border/50 bg-black/30 p-2 font-mono text-[10px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          placeholder={'<UpdateVariable>\n<JSONPatch>\n[\n  { "op": "replace", "path": "/角色列表/艾尔玛/生命值/当前", "value": 24 },\n  { "op": "delta", "path": "/角色列表/艾尔玛/施法/法术位/1环/当前", "value": -1 }\n]\n</JSONPatch>\n</UpdateVariable>\n\n（也可以直接粘贴完整 DM 回复，含 <battle>/<encounter> 也没关系）'}
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" className="h-8 gap-1 bg-primary text-[11px] text-primary-foreground" onClick={doImport} disabled={!text.trim()}>
            同步变量
          </Button>
          <Button size="sm" variant="secondary" className="h-8 gap-1 text-[11px]"
            onClick={() => { const names = store.syncRosterFromTree(); setFeedback(`已从变量树重建名单：${names.length} 人${names.length ? '（' + names.join('、') + '）' : ''}`); }}>
            <RefreshCw className="h-3.5 w-3.5" />从变量树重建
          </Button>
          {feedback && <span className="text-[10px] text-muted-foreground">{feedback}</span>}
        </div>
      </div>

      {/* 名单 */}
      {store.rosterSheets.length > 0 ? (
        <div className="flex flex-col gap-2">
          {store.rosterSheets.map(s => <SheetCard key={s.name} sheet={s} />)}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/50 p-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          名单为空。跑团时把 DM 消息粘贴到上方即可自动建档：<br />
          等级 / 生命值 / AC / 六维 / 武器（自动算命中与伤害）/ 法术位 / 法术书 / 状态。<br />
          <span className="text-primary/80">&lt;battle&gt;</span> 触发时，同名单位会自动装配这里的数据。
        </div>
      )}
    </div>
  );
}
