-- BnlinkVault 0001_init: identity, tenancy, audit, outbox, idempotency + RLS.
-- Executed by role app_migrator (owner of all objects). Roles are created by `pnpm db:provision`.
-- Tenant model: GUCs app.user_id / app.workspace_id are set transaction-locally by withTenant().

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS audit_internal;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_rw, audit_writer;
GRANT USAGE ON SCHEMA app TO app_rw, audit_writer;
GRANT USAGE ON SCHEMA audit_internal TO app_rw;
GRANT USAGE, CREATE ON SCHEMA audit_internal TO audit_writer;

-- ---------------------------------------------------------------- helpers
CREATE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;

CREATE FUNCTION app.current_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid $$;

CREATE FUNCTION app.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ---------------------------------------------------------------- identity (Better Auth owned shape)
CREATE TABLE users (
  id                 text PRIMARY KEY,
  name               text        NOT NULL,
  email              text        NOT NULL,
  email_verified     boolean     NOT NULL DEFAULT false,
  image              text,
  two_factor_enabled boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE sessions (
  id         text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token      text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id    text        NOT NULL REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE accounts (
  id                       text PRIMARY KEY,
  account_id               text        NOT NULL,
  provider_id              text        NOT NULL,
  user_id                  text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  access_token             text,
  refresh_token            text,
  id_token                 text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope                    text,
  password                 text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_provider_account_key UNIQUE (provider_id, account_id)
);
CREATE INDEX accounts_user_id_idx ON accounts (user_id);

CREATE TABLE verifications (
  id         text PRIMARY KEY,
  identifier text        NOT NULL,
  value      text        NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_identifier_idx ON verifications (identifier);

CREATE TABLE two_factors (
  id           text PRIMARY KEY,
  secret       text NOT NULL,
  backup_codes text NOT NULL,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX two_factors_user_id_idx ON two_factors (user_id);

CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------- tenancy
CREATE TABLE workspaces (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id      text        NOT NULL UNIQUE,
  name           text        NOT NULL,
  slug           text        NOT NULL,
  owner_user_id  text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status         text        NOT NULL DEFAULT 'active',
  settings       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  default_locale text        NOT NULL DEFAULT 'en',
  timezone       text        NOT NULL DEFAULT 'UTC',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT workspaces_public_id_format CHECK (public_id ~ '^ws_[a-z0-9]{20}$'),
  CONSTRAINT workspaces_name_len CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT workspaces_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  CONSTRAINT workspaces_status_valid CHECK (status IN ('active', 'suspended', 'deleting')),
  CONSTRAINT workspaces_locale_valid CHECK (default_locale IN ('en', 'bn'))
);
CREATE UNIQUE INDEX workspaces_slug_active_key ON workspaces (slug) WHERE deleted_at IS NULL;
CREATE INDEX workspaces_owner_idx ON workspaces (owner_user_id);
CREATE TRIGGER workspaces_touch BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE memberships (
  workspace_id uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         text        NOT NULL,
  status       text        NOT NULL DEFAULT 'active',
  invited_by   text        REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT memberships_role_valid CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  CONSTRAINT memberships_status_valid CHECK (status IN ('active', 'removed'))
);
-- DB-level invariant: at most one active owner per workspace.
CREATE UNIQUE INDEX memberships_one_active_owner ON memberships (workspace_id) WHERE role = 'owner' AND status = 'active';
CREATE INDEX memberships_user_active_idx ON memberships (user_id) WHERE status = 'active';
CREATE TRIGGER memberships_touch BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  email        text        NOT NULL,
  role         text        NOT NULL,
  token_hash   text        NOT NULL UNIQUE,
  invited_by   text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       text        NOT NULL DEFAULT 'pending',
  expires_at   timestamptz NOT NULL,
  accepted_by  text        REFERENCES users (id) ON DELETE SET NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_role_valid CHECK (role IN ('admin', 'editor', 'viewer')),
  CONSTRAINT invitations_status_valid CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  CONSTRAINT invitations_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT invitations_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX invitations_pending_email_key ON invitations (workspace_id, email) WHERE status = 'pending';
CREATE INDEX invitations_workspace_idx ON invitations (workspace_id, created_at DESC);

-- ---------------------------------------------------------------- audit (append-only)
CREATE TABLE audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts            timestamptz NOT NULL DEFAULT now(),
  workspace_id  uuid,
  actor_type    text        NOT NULL,
  actor_id      text,
  action        text        NOT NULL,
  resource_type text        NOT NULL,
  resource_id   text,
  request_id    text,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_actor_type_valid CHECK (actor_type IN ('user', 'system', 'staff')),
  CONSTRAINT audit_action_len CHECK (char_length(action) BETWEEN 1 AND 100)
);
CREATE INDEX audit_logs_workspace_ts_idx ON audit_logs (workspace_id, ts DESC, id DESC);
CREATE INDEX audit_logs_actor_ts_idx ON audit_logs (actor_id, ts DESC);

CREATE FUNCTION audit_internal.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_internal.forbid_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_internal.forbid_mutation();

-- ---------------------------------------------------------------- outbox
CREATE TABLE outbox_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid,
  aggregate_type  text        NOT NULL,
  aggregate_id    text        NOT NULL,
  event_type      text        NOT NULL,
  payload         jsonb       NOT NULL,
  status          text        NOT NULL DEFAULT 'pending',
  attempts        integer     NOT NULL DEFAULT 0,
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  CONSTRAINT outbox_status_valid CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  CONSTRAINT outbox_attempts_nonneg CHECK (attempts >= 0)
);
CREATE INDEX outbox_pending_idx ON outbox_events (next_attempt_at) WHERE status IN ('pending', 'failed');
CREATE INDEX outbox_workspace_idx ON outbox_events (workspace_id, created_at DESC);

-- ---------------------------------------------------------------- idempotency
CREATE TABLE idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id    uuid,
  key             text        NOT NULL,
  request_hash    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'in_progress',
  response_status integer,
  response_body   jsonb,
  locked_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  CONSTRAINT idem_status_valid CHECK (status IN ('in_progress', 'completed')),
  CONSTRAINT idem_key_len CHECK (char_length(key) BETWEEN 8 AND 128)
);
CREATE UNIQUE INDEX idempotency_scope_key ON idempotency_keys
  (actor_user_id, COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
CREATE INDEX idempotency_expires_idx ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------- SECURITY DEFINER helpers (RLS-safe)
-- Owned by app_migrator (table owner => bypasses RLS; no FORCE RLS). EXECUTE is restricted to app_rw.
CREATE FUNCTION app.is_active_member(p_workspace uuid, p_user text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.memberships m
    JOIN public.workspaces w ON w.id = m.workspace_id
    WHERE m.workspace_id = p_workspace AND m.user_id = p_user
      AND m.status = 'active' AND w.deleted_at IS NULL)
$$;

-- One-time bootstrap: the workspace creator may insert the very first (owner) membership.
CREATE FUNCTION app.can_bootstrap_owner(p_workspace uuid, p_user text, p_role text, p_actor text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_role = 'owner' AND p_actor IS NOT NULL AND p_user = p_actor
    AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = p_workspace AND w.owner_user_id = p_user AND w.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.workspace_id = p_workspace)
$$;

-- Invitation acceptance runs without a tenant context (the invitee is not a member yet).
-- It is the single, audited RLS exception: validates token, email, expiry and state atomically.
CREATE FUNCTION app.accept_invitation(p_token_hash text, p_user_id text, p_user_email text)
  RETURNS TABLE (out_workspace_id uuid, out_role text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  inv public.invitations%ROWTYPE;
  existing public.memberships%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'invitation_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO inv FROM public.invitations i WHERE i.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND
     OR inv.status <> 'pending'
     OR inv.expires_at <= now()
     OR lower(inv.email) <> lower(p_user_email)
     OR NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = inv.workspace_id AND w.deleted_at IS NULL AND w.status = 'active')
  THEN
    RAISE EXCEPTION 'invitation_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO existing FROM public.memberships m
    WHERE m.workspace_id = inv.workspace_id AND m.user_id = p_user_id FOR UPDATE;
  IF FOUND THEN
    IF existing.status = 'active' THEN
      RAISE EXCEPTION 'already_member' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.memberships SET status = 'active', role = inv.role, invited_by = inv.invited_by
      WHERE workspace_id = inv.workspace_id AND user_id = p_user_id;
  ELSE
    INSERT INTO public.memberships (workspace_id, user_id, role, status, invited_by)
      VALUES (inv.workspace_id, p_user_id, inv.role, 'active', inv.invited_by);
  END IF;

  UPDATE public.invitations SET status = 'accepted', accepted_by = p_user_id, accepted_at = now() WHERE id = inv.id;
  RETURN QUERY SELECT inv.workspace_id, inv.role;
END
$$;

-- Privileged audit writer: app_rw may only call this function; it cannot INSERT/UPDATE/DELETE audit_logs.
CREATE FUNCTION audit_internal.write_event(
  p_workspace uuid, p_actor_type text, p_actor_id text, p_action text,
  p_resource_type text, p_resource_id text, p_request_id text, p_metadata jsonb)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_workspace IS NOT NULL AND p_workspace IS DISTINCT FROM app.current_workspace_id() THEN
    RAISE EXCEPTION 'audit_scope_violation' USING ERRCODE = '42501';
  END IF;
  IF p_actor_type = 'user' AND p_actor_id IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'audit_actor_violation' USING ERRCODE = '42501';
  END IF;
  -- A forged tenant context must not be able to write into a workspace the actor does not belong to.
  IF p_workspace IS NOT NULL AND p_actor_type = 'user' AND NOT app.is_active_member(p_workspace, p_actor_id) THEN
    RAISE EXCEPTION 'audit_scope_violation' USING ERRCODE = '42501';
  END IF;
  IF pg_column_size(COALESCE(p_metadata, '{}'::jsonb)) > 8192 THEN
    RAISE EXCEPTION 'audit_metadata_too_large' USING ERRCODE = '22023';
  END IF;
  -- id generated here: INSERT ... RETURNING would require SELECT rights, which audit_writer must not have.
  v_id := gen_random_uuid();
  INSERT INTO public.audit_logs (id, workspace_id, actor_type, actor_id, action, resource_type, resource_id, request_id, metadata)
  VALUES (v_id, p_workspace, p_actor_type, p_actor_id, p_action, p_resource_type, p_resource_id, p_request_id, COALESCE(p_metadata, '{}'::jsonb));
  RETURN v_id;
END
$$;
ALTER FUNCTION audit_internal.write_event(uuid, text, text, text, text, text, text, jsonb) OWNER TO audit_writer;

REVOKE ALL ON FUNCTION app.is_active_member(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.can_bootstrap_owner(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.accept_invitation(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_internal.write_event(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_active_member(uuid, text) TO app_rw;
GRANT EXECUTE ON FUNCTION app.can_bootstrap_owner(uuid, text, text, text) TO app_rw;
GRANT EXECUTE ON FUNCTION app.accept_invitation(text, text, text) TO app_rw;
GRANT EXECUTE ON FUNCTION audit_internal.write_event(uuid, text, text, text, text, text, text, jsonb) TO app_rw;
GRANT EXECUTE ON FUNCTION app.is_active_member(uuid, text) TO audit_writer;

-- ---------------------------------------------------------------- privileges
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, accounts, verifications, two_factors TO app_rw;
GRANT SELECT, INSERT, UPDATE ON workspaces, memberships TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON invitations, idempotency_keys TO app_rw;
GRANT SELECT ON audit_logs TO app_rw;
GRANT SELECT, INSERT ON outbox_events TO app_rw;
GRANT INSERT ON audit_logs TO audit_writer;
GRANT SELECT ON schema_migrations TO app_rw;

-- ---------------------------------------------------------------- row level security
ALTER TABLE workspaces       ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- workspaces: visible to active members; mutations only within the bound workspace.
CREATE POLICY workspaces_select ON workspaces FOR SELECT TO app_rw
  USING (app.is_active_member(id, app.current_user_id()));
CREATE POLICY workspaces_insert ON workspaces FOR INSERT TO app_rw
  WITH CHECK (id = app.current_workspace_id() AND owner_user_id = app.current_user_id());
CREATE POLICY workspaces_update ON workspaces FOR UPDATE TO app_rw
  USING (id = app.current_workspace_id() AND app.is_active_member(id, app.current_user_id()))
  WITH CHECK (id = app.current_workspace_id() AND app.is_active_member(id, owner_user_id));

-- memberships: own rows anywhere; others only inside the bound workspace for active members.
CREATE POLICY memberships_select ON memberships FOR SELECT TO app_rw
  USING (user_id = app.current_user_id()
         OR (workspace_id = app.current_workspace_id() AND app.is_active_member(workspace_id, app.current_user_id())));
CREATE POLICY memberships_insert ON memberships FOR INSERT TO app_rw
  WITH CHECK (workspace_id = app.current_workspace_id()
              AND (app.is_active_member(workspace_id, app.current_user_id())
                   OR app.can_bootstrap_owner(workspace_id, user_id, role, app.current_user_id())));
CREATE POLICY memberships_update ON memberships FOR UPDATE TO app_rw
  USING (workspace_id = app.current_workspace_id() AND app.is_active_member(workspace_id, app.current_user_id()))
  WITH CHECK (workspace_id = app.current_workspace_id());

-- invitations / idempotency / outbox / audit: strictly the bound workspace and an active member.
CREATE POLICY invitations_all ON invitations FOR ALL TO app_rw
  USING (workspace_id = app.current_workspace_id() AND app.is_active_member(workspace_id, app.current_user_id()))
  WITH CHECK (workspace_id = app.current_workspace_id() AND app.is_active_member(workspace_id, app.current_user_id()));

CREATE POLICY idempotency_all ON idempotency_keys FOR ALL TO app_rw
  USING (actor_user_id = app.current_user_id()
         AND (workspace_id IS NULL OR (workspace_id = app.current_workspace_id() AND app.is_active_member(workspace_id, app.current_user_id()))))
  WITH CHECK (actor_user_id = app.current_user_id()
         AND (workspace_id IS NULL OR (workspace_id = app.current_workspace_id() AND app.is_active_member(workspace_id, app.current_user_id()))));

CREATE POLICY outbox_select ON outbox_events FOR SELECT TO app_rw
  USING (workspace_id = app.current_workspace_id() AND app.is_active_member(workspace_id, app.current_user_id()));
CREATE POLICY outbox_insert ON outbox_events FOR INSERT TO app_rw
  WITH CHECK (workspace_id IS NULL OR (workspace_id = app.current_workspace_id() AND app.is_active_member(workspace_id, app.current_user_id())));

CREATE POLICY audit_select ON audit_logs FOR SELECT TO app_rw
  USING (workspace_id = app.current_workspace_id() AND app.is_active_member(workspace_id, app.current_user_id()));
CREATE POLICY audit_insert ON audit_logs FOR INSERT TO audit_writer WITH CHECK (true);
