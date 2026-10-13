/**
 * SettingsMenu — gear icon that opens a DropdownMenu with:
 *  1. Model selector (curated list, persisted in localStorage)
 *  2. Temperature slider (0–2, step 0.1, persisted)
 *  3. Footer: brand name + version + license + "Connection…" → BYOK dialog
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import { Slider } from './slider';

export interface SettingsMenuProps {
  /** Curated model IDs for the Select. */
  models: string[];
  /** Currently selected model. */
  model: string;
  /** Called when the user picks a model. */
  onModelChange: (model: string) => void;
  /** Current temperature (0–2). */
  temperature: number;
  /** Called when the user moves the slider. */
  onTemperatureChange: (value: number) => void;
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
  models,
  model,
  onModelChange,
  temperature,
  onTemperatureChange,
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

        {/* Model selector */}
        <div className="px-2 py-1.5">
          <label className="mb-1 block text-xs text-muted-foreground">Model</label>
          <Select value={model} onValueChange={(v) => onModelChange(v)}>
            <SelectTrigger className="w-full" aria-label="Model">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Temperature slider */}
        <div className="px-2 py-1.5">
          <label className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Temperature</span>
            <span>{temperature.toFixed(1)}</span>
          </label>
          <Slider
            min={0}
            max={2}
            step={0.1}
            value={[temperature]}
            onValueChange={(v) => {
              const next = v[0] ?? 0.7;
              onTemperatureChange(next);
            }}
            aria-label="Temperature"
          />
        </div>

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
