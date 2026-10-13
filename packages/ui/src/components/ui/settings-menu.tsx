/**
 * SettingsMenu — gear icon that opens a DropdownMenu with:
 *  1. Footer: brand name + version + license
 *  2. "Connection…" → BYOK dialog
 *
 * The gear replaces the old standalone settings trigger (D6).
 */
import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

export interface SettingsMenuProps {
  /** Brand name for the footer. */
  brandName: string;
  /** Brand version for the footer. */
  brandVersion: string;
  /** Brand license for the footer. */
  brandLicense: string;
  /** Opens the BYOK Connection dialog. */
  onConnection: () => void;
}

const TEMP_KEY = 'chat-temperature';
const MODEL_KEY = 'chat-model';

export function readTemperature(): number {
  try {
    const v = localStorage.getItem(TEMP_KEY);
    return v !== null ? Number(v) : 0.7;
  } catch {
    return 0.7;
  }
}

export function persistTemperature(value: number): void {
  try {
    localStorage.setItem(TEMP_KEY, String(value));
  } catch {
    /* ignore */
  }
}

export function readModel(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

export function persistModel(model: string): void {
  try {
    localStorage.setItem(MODEL_KEY, model);
  } catch {
    /* ignore */
  }
}

export function SettingsMenu({
  brandName,
  brandVersion,
  brandLicense,
  onConnection,
}: SettingsMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open settings"
          title="Settings"
        >
          <Settings />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Settings</DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Footer: brand + connection */}
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          <div>
            {brandName} v{brandVersion}
          </div>
          <div>{brandLicense}</div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={onConnection} className="cursor-pointer">
          Connection…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
