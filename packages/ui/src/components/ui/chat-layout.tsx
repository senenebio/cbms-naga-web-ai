/**
 * ChatLayout — master layout wrapper for the white-label chat app.
 *
 * - Outer: full-viewport (`h-dvh`) flex centering.
 * - Inner: centered card with max-width and max-height, visible margins.
 * - Header row: brand name (left) + settings gear (right).
 * - Chat feed: `ScrollArea`, `overscroll-behavior: contain`.
 * - Composer row pinned to bottom inside the card (never fixed).
 * - Mobile: safe-area padding on the composer.
 */
import type { ReactNode } from 'react';
import { ScrollArea } from './scroll-area';

export interface ChatLayoutProps {
  /** Brand name shown in the header (left). */
  title: string;
  /** Right-side header content (settings gear, theme toggle, etc.). */
  headerRight?: ReactNode;
  /** The chat feed (messages). */
  children: ReactNode;
  /** The composer row (pinned to the bottom). */
  composer: ReactNode;
  /** Optional status line shown between header and feed (e.g. model label). */
  status?: ReactNode;
}

export function ChatLayout({
  title,
  headerRight,
  children,
  composer,
  status,
}: ChatLayoutProps) {
  return (
    <div className="flex h-dvh items-center justify-center p-4 sm:p-6">
      <div className="flex h-full max-h-[90dvh] w-full max-w-2xl flex-col">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <span className="text-base font-bold">{title}</span>
          {status ? (
            <span className="ml-auto text-xs text-muted-foreground">{status}</span>
          ) : null}
          {headerRight ? (
            <div className={status ? 'flex items-center gap-1' : 'ml-auto flex items-center gap-1'}>
              {headerRight}
            </div>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1 px-4 py-4" style={{ overscrollBehavior: 'contain' }}>
            {children}
          </ScrollArea>
          <div
            className="px-4 pb-4"
            style={{ paddingBottom: `calc(1rem + env(safe-area-inset-bottom))` }}
          >
            {composer}
          </div>
        </div>
      </div>
    </div>
  );
}
