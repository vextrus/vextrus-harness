-- SEAM-TENANT, the half drizzle-kit cannot express.
--
-- Three things live here rather than in the schema TS, and each of them is the
-- difference between a guardrail and a comment (B-05):
--
--   1. FORCE ROW LEVEL SECURITY. drizzle-kit emits ENABLE, which leaves the
--      table owner — the role that runs every migration — walking straight past
--      the policy. Forced, the owner is subject too, and the only way past the
--      policy is the transaction-local `app.system` the seam sets.
--   2. The grants. The role split is privileges, not intention: `vextrus_app`
--      gets exactly what the runtime does, `vextrus_auth` gets nothing but a way
--      in, and neither can create a table.
--   3. Append-only. `seam_probe_ledger` is in APPEND_ONLY_TABLES, so the app role
--      is never granted UPDATE or DELETE on it, and a trigger refuses both for
--      every role including the owner. Two locks, because a later grant made by
--      hand must not be able to quietly reopen the ledger.

ALTER TABLE "seam_probe_rows" FORCE ROW LEVEL SECURITY;
ALTER TABLE "seam_probe_ledger" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;

-- Neither runtime role may create anything in the app schema. Only the runtime
-- role is let into it: `vextrus_auth` owns no object in this leaf and has nothing
-- to reach for, so it holds CONNECT (granted by the bootstrap) and nothing else —
-- the grant that lets it at its own tables belongs to the auth increment that
-- brings them, not to this one.
REVOKE CREATE ON SCHEMA "public" FROM PUBLIC;
REVOKE ALL ON SCHEMA "public" FROM "vextrus_app";
REVOKE ALL ON SCHEMA "public" FROM "vextrus_auth";
GRANT USAGE ON SCHEMA "public" TO "vextrus_app";

-- The tenant registry. It is forced under RLS above, with a policy of its own
-- shape (db/schema/tenancy.ts): a tenant may read its own row, and WITH CHECK
-- demands `app.system`, so a tenant comes into existence through runAsSystem or
-- not at all. The grant is the second half of that — read and append, never
-- rewrite or delete, for any role but the migrate owner.
GRANT SELECT, INSERT ON "tenants" TO "vextrus_app";

-- The mutable probe: the full runtime verb set, every one of them under RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON "seam_probe_rows" TO "vextrus_app";

-- The append-only probe: read and append, and nothing else, ever.
GRANT SELECT, INSERT ON "seam_probe_ledger" TO "vextrus_app";

CREATE FUNCTION "public"."seam_append_only"() RETURNS trigger LANGUAGE plpgsql AS $seam$
BEGIN
  RAISE EXCEPTION 'SEAM-TENANT append-only: % on % is refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$seam$;

CREATE TRIGGER "seam_probe_ledger_append_only"
  BEFORE UPDATE OR DELETE ON "seam_probe_ledger"
  FOR EACH STATEMENT EXECUTE FUNCTION "public"."seam_append_only"();
