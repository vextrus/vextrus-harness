-- The half of the seam Drizzle has no vocabulary for. Runs as vextrus_migrate,
-- immediately after 0000_schema.sql, inside the same migration.
--
-- Three things live here:
--   1. FORCE ROW LEVEL SECURITY. `ENABLE` alone exempts the table's owner, and
--      the owner is the role that runs every migration — so a policy that is
--      merely enabled is a policy the lane's own tooling walks straight past.
--      The `rls-coverage` fact fails any tenant_id table that is not forced.
--   2. The grants. Append-only is a missing privilege, not a hopeful convention:
--      the app role gets SELECT + INSERT on every table named in
--      APPEND_ONLY_TABLES and never UPDATE or DELETE.
--   3. The trigger backstop, so the owner — who has every privilege by
--      definition — is refused the same rewrite with the same SQLSTATE.

ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "seam_probe_rows" FORCE ROW LEVEL SECURITY;
ALTER TABLE "seam_probe_ledger" FORCE ROW LEVEL SECURITY;

-- Neither runtime role may put anything of its own in the schema: the migrate
-- role owns the shape of the database, and AC-05 proves it by trying.
REVOKE CREATE ON SCHEMA "public" FROM PUBLIC;
REVOKE ALL ON SCHEMA "public" FROM "vextrus_app";
REVOKE ALL ON SCHEMA "public" FROM "vextrus_auth";
GRANT USAGE ON SCHEMA "public" TO "vextrus_app";
GRANT USAGE ON SCHEMA "public" TO "vextrus_auth";

-- The registry: a tenant may read itself (policy), and only runAsSystem may
-- bring one into existence (WITH CHECK). Nothing may rewrite or remove one.
GRANT SELECT, INSERT ON "tenants" TO "vextrus_app";

-- The mutable probe.
GRANT SELECT, INSERT, UPDATE, DELETE ON "seam_probe_rows" TO "vextrus_app";

-- The append-only probe: SELECT and INSERT, full stop.
GRANT SELECT, INSERT ON "seam_probe_ledger" TO "vextrus_app";

CREATE OR REPLACE FUNCTION "append_only_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % is append-only, % is refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE TRIGGER "seam_probe_ledger_append_only"
  BEFORE UPDATE OR DELETE ON "seam_probe_ledger"
  FOR EACH ROW EXECUTE FUNCTION "append_only_guard"();
