-- `seam_secure()` must derive append-only status from history, not from the
-- array it happens to be handed this time.
--
-- The function 0000_init installed loops over every table in `public` on every
-- call and sets `is_append_only := target = ANY (append_only)` from that call's
-- argument alone. Its own docstring tells the next increment to add its ledger
-- with `select public.seam_secure(array['its_ledger']);` — naming only the new
-- table — and that call would take the ELSE branch for `seam_probe_ledger` and
-- re-run `GRANT UPDATE, DELETE ... TO vextrus_app` on it. The trigger would
-- still refuse the writes, but half of the enforcement SEAM-TENANT names
-- ("append-only enforcement is grants + trigger") would have quietly come back
-- on, and `has_table_privilege` would disagree with `APPEND_ONLY_TABLES`.
--
-- A migration is append-only (layout-db), so this is a new one rather than an
-- edit to 0000_init: the fix has to reach databases that already applied it.
--
-- The history is in the catalog, where it cannot drift from the database: a
-- table already carrying its `_append_only` trigger *is* append-only, whatever
-- this call's array says. Declaring a table append-only is therefore one-way —
-- the only thing that can loosen it is a migration that says so in as many
-- words, which is what an append-only lane is for.
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
    -- Named in this call, or already declared append-only by an earlier one.
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
    ELSE
      EXECUTE format('GRANT UPDATE, DELETE ON public.%I TO vextrus_app', target);
    END IF;
  END LOOP;
END;
$seam_secure$;

-- Re-run over the tables that exist now: it re-asserts exactly what 0000_init
-- established, and proves the replacement function is the one applying it.
SELECT public.seam_secure();
