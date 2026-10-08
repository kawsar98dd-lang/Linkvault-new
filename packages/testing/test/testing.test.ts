import { describe, expect, it } from 'vitest';
import { TestAuthPort } from '../src/index.ts';

describe('TestAuthPort', () => {
  it('resolves, lists and revokes only own sessions', async () => {
    const a = new TestAuthPort();
    a.add({ sessionId: 's1', userId: 'u1' });
    a.add({ sessionId: 's2', userId: 'u1' });
    a.add({ sessionId: 's3', userId: 'u2' });
    const h = new Headers({ 'x-test-session': 's1' });
    expect((await a.getSession(h))?.userId).toBe('u1');
    expect((await a.listSessions(h)).map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect(await a.revokeSession(h, 's3')).toBe(false);
    expect(await a.revokeSession(h, 's2')).toBe(true);
    expect(await a.getSession(new Headers())).toBeNull();
    expect(await a.listSessions(new Headers())).toEqual([]);
  });
});
