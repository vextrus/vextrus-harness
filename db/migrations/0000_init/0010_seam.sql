-- SEAM-TENANT's teeth. Everything drizzle-kit cannot express lives here, and it
-- is ordinary SQL because that is what the database enforces (B-05: prose is not
-- enforcement).
--
-- Three things:
--   1. FORCE ROW LEVEL SECURITY. `ENABLE` alone exempts the table's owner, and
--      the owner is `vextrus_migrate` — the role that runs this very file. A
--      policy the owner is exempt from is a policy that is off for whoever
--      forgets which role they are on.
--   2. The role split's grants. `vextrus_app` is the only runtime role, and it
--      holds exactly the verbs a table declares; `vextrus_auth` gets CONNECT and
--      USAGE and nothing else until the auth leaf lands.
--   3. Append-only. Grants do the refusing for `vextrus_app`; a trigger does it
--      for everyone else, so "append-only" is a property of the table rather
--      than of who is asking.

-- The whole lane's security pass, as a function, so a later increment's
-- migration is one line: `select public.seam_secure(array['its_ledger']);`.
-- Discovering the tables here (rather than naming them) is the same choice the
-- seam suite makes: a table that exists is a table that is covered.
CREATE OR REPLACE FUNCTION public.seam_secure(append_only text[] DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql
AS $seam_secure$
DECLARE
  target text;
  is_append_only boolean;
BEGIN
  FOR target IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND n.nspname = 'public'
     ORDER BY c.relname
  LOOP
    is_append_only := target = ANY (append_only);

    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target);

    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', target);
    EXECUTE format('REVOKE ALL ON public.%I FROM vextrus_app, vextrus_auth', target);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO vextrus_app', target);

    IF is_append_only THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS %I ON public.%I',
        target || '_append_only', target);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I'
        || ' FOR EACH STATEMENT EXECUTE FUNCTION public.seam_append_only()',
        target || '_append_only', target);
    ELSE
      EXECUTE format('GRANT UPDATE, DELETE ON public.%I TO vextrus_app', target);
    END IF;
  END LOOP;
END;
$seam_secure$;

-- The append-only refusal for anyone the grants do not already stop — the owner,
-- a future superuser session, a migration that means well. SQLSTATE 42501 is
-- `insufficient_privilege`, the same class the missing grant raises, and the
-- message says `permission denied` for the same reason: one refusal, one shape.
CREATE OR REPLACE FUNCTION public.seam_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $seam_append_only$
BEGIN
  RAISE EXCEPTION 'permission denied for table %: append-only (% refused)',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$seam_append_only$;

-- The argument is `APPEND_ONLY_TABLES` from db/schema/tenancy.ts. It is repeated
-- here rather than read from TypeScript because a migration is a fact about the
-- database, applied once, and must not change meaning when the schema file does;
-- the seam suite reads the TS list and proves the database agrees.
SELECT public.seam_secure(ARRAY['seam_probe_ledger']);

-- vextrus_auth: present, connectable, and holding nothing. The auth module's own
-- tables and grants arrive with the auth leaf.
GRANT USAGE ON SCHEMA public TO vextrus_app, vextrus_auth;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM vextrus_app, vextrus_auth;
