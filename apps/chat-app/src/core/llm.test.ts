/**
 * `testLlmConnection` probe tests (fetch mocked — no network).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { testLlmConnection } from './llm';

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
