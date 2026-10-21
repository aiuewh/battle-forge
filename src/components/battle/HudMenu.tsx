'use client';
import React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

/** Portaled into the battle stage, anchored to its trigger, with no layout reflow. */
export function HudMenu({ open, onOpenChange, trigger, children, boundary, label, align = 'start', side = 'top', className }: {
  open: boolean; onOpenChange: (open: boolean) => void; trigger: React.ReactElement;
  children: React.ReactNode; boundary?: HTMLElement | null; label: string;
  align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom'; className?: string;
}) {
  return <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal container={boundary ?? undefined}>
      <Popover.Content aria-label={label} className={cn('dnd-theme hud-menu', className)}
        side={side} align={align} sideOffset={10} collisionPadding={12} collisionBoundary={boundary ?? undefined}
        onOpenAutoFocus={e => e.preventDefault()} onCloseAutoFocus={e => e.preventDefault()}>
        {children}<Popover.Arrow className="hud-menu-arrow" />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
