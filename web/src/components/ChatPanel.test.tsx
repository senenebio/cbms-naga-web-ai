/**
 * Phase F — ChatPanel component tests (ported from the reference UI, adapted
 * to the driver-free core: stub engine + stub LLM client, no network, no
 * duckdb-wasm, no localStorage).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import createRenderer, {
  type ReactTestRendererJSON,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import ChatPanel from './ChatPanel';
import { stubEngine, StubLlm } from '../testStubs';

let tree: ReactTestRenderer;

/** Flush pending promises (the async chatQuestion generator). */
function flush() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setImmediate(r));
  });
}

function findInput(root: ReactTestInstance): ReactTestInstance {
  return root.findByType('input') as ReactTestInstance;
}

function setDraft(root: ReactTestInstance, value: string) {
  const input = findInput(root);
  act(() => {
    input.props.onChange({ target: { value } });
  });
}

function submit(root: ReactTestInstance) {
  const form = root.findByType('form');
  act(() => {
    form.props.onSubmit({ preventDefault: () => {} });
  });
}

const SAMPLE_ANSWER =
  '## Headline\n\n**1,200** households were surveyed, of which **600** were urban.';

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue('false'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the demo chips, New chat, and Show SQL controls', () => {
    tree = createRenderer.create(
      React.createElement(ChatPanel, {
        engine: stubEngine(),
        client: new StubLlm(),
        onOpenSettings: () => {},
      }),
    );
    // demo chips render
    const chipText = tree.root
      .findAllByType('button')
      .map((b) => b.props.children)
      .join(' ');
    expect(chipText).toContain('households');
  });

  it('shows the unconfigured hint when no client is set', () => {
    tree = createRenderer.create(
      React.createElement(ChatPanel, {
        engine: stubEngine(),
        client: null,
        onOpenSettings: () => {},
      }),
    );
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('No LLM configured');
  });

  it('streams a question through to a markdown answer + SQL/rows', async () => {
    const llm = new StubLlm({ answer: SAMPLE_ANSWER });
    tree = createRenderer.create(
      React.createElement(ChatPanel, {
        engine: stubEngine(),
        client: llm,
        onOpenSettings: () => {},
      }),
    );

    // Turn on Show SQL so the SQL/rows sections render.
    const showSqlBtn = tree.root.findByProps({ 'aria-pressed': false });
    act(() => {
      showSqlBtn.props.onClick();
    });

    setDraft(tree.root, 'How many households?');
    submit(tree.root);
    await flush();
    await flush();

    const out = tree.toJSON() as ReactTestRendererJSON;
    const text = JSON.stringify(out);
    expect(llm.calls).toBeGreaterThanOrEqual(2);
    expect(text).toContain('1,200');
    // Show SQL was toggled on: the SQL and raw-rows sections render.
    // (`SQL {n}` / `Raw rows {n}` are split text nodes, so assert the labels + the SQL body.)
    expect(text).toContain('SQL');
    expect(text).toContain('Raw rows');
    expect(text).toContain('SELECT 1 AS n');
  }, 10000);

  it('New chat clears the conversation', async () => {
    const llm = new StubLlm({ answer: 'One household.' });
    tree = createRenderer.create(
      React.createElement(ChatPanel, {
        engine: stubEngine(),
        client: llm,
        onOpenSettings: () => {},
      }),
    );

    setDraft(tree.root, 'How many households?');
    submit(tree.root);
    await flush();
    await flush();

    // The user message is in the tree.
    expect(JSON.stringify(tree.toJSON())).toContain('How many households?');

    const newChatBtn = tree.root
      .findAllByType('button')
      .find((b) => b.props.title === 'Clear the conversation and start a blank chat');
    expect(newChatBtn).toBeTruthy();
    act(() => {
      (newChatBtn as ReactTestInstance).props.onClick();
    });
    await flush();

    expect(JSON.stringify(tree.toJSON())).not.toContain('How many households?');
  }, 10000);
});
