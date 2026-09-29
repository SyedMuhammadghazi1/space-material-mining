-- Least-privilege database roles for production. See docs/DEPLOYMENT.md ("Database roles").
--
--   * migration role (default `oq_migrator`) — owns every table, sequence, type and function; runs
--     `node migrate.mjs` / `npm run db:migrate`. Never used by the running app.
--   * runtime role (default `oq_app`) — what the app's DATABASE_URL uses: SELECT/INSERT/UPDATE/
--     DELETE on the application tables, SELECT/INSERT only on the append-only `ledger_entries` and
--     `audit_log`, sequence usage. No TRUNCATE, no DDL, no ownership — so it cannot TRUNCATE the
--     append-only tables, disable their triggers, or alter/drop anything.
--
-- Run as a database owner/admin (superuser, or a CREATEROLE role such as the RDS/Neon admin) while
-- connected to the application database. It is idempotent; run it
--   1. once before the first migration (creates the roles and default privileges),
--   2. again after migrations, and whenever a migration adds a table (re-applies the grants and
--      the append-only restrictions; ownership of existing objects moves to the migration role).
--
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v app_password="$(openssl rand -hex 24)" -v migrator_password="$(openssl rand -hex 24)" \
--     -f scripts/sql/app-role.sql
--
-- Optional variables: app_role, migrator_role (role names), app_password, migrator_password (set or
-- rotate the password; omit them on re-runs, or when the provider manages credentials).

\set ON_ERROR_STOP on
\if :{?app_role}
\else
  \set app_role oq_app
\endif
\if :{?migrator_role}
\else
  \set migrator_role oq_migrator
\endif

-- 1. Roles ----------------------------------------------------------------------------------------
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', r)
FROM unnest(ARRAY[:'migrator_role', :'app_role']) AS r
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
\gexec
\if :{?migrator_password}
  SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'migrator_role', :'migrator_password')
  \gexec
\endif
\if :{?app_password}
  SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'app_role', :'app_password')
  \gexec
\endif
-- A non-superuser admin must be a member of the migration role to hand objects to it and to set
-- its default privileges (a superuser needs no membership).
SELECT format('GRANT %I TO CURRENT_USER', :'migrator_role')
WHERE NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
\gexec

-- 2. Database and schemas ---------------------------------------------------------------------------
-- The migrator creates the `drizzle` bookkeeping schema, so it needs CREATE on the database.
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', current_database(), :'migrator_role')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_role')
\gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO :"migrator_role";
GRANT USAGE ON SCHEMA public TO :"app_role";
SELECT format('ALTER SCHEMA drizzle OWNER TO %I', :'migrator_role')
WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle')
\gexec

-- 3. Existing objects belong to the migration role -------------------------------------------------
-- Tables first: their serial sequences and indexes move with them.
SELECT format('ALTER TABLE %I.%I OWNER TO %I', schemaname, tablename, :'migrator_role')
FROM pg_tables
WHERE schemaname IN ('public', 'drizzle') AND tableowner <> :'migrator_role'
\gexec
SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', schemaname, sequencename, :'migrator_role')
FROM pg_sequences
WHERE schemaname IN ('public', 'drizzle') AND sequenceowner <> :'migrator_role'
\gexec
SELECT format('ALTER TYPE %I.%I OWNER TO %I', n.nspname, t.typname, :'migrator_role')
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype = 'e' AND pg_get_userbyid(t.typowner) <> :'migrator_role'
\gexec
SELECT format('ALTER FUNCTION %s OWNER TO %I', p.oid::regprocedure, :'migrator_role')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND pg_get_userbyid(p.proowner) <> :'migrator_role'
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
\gexec

-- 4. Runtime privileges --------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
-- Append-only tables: triggers reject UPDATE/DELETE (and the FK's ON DELETE SET NULL of actor_id,
-- which Postgres runs as the table owner, keeps working); without the privileges the runtime role
-- can't even try. Add new append-only tables here.
SELECT format('REVOKE UPDATE, DELETE ON %I.%I FROM %I', schemaname, tablename, :'app_role')
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('ledger_entries', 'audit_log')
\gexec

-- Tables and sequences the migration role creates later get the same runtime grants.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";
