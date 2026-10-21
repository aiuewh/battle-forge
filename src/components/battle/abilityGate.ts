/**
 * 动作可用性门控：ActionBar 与 token 快捷菜单共用的单一事实来源
 */
import { useBattleStore } from '@/store/battleStore';
import { aggregateEffects } from '@/lib/engine/conditions';
import { resolveCastSlot } from '@/lib/engine/rules';
import type { AiAbility, BattleUnit } from '@/lib/engine/types';

export function abilityDisabledReason(actor: BattleUnit, a: AiAbility, opts: { locked: boolean; isCurrent: boolean }): string | null {
  const store = useBattleStore.getState();
  if (opts.locked) return store.readOnly ? '同步视图，请在最新面板操作' : '等待当前行动者或反应结算';
  const alive = actor.hp > 0 && !actor.deathSaves?.dead;
  const noActions = aggregateEffects(actor.statuses).noActions;
  if (!alive || noActions) return '当前无法行动';
  if (a.reaction) return '反应法术需在对应触发时机使用';
  if (store.battleActive && (a.spellLevel ?? 0) > 0 && actor.slotCastThisTurn) return '本回合已消耗法术位施法';
  const uses = actor.abilityUses?.[a.id];
  if (uses && ((uses.max !== undefined && uses.used >= uses.max) || (uses.recharge !== undefined && uses.used > 0))) return '次数已用尽或等待充能';
  if (opts.isCurrent && actor.actionEconomy[a.bonusAction ? 'bonus' : 'action']) return a.bonusAction ? '附赠动作已使用' : '动作已使用';
  const slot = resolveCastSlot(actor, a.spellLevel ?? 0);
  return slot.ok ? null : slot.reason ?? '法术位不足';
}
