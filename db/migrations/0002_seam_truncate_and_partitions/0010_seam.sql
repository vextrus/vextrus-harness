-- Two holes in the security pass, closed where the database can see them.
--
-- 1. TRUNCATE is not UPDATE and is not DELETE. The append-only trigger fires
--    `BEFORE UPDATE OR DELETE`, and the grants stop `vextrus_app` at every write
--    verb — but the owner (`vextrus_migrate`, the role every migration runs as)
--    holds TRUNCATE and no trigger was listening for it, so one statement
--    emptied the ledger with no error. Append-only is supposed to be a property
--    of the table rather than of the verb somebody reached for.
--
-- 2. `seam_secure` looped over `relkind = 'r'`. A partitioned table is
--    `relkind = 'p'`: it carries `tenant_id`, it is the relation queries name,
--    and its policies are the ones that apply to rows routed through it — and it
--    walked straight past the FORCE RLS and the grants. Q-02 says every table,
--    and a relation the security pass cannot see is a relation with no security.
--
-- A migration is append-only (layout-db), so this is a new one rather than an
-- edit to what came before: the fix has to reach databases that already applied
-- 0000_init and 0001_seam_secure_history.
CREATE OR REPLACE FUNCTION public.seam_secure(append_only text[] DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql
AS $seam_secure$
DECLARE
  target text;
  kind "char";
  is_append_only boolean;
BEGIN
  FOR target, kind IN
    SELECT c.relname, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname = 'public'
     ORDER BY c.relname
  LOOP
    -- Named in this call, or already declared append-only by an earlier one:
    -- the history lives in the catalog, where it cannot drift from the database.
    is_append_only := target = ANY (append_only) OR EXISTS (
      SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = target
         AND t.tgname = target || '_append_only'
         AND NOT t.tgisinternal
    );

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

      -- TRUNCATE takes a trigger of its own: Postgres will not let one trigger
      -- carry TRUNCATE alongside UPDATE and DELETE. Partitioned tables accept no
      -- TRUNCATE trigger at all, so for those the refusal is the missing grant
      -- alone — and an append-only partitioned table is a thing this codebase
      -- does not yet have.
      IF kind = 'r' THEN
        EXECUTE format(
          'DROP TRIGGER IF EXISTS %I ON public.%I',
          target || '_append_only_truncate', target);
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I'
          || ' FOR EACH STATEMENT EXECUTE FUNCTION public.seam_append_only()',
          target || '_append_only_truncate', target);
      END IF;
    ELSE
      EXECUTE format('GRANT UPDATE, DELETE ON public.%I TO vextrus_app', target);
    END IF;
  END LOOP;
END;
$seam_secure$;

-- Re-run over the relations that exist now: the ledger gains its TRUNCATE
-- refusal, and every table re-asserts the rest.
SELECT public.seam_secure();
