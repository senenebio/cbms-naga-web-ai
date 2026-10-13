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
  /** Optional footer bar rendered below the composer (e.g. Show SQL, New Chat). */
  footer?: ReactNode;
  /** Optional status line shown between header and feed (e.g. model label). */
  status?: ReactNode;
}

export function ChatLayout({
  title,
  headerRight,
  children,
  composer,
  footer,
  status,
}: ChatLayoutProps) {
  return (
    <div className="h-dvh p-4 sm:p-6">
      <div className="mx-auto flex h-[90dvh] w-[95%] max-w-7xl flex-col">
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
            className="px-4 pb-2"
            style={{ paddingBottom: `calc(0.5rem + env(safe-area-inset-bottom))` }}
          >
            {composer}
          </div>
          {footer ? <div className="px-4 pb-3">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
