'use client';
import React from 'react';
import { useBattleStore } from '@/store/battleStore';
import { reportDelivery, DELIVERY_LABEL } from '@/lib/engine/reportDelivery';
import { Button } from '@/components/ui/button';
import { ClipboardList } from 'lucide-react';

export function ReportSendButton({ text, copy }: { text?: string; copy: () => void }) {
  const store = useBattleStore();
  const delivery = React.useSyncExternalStore(reportDelivery.subscribe, reportDelivery.snapshot, reportDelivery.snapshot);
  return <div className="min-w-0">
    <Button size="sm" className="gap-1 bg-amber-600/90 text-xs text-white hover:bg-amber-600"
      disabled={!store.units.length || store.readOnly || delivery.status === 'sending'}
      onClick={() => {
        if (!store.embedMode) { copy(); return; }
        if (delivery.status === 'unknown') reportDelivery.query();
        else reportDelivery.send(text ?? store.generateBattleResult());
      }}>
      <ClipboardList className="h-3.5 w-3.5" />{store.embedMode ? DELIVERY_LABEL[delivery.status] : '复制战报给 DM'}
    </Button>
    {store.embedMode && delivery.detail && <div role="status" className="mt-1 max-w-md break-words text-xs text-amber-100/80">{delivery.detail}</div>}
  </div>;
}
