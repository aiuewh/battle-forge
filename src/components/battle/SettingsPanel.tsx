'use client';

/**
 * 规则设置面板：房规模块库（分组陈列 · 来源标注 · 自由组合）+ 地图配置
 * 模块清单与语义来自 lib/engine/types 的 HOUSE_RULE_MODULES 注册表，
 * 结算点只读 RulesConfig 字段——新增房规只需扩展注册表与对应结算分支。
 */
import React from 'react';
import { useBattleStore } from '@/store/battleStore';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RULES_2024_NOTES } from '@/lib/engine/rules';
import { DEFAULT_RULES, HOUSE_RULE_MODULES, HOUSE_RULE_SOURCE_LABEL, type HouseRuleSource } from '@/lib/engine/types';
import { BookOpen, Map } from 'lucide-react';

/** 来源徽标配色：RAW 绿 / 官方变体蓝 / 官方草案紫 / 社区房规橙 */
const SOURCE_STYLE: Record<HouseRuleSource, string> = {
  'raw': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  'official-variant': 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  'one-dd-draft': 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  'community': 'border-amber-500/40 bg-amber-500/10 text-amber-300',
};

export function SettingsPanel() {
  const store = useBattleStore();
  const { rules, mapConfig } = store;

  // 按注册表分组（保持注册顺序）
  const groups: { group: string; modules: typeof HOUSE_RULE_MODULES }[] = [];
  for (const m of HOUSE_RULE_MODULES) {
    let g = groups.find(x => x.group === m.group);
    if (!g) { g = { group: m.group, modules: [] }; groups.push(g); }
    g.modules.push(m);
  }

  const renderModule = (m: (typeof HOUSE_RULE_MODULES)[number]) => {
    const value = (rules as unknown as Record<string, unknown>)[m.field];
    return (
      <div key={m.id} className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs font-medium text-foreground">{m.name}</Label>
            <span className={`rounded-full border px-1.5 py-px text-[9px] leading-tight ${SOURCE_STYLE[m.source]}`}>
              {HOUSE_RULE_SOURCE_LABEL[m.source]}
            </span>
          </div>
          <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{m.description}</p>
        </div>
        {m.choices ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {m.choices.map(c => {
              const active = value === c.value
                // 兼容旧持久化的 critWeaponDiceOnly 布尔：显示为对应模式选中态
                || (m.field === 'critMode' && value === undefined && c.value === 'full-double' && (rules as unknown as Record<string, unknown>).critWeaponDiceOnly !== true);
              const diag = m.field === 'diagonal';
              return (
                <button key={c.value}
                  onClick={() => {
                    store.setRules({ [m.field]: c.value } as never);
                    // 对角线模式同步地图渲染配置
                    if (diag) store.setMapConfig({ diagonal: c.value as 'equal' | 'alt' });
                  }}
                  className={`rounded-md border px-2 py-0.5 text-[10px] ${active ? 'border-primary bg-primary/20 text-primary' : 'border-border/50 text-muted-foreground'}`}>
                  {c.label}
                </button>
              );
            })}
          </div>
        ) : (
          <Switch checked={value === true}
            onCheckedChange={v => store.setRules({ [m.field]: v } as never)} />
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 房规模块库 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold tracking-wide text-muted-foreground">房规模块库 · 自由组合</Label>
          <button
            onClick={() => { store.setRules({ ...DEFAULT_RULES }); store.setMapConfig({ diagonal: DEFAULT_RULES.diagonal }); }}
            className="rounded-md border border-border/50 px-2 py-1 text-[10px] text-muted-foreground hover:border-primary hover:text-primary">
            ↺ 恢复 2024 官方默认
          </button>
        </div>
        <p className="text-[10.5px] leading-snug text-muted-foreground">
          每个模块独立生效、可任意组合；徽标标注出处（2024 RAW / 官方变体 / 官方草案 / 社区房规）。战斗进行中修改即时生效。
        </p>
        {groups.map(g => (
          <div key={g.group} className="rounded-xl border border-border/40 bg-black/25 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{g.group}</div>
            <div className="flex flex-col gap-3">
              {g.modules.map(renderModule)}
            </div>
          </div>
        ))}
      </div>

      {/* 地图配置 */}
      <div className="rounded-xl border border-border/40 bg-black/25 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Map className="h-3.5 w-3.5" />地图尺寸
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">宽（格）</span>
            <Input className="h-8 border-border/50 bg-black/30 text-center text-sm" type="number" min={10} max={60}
              value={mapConfig.width}
              onChange={e => store.setMapConfig({ width: Math.max(10, Math.min(60, parseInt(e.target.value, 10) || 30)) })} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">高（格）</span>
            <Input className="h-8 border-border/50 bg-black/30 text-center text-sm" type="number" min={8} max={40}
              value={mapConfig.height}
              onChange={e => store.setMapConfig({ height: Math.max(8, Math.min(40, parseInt(e.target.value, 10) || 20)) })} />
          </label>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">当前 {mapConfig.width * 5}×{mapConfig.height * 5} 尺</p>
      </div>

      {/* 规则速查 */}
      <div className="rounded-xl border border-border/40 bg-black/25 p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />2024 规则速查
        </div>
        <ul className="flex flex-col gap-1">
          {RULES_2024_NOTES.map((n, i) => (
            <li key={i} className="text-[10.5px] leading-snug text-muted-foreground">· {n}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
