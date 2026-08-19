-- The registry's own half of SEAM-TENANT, and the grant this leaf should not have made.
--
-- Two corrections, both of them privilege decisions, and both written as a new
-- migration rather than as an edit to 0000_init: migrations are append-only
-- (layout-db), and a database that already applied 0000_init has to be able to
-- arrive here by running forward.
--
--   1. FORCE on `tenants`. 0000_schema.sql beside this file enables row security
--      and creates the two policies; ENABLE alone leaves `vextrus_migrate` — the
--      owner, and the role every migration runs as — walking past them. Forced,
--      the owner is subject too, which is why `tenants_owner` is written down as
--      a policy rather than left implicit: the migrate role administers the
--      registry, and an unforced exception is one nobody can read.
--
--   2. `vextrus_auth` loses USAGE ON SCHEMA public. This leaf's scope reserves
--      every grant to the auth role beyond CONNECT for the auth increment; the
--      role owns no object here and has no table privilege to reach, and AC-05's
--      requirement (it cannot CREATE TABLE) is already carried by the REVOKE in
--      0000_init. Granting it a schema privilege ahead of the increment that
--      needs one is a decision made in the wrong place, and it would have been
--      inherited unexamined.

ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA "public" FROM "vextrus_auth";
