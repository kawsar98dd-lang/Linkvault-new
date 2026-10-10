import { describe, expect, it } from 'vitest';
import { findUndeclaredRoutes, findUnregisteredDeclarations, normalizeRoutePath, validateRegistry } from '../src/registry.ts';
import type { RouteMeta } from '../src/types.ts';

const ok: RouteMeta = { id: 'a', method: 'get', path: '/workspaces/{ws}', auth: 'session', action: 'workspace:read', resource: 'workspace', tenant: true };

describe('validateRegistry', () => {
  it('accepts a complete declaration set', () => {
    const post: RouteMeta = { id: 'b', method: 'post', path: '/workspaces', auth: 'session', action: 'workspace:create', resource: 'workspace', tenant: false, idempotent: true };
    const pub: RouteMeta = { id: 'c', method: 'get', path: '/openapi.json', auth: 'public', reason: 'static API description document' };
    expect(validateRegistry([ok, post, pub])).toEqual([]);
  });
  it('rejects duplicates, mismatches and missing declarations', () => {
    expect(validateRegistry([ok, ok]).join(' ')).toMatch(/duplicate route id/);
    expect(validateRegistry([ok, { ...ok, id: 'z' }]).join(' ')).toMatch(/duplicate method\+path/);
    expect(validateRegistry([{ ...ok, resource: 'member' }]).join(' ')).toMatch(/action\/resource mismatch/);
    expect(validateRegistry([{ ...ok, tenant: false }]).join(' ')).toMatch(/tenant flag/);
    expect(validateRegistry([{ ...ok, id: 'p', method: 'patch', path: '/workspaces/{ws}', action: 'workspace:update' }]).join(' ')).toMatch(/idempotent/);
    expect(validateRegistry([{ id: 'x', method: 'get', path: '/x', auth: 'public', reason: 'short' }]).join(' ')).toMatch(/justification/);
    expect(validateRegistry([{ id: 'x', method: 'post', path: '/x', auth: 'public', reason: 'long enough reason here' }]).join(' ')).toMatch(/read-only/);
    expect(validateRegistry([{ id: 'x', method: 'get', path: '/x', auth: 'weird' } as unknown as RouteMeta]).join(' ')).toMatch(/unknown auth mode/);
    expect(validateRegistry([{ ...ok, action: 'nope:nope' } as unknown as RouteMeta]).join(' ')).toMatch(/unknown action/);
    expect(validateRegistry([{ ...ok, resource: 'nope' } as unknown as RouteMeta]).join(' ')).toMatch(/unknown resource/);
  });
});

describe('route normalisation / undeclared detection', () => {
  it('normalises hono paths to openapi paths and strips the base path', () => {
    expect(normalizeRoutePath('/api/v1/workspaces/:ws/members/:user_id')).toBe('/workspaces/{ws}/members/{user_id}');
    expect(normalizeRoutePath('/api/v1')).toBe('/');
  });
  it('reports routes missing from the registry and ignores middleware entries', () => {
    const routes = [
      { method: 'ALL', path: '/api/v1/*' },
      { method: 'GET', path: '/api/v1/workspaces/:ws' },
      { method: 'GET', path: '/api/v1/rogue' },
      { method: 'OPTIONS', path: '/api/v1/x' },
    ];
    expect(findUndeclaredRoutes(routes, [ok])).toEqual(['GET /rogue']);
  });
});

describe('findUnregisteredDeclarations', () => {
  it('reports declarations that have no router entry (e.g. path typo or forgotten openapi())', () => {
    const routes = [{ method: 'ALL', path: '/api/v1/*' }, { method: 'GET', path: '/api/v1/workspaces/:ws' }];
    expect(findUnregisteredDeclarations(routes, [ok])).toEqual([]);
    expect(findUnregisteredDeclarations(routes, [{ ...ok, id: 'b', path: '/workspaces/{id}', tenant: false }])).toEqual(['GET /workspaces/{id}']);
    expect(findUnregisteredDeclarations([], [ok])).toEqual(['GET /workspaces/{ws}']);
  });
});
