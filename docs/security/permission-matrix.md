# Permission matrix

Generated from `packages/auth/src/policy/matrix.ts` (single source of truth). `self` = acts on the
caller's own data (no tenant). Fine-grained, target-dependent rules live in `can()` refinements:

- `member:update_role`: never self; never the owner; never *to* owner (use transfer); admins may only
  move `editor`/`viewer` among `editor`/`viewer`.
- `member:remove`: never self, never the owner; admins may only remove `editor`/`viewer`.
- `invitation:create`: never `owner`; admins may only invite `editor`/`viewer`.
- `workspace:transfer_ownership`: owner only; target must differ from the caller.
- Mutating actions are denied while the workspace is not `active`.
- Cross-tenant access never reaches `can()`: the tenant middleware answers **404** first.

| Action | Resource | Scope | Verified e-mail | Mutating | owner | admin | editor | viewer |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `user:read_self` | user | user | no | no | self | self | self | self |
| `csrf:issue` | csrf | user | no | no | self | self | self | self |
| `session:list` | session | user | no | no | self | self | self | self |
| `session:revoke` | session | user | no | yes | self | self | self | self |
| `workspace:create` | workspace | user | yes | yes | self | self | self | self |
| `workspace:list` | workspace | user | yes | no | self | self | self | self |
| `workspace:read` | workspace | workspace | yes | no | ✔ | ✔ | ✔ | ✔ |
| `workspace:update` | workspace | workspace | yes | yes | ✔ | ✔ | — | — |
| `workspace:delete` | workspace | workspace | yes | yes | ✔ | — | — | — |
| `workspace:transfer_ownership` | workspace | workspace | yes | yes | ✔ | — | — | — |
| `member:read` | member | workspace | yes | no | ✔ | ✔ | ✔ | ✔ |
| `member:update_role` | member | workspace | yes | yes | ✔ | ✔ | — | — |
| `member:remove` | member | workspace | yes | yes | ✔ | ✔ | — | — |
| `invitation:create` | invitation | workspace | yes | yes | ✔ | ✔ | — | — |
| `invitation:read` | invitation | workspace | yes | no | ✔ | ✔ | — | — |
| `invitation:revoke` | invitation | workspace | yes | yes | ✔ | ✔ | — | — |
| `invitation:accept` | invitation | user | yes | yes | self | self | self | self |
| `audit_log:read` | audit_log | workspace | yes | no | ✔ | ✔ | — | — |
