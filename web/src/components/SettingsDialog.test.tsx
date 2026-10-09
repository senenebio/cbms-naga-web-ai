/**
 * SettingsDialog tests (single OpenAI-compatible endpoint → localStorage
 * via a storage stub, no network).
 */
import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import SettingsDialog from './SettingsDialog';
import type { KeyValueStorage } from '../core/provider';

function makeStorage(initial?: string) {
  const store = new Map<string, string>();
  if (initial) store.set('cbms.llm.config', initial);
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
  it('renders three plain fields (Base URL / API key / Model) and the action buttons', () => {
    const { storage } = makeStorage();
    const tree = ReactTestRenderer.create(
      React.createElement(SettingsDialog, { storage, onClose: () => {} }),
    );
    expect(tree.root.findAllByType('input').filter((i) => i.props.type === 'radio')).toHaveLength(0);
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Base URL');
    expect(text).toContain('API key');
    expect(text).toContain('Model');
    expect(text).not.toContain('Provider');
  });

  it('saves a single-endpoint config (no provider field) to the storage stub', () => {
    const { storage, store } = makeStorage();
    const tree = ReactTestRenderer.create(
      React.createElement(SettingsDialog, { storage, onClose: () => {} }),
    );

    const [urlInput, modelInput] = textInputs(tree.root);
    const keyInput = tree.root.findByProps({ type: 'password' });
    act(() => {
      urlInput.props.onChange({ target: { value: 'http://localhost:11434/v1' } });
    });
    act(() => {
      modelInput.props.onChange({ target: { value: 'llama3.1' } });
    });
    act(() => {
      keyInput.props.onChange({ target: { value: 'sk-1234567890abcdef' } });
    });
    act(() => {
      findButton(tree.root, 'Save').props.onClick();
    });

    expect(storage.setItem).toHaveBeenCalled();
    const saved = JSON.parse(store.get('cbms.llm.config') ?? '{}') as Record<string, string>;
    expect(saved.provider).toBeUndefined();
    expect(saved.baseUrl).toBe('http://localhost:11434/v1');
    expect(saved.model).toBe('llama3.1');
    expect(saved.apiKey).toBe('sk-1234567890abcdef');
  });

  it('keeps the previously stored key when the key field is blank (E9)', () => {
    const { storage, store } = makeStorage(
      JSON.stringify({
        baseUrl: 'http://localhost:11434/v1',
        apiKey: 'sk-stored-1234567890',
        model: 'llama3.1',
      }),
    );
    let tree: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        React.createElement(SettingsDialog, { storage, onClose: () => {} }),
      );
    }); // flushes the prefill effect

    // Prefilled from the stored config; the key field itself stays blank.
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Current key:');
    expect(text).not.toContain('sk-stored-1234567890');

    act(() => {
      findButton(tree.root, 'Save').props.onClick();
    });

    const saved = JSON.parse(store.get('cbms.llm.config') ?? '{}') as Record<string, string>;
    expect(saved.apiKey).toBe('sk-stored-1234567890');
  });

  it('rejects saving without a valid baseUrl', () => {
    const { storage } = makeStorage();
    const tree = ReactTestRenderer.create(
      React.createElement(SettingsDialog, { storage, onClose: () => {} }),
    );

    act(() => {
      findButton(tree.root, 'Save').props.onClick();
    });

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('baseUrl is required');
  });

  it('clears the stored config and reports it', () => {
    const { storage } = makeStorage(
      JSON.stringify({ baseUrl: 'http://localhost:11434/v1', model: 'm' }),
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
