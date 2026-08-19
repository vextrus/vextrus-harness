CREATE TABLE "seam_probe_ledger" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"row_id" uuid,
	"note" text,
	CONSTRAINT "seam_probe_ledger_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "seam_probe_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seam_probe_rows" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text,
	CONSTRAINT "seam_probe_rows_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "seam_probe_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seam_probe_ledger" ADD CONSTRAINT "seam_probe_ledger_row_fk" FOREIGN KEY ("tenant_id","row_id") REFERENCES "public"."seam_probe_rows"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "seam_probe_ledger_tenant_isolation" ON "seam_probe_ledger" AS PERMISSIVE FOR ALL TO public USING ((tenant_id::text = current_setting('app.tenant_id', true)
      or current_setting('app.system', true) = 'on')) WITH CHECK ((tenant_id::text = current_setting('app.tenant_id', true)
      or current_setting('app.system', true) = 'on'));--> statement-breakpoint
CREATE POLICY "seam_probe_rows_tenant_isolation" ON "seam_probe_rows" AS PERMISSIVE FOR ALL TO public USING ((tenant_id::text = current_setting('app.tenant_id', true)
      or current_setting('app.system', true) = 'on')) WITH CHECK ((tenant_id::text = current_setting('app.tenant_id', true)
      or current_setting('app.system', true) = 'on'));--> statement-breakpoint
CREATE POLICY "tenants_self_or_system" ON "tenants" AS PERMISSIVE FOR ALL TO public USING ((id::text = current_setting('app.tenant_id', true)
      or current_setting('app.system', true) = 'on')) WITH CHECK ((current_setting('app.system', true) = 'on'));