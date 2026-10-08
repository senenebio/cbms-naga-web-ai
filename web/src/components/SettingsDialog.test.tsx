/**
 * Phase F — SettingsDialog tests (BYOK → localStorage via a storage stub,
 * no network).
 */
import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import SettingsDialog from './SettingsDialog';
import type { KeyValueStorage } from '../core/provider';

function makeStorage(initial?: string) {
  const store = new Map<string, string>();
  if (initial) store.set('cbms-llm', initial);
  const storage: KeyValueStorage = {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      store.delete(k);
    }),
  };
  return { storage, store };
}

function textInputs(root: ReactTestInstance) {
  return root.findAllByType('input').filter((i) => i.props.type === 'text');
}

function findButton(root: ReactTestInstance, label: string): ReactTestInstance {
  const btn = root
    .findAllByType('button')
    .find((b) => b.props.children === label || b.props['aria-label'] === label);
  if (!btn) throw new Error(`button "${label}" not found`);
  return btn;
}

describe('SettingsDialog (BYOK)', () => {
  it('renders the three provider radios and the action buttons', () => {
    const { storage } = makeStorage();
    const tree = ReactTestRenderer.create(
      React.createElement(SettingsDialog, { storage, onClose: () => {} }),
    );
    const radios = tree.root.findAllByType('input').filter((i) => i.props.type === 'radio');
    expect(radios).toHaveLength(3);
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('OpenRouter');
    expect(text).toContain('OpenAI');
    expect(text).toContain('Local');
  });

  it('saves an OpenRouter config to the storage stub', () => {
    const { storage, store } = makeStorage();
    const tree = ReactTestRenderer.create(
      React.createElement(SettingsDialog, { storage, onClose: () => {} }),
    );

    const modelInput = textInputs(tree.root)[0]!;
    const keyInput = tree.root.findByProps({ type: 'password' });
    act(() => {
      modelInput.props.onChange({ target: { value: 'meta-llama/llama-3.1-8b-instruct:free' } });
    });
    act(() => {
      keyInput.props.onChange({ target: { value: 'sk-or-v1-1234567890abcdef' } });
    });
    act(() => {
      findButton(tree.root, 'Save').props.onClick();
    });

    expect(storage.setItem).toHaveBeenCalled();
    const saved = JSON.parse(store.get('cbms.llm.config') ?? '{}') as Record<string, string>;
    expect(saved.provider).toBe('openrouter');
    expect(saved.model).toBe('meta-llama/llama-3.1-8b-instruct:free');
    expect(saved.apiKey).toBe('sk-or-v1-1234567890abcdef');
  });

  it('rejects saving an OpenRouter config without an API key', () => {
    const { storage } = makeStorage();
    const tree = ReactTestRenderer.create(
      React.createElement(SettingsDialog, { storage, onClose: () => {} }),
    );

    const modelInput = textInputs(tree.root)[0]!;
    act(() => {
      modelInput.props.onChange({ target: { value: 'meta-llama/llama-3.1-8b-instruct:free' } });
    });
    act(() => {
      findButton(tree.root, 'Save').props.onClick();
    });

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('apiKey is required');
  });

  it('clears the stored config and reports it', () => {
    const { storage } = makeStorage(
      JSON.stringify({ provider: 'openrouter', apiKey: 'sk-or-v1-x', model: 'm' }),
    );
    const tree = ReactTestRenderer.create(
      React.createElement(SettingsDialog, { storage, onClose: () => {} }),
    );
    act(() => {
      findButton(tree.root, 'Clear').props.onClick();
    });
    expect(storage.removeItem).toHaveBeenCalledWith('cbms.llm.config');
    expect(JSON.stringify(tree.toJSON())).toContain('Cleared');
  });
});
