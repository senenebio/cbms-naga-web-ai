/**
 * Settings dialog tests (jsdom / @testing-library/react).
 *
 * The dialog is a plain `role="dialog"` surface (not Radix — that swap lands
 * in Phase D). These cover the form controls, the Save flow (persisting
 * into a stubbed storage), and the Clear + Cancel affordances.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsDialog from './SettingsDialog';
import type { KeyValueStorage } from '../core/provider.js';

/** An in-memory KeyValueStorage stub (no real localStorage in tests). */
function makeStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

const base = {
  storage: makeStorage(),
  onClose: () => {},
};

describe('SettingsDialog', () => {
  it('renders the Base URL, API key, and Model controls', () => {
    render(<SettingsDialog {...base} />);
    const dialog = screen.getByRole('dialog', { name: 'LLM settings' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/localhost:11434/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/secret-BYOK/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/any model name/)).toBeInTheDocument();
  });

  it('persists a valid config on Save and shows the success notice', () => {
    const storage = makeStorage();
    const onSaved = vi.fn();
    render(
      <SettingsDialog
        storage={storage}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/localhost:11434/), {
      target: { value: 'http://localhost:1234/v1' },
    });
    fireEvent.change(screen.getByPlaceholderText(/any model name/), {
      target: { value: 'test-model' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSaved).toHaveBeenCalled();
    expect(screen.getByText(/Saved to this browser/)).toBeInTheDocument();
  });

  it('calls onClose on Cancel and on the header close button', () => {
    const onClose = vi.fn();
    render(<SettingsDialog storage={makeStorage()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
