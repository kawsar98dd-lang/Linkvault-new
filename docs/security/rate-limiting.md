# Rate limiting

`RateLimiter` is a vendor-neutral port (`packages/core/src/security/rate-limit.ts`). Rule sets exist for each
authentication-sensitive endpoint class (`AUTH_RATE_RULES`) and for the API (`API_RATE_RULES`). Keys are
hashed (`rateKey`). IP comes from trusted proxy headers (`clientIp`; last `X-Forwarded-For` hop).

**KNOWN LIMITATION:** the only implementation shipped is `InMemoryRateLimiter` (single process). It is NOT
suitable for multi-instance production. Provide a distributed adapter (Redis / edge KV / Durable Object)
before scaling out. Limits shown in code are starting points, not tuned values.
