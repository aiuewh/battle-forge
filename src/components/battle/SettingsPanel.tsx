'use client';

/**
 * 规则设置面板：2024/2014 规则切换、地图配置
 */
import React from 'react';
import { useBattleStore } from '@/store/battleStore';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RULES_2024_NOTES } from '@/lib/engine/rules';
import { BookOpen, Map } from 'lucide-react';

export function SettingsPanel() {
  const store = useBattleStore();
  const { rules, mapConfig } = store;

  const toggles = [
    {
      key: 'critWeaponDiceOnly' as const,
      label: '重击仅翻倍武器骰（2024）',
      desc: '开启：重击只翻倍武器伤害骰；关闭：2014 规则全部伤害骰翻倍（含神能/偷袭等附加骰）',
    },
    {
      key: 'failOnDropToZero' as const,
      label: '跌至 0 HP 记 1 次死亡豁免失败',
      desc: '2024 规则：倒地时立即记一次失败',
    },
    {
      key: 'failOnDamageAtZero' as const,
      label: '0 HP 受伤记失败（重击记 2 次）',
      desc: '濒死时受任何伤害 +1 失败，重击 +2 失败',
    },
    {
      key: 'minDamageOne' as const,
      label: '伤害最低 1 点（房规）',
      desc: '抗性减免后至少造成 1 点伤害',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* 规则开关 */}
      <div className="flex flex-col gap-3">
        {toggles.map(t => (
          <div key={t.key} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Label className="text-xs font-medium text-foreground">{t.label}</Label>
              <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{t.desc}</p>
            </div>
            <Switch checked={rules[t.key]} onCheckedChange={v => store.setRules({ [t.key]: v })} />
          </div>
        ))}

        <div className="flex items-start justify-between gap-3">
          <div>
            <Label className="text-xs font-medium text-foreground">结算权威</Label>
            <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">面板=先攻由面板掷骰、战斗中 AI 数据不覆盖已结算数值（推荐）；<br />兼容旧卡=先攻/数值以 AI 块为准（旧协议每楼结算流）</p>
          </div>
          <div className="flex gap-1">
            {([['panel', '面板'], ['ai-legacy', '兼容旧卡']] as const).map(([v, label]) => (
              <button key={v}
                onClick={() => store.setRules({ authorityMode: v })}
                className={`rounded-md border px-2 py-0.5 text-[10px] ${rules.authorityMode === v ? 'border-primary bg-primary/20 text-primary' : 'border-border/50 text-muted-foreground'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <Label className="text-xs font-medium text-foreground">突袭规则</Label>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">2024：被突袭单位先攻劣势；2014：首轮不能行动</p>
          </div>
          <div className="flex gap-1">
            {([['init-disadvantage', '2024'], ['skip-turn', '2014'], ['none', '关闭']] as const).map(([v, label]) => (
              <button key={v}
                onClick={() => store.setRules({ surpriseMode: v })}
                className={`rounded-md border px-2 py-0.5 text-[10px] ${rules.surpriseMode === v ? 'border-primary bg-primary/20 text-primary' : 'border-border/50 text-muted-foreground'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <Label className="text-xs font-medium text-foreground">对角线移动</Label>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">equal=每格5尺；alt=5-10-5 交替（DMG变体）</p>
          </div>
          <div className="flex gap-1">
            {([['equal', '5-5-5'], ['alt', '5-10-5']] as const).map(([v, label]) => (
              <button key={v}
                onClick={() => { store.setRules({ diagonal: v }); store.setMapConfig({ diagonal: v }); }}
                className={`rounded-md border px-2 py-0.5 text-[10px] ${rules.diagonal === v ? 'border-primary bg-primary/20 text-primary' : 'border-border/50 text-muted-foreground'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
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
