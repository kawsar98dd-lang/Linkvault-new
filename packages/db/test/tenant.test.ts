import { describe, expect, it } from 'vitest';
import { InvalidTenantContextError, withTenant, withUser, type Database } from '../src/index.ts';

const WS = '11111111-1111-1111-1111-111111111111';

function fakeDb() {
  const executed: unknown[] = [];
  const db = {
    transaction: async (cb: (tx: { execute: (q: unknown) => Promise<void> }) => Promise<unknown>) =>
      cb({ execute: (q) => { executed.push(q); return Promise.resolve(); } }),
  } as unknown as Database;
  return { db, executed };
}

describe('withTenant / withUser validation (no database needed)', () => {
  it('binds context before running the callback', async () => {
    const { db, executed } = fakeDb();
    const out = await withTenant(db, { userId: 'u1', workspaceId: WS }, () => Promise.resolve('ran'));
    expect(out).toBe('ran');
    expect(executed).toHaveLength(1);
  });
  it('rejects malformed workspace ids before touching the database', async () => {
    const { db, executed } = fakeDb();
    for (const bad of ['', 'not-a-uuid', `${WS}'; drop table users;--`, WS.toUpperCase()]) {
      await expect(withTenant(db, { userId: 'u1', workspaceId: bad }, () => Promise.resolve(1))).rejects.toBeInstanceOf(InvalidTenantContextError);
    }
    expect(executed).toHaveLength(0);
  });
  it('rejects invalid user ids', async () => {
    const { db } = fakeDb();
    for (const bad of ['', 'x'.repeat(129), 'a\u0000b']) {
      await expect(withTenant(db, { userId: bad, workspaceId: WS }, () => Promise.resolve(1))).rejects.toBeInstanceOf(InvalidTenantContextError);
      await expect(withUser(db, { userId: bad }, () => Promise.resolve(1))).rejects.toBeInstanceOf(InvalidTenantContextError);
    }
  });
  it('withUser binds an empty workspace', async () => {
    const { db, executed } = fakeDb();
    await withUser(db, { userId: 'u1' }, () => Promise.resolve(1));
    expect(executed).toHaveLength(1);
  });
});
