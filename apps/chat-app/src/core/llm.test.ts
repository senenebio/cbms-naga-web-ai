/**
 * `testLlmConnection` probe tests (fetch mocked — no network).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FetchLlmClient, testLlmConnection } from './llm';
import type { Message } from '@repo/llm/types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse() {
  return new Response('{}', { status: 200 });
}

describe('testLlmConnection', () => {
  it('resolves on 2xx and calls {baseUrl}/chat/completions (trailing slash trimmed)', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await testLlmConnection({ baseUrl: 'http://localhost:11434/v1/', apiKey: 'key', model: 'm' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const opts = init as { headers: Record<string, string>; body: string };
    expect(opts.headers.Authorization).toBe('Bearer key');
    const body = JSON.parse(opts.body) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'm',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    });
  });

  it('omits the Authorization header when the key is blank', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await testLlmConnection({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'm' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
  });

  it('throws with HTTP status and body snippet on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"invalid api key"}', { status: 401 })),
    );

    await expect(
      testLlmConnection({ baseUrl: 'http://localhost:11434/v1', apiKey: 'bad', model: 'm' }),
    ).rejects.toThrow('HTTP 401');
  });

  it('throws a connection message on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('CORS blocked'))));

    await expect(
      testLlmConnection({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'm' }),
    ).rejects.toThrow('Connection failed: CORS blocked');
  });
});

describe('FetchLlmClient.chat (H2 — abort)', () => {
  it('forwards the signal to fetch and re-throws an abort as AbortError', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      throw err;
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new FetchLlmClient({ model: 'm', baseUrl: 'http://x/v1' });
    const messages: Message[] = [{ role: 'user', content: 'hi' }];
    controller.abort();

    await expect(client.chat(messages, [], controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    // The signal must be forwarded to fetch so a real request is cancellable.
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});
