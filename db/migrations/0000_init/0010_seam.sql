-- SEAM-TENANT, the half Drizzle cannot declare.
--
-- Three things live here rather than in the schema TS, and each is here because
-- a declaration would not have been enforcement (B-05):
--
--  1. FORCE ROW LEVEL SECURITY. `ENABLE` leaves the table owner walking straight
--     past every policy; FORCE is what makes the owner subject too, and it has
--     no Drizzle declaration. The `rls-coverage` fact reads `relforcerowsecurity`
--     back out of the catalogue, so a table that misses this line fails V-DB.
--  2. The grants. Least privilege for the runtime role is a grant, not a policy:
--     RLS decides *which rows*, the grant decides *which verbs*.
--  3. Append-only. `seam_probe_ledger` is named in `APPEND_ONLY_TABLES`, so the
--     app role never receives UPDATE or DELETE on it — and a trigger refuses
--     both for everybody else, including the owner.

ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "seam_probe_rows" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "seam_probe_ledger" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The tenant registry: rows are chosen by the policy, verbs by these grants.
-- No DELETE — a tenant is not something the runtime removes.
GRANT SELECT, INSERT, UPDATE ON "tenants" TO "vextrus_app";
--> statement-breakpoint

-- The mutable probe: the full verb set, so `forTenant` has something to update.
GRANT SELECT, INSERT, UPDATE, DELETE ON "seam_probe_rows" TO "vextrus_app";
--> statement-breakpoint

-- The append-only probe: SELECT and INSERT and nothing else. The REVOKE is not
-- redundant — it is the line that stays true if a later GRANT ALL is ever added
-- above it by accident.
GRANT SELECT, INSERT ON "seam_probe_ledger" TO "vextrus_app";
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "seam_probe_ledger" FROM "vextrus_app";
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "append_only_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % on % is refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "seam_probe_ledger_append_only"
  BEFORE UPDATE OR DELETE ON "seam_probe_ledger"
  FOR EACH ROW EXECUTE FUNCTION "append_only_guard"();
