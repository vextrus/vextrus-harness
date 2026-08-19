CREATE TABLE "seam_probe_ledger" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"row_id" uuid NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seam_probe_ledger_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "seam_probe_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seam_probe_rows" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seam_probe_rows_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "seam_probe_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seam_probe_ledger" ADD CONSTRAINT "seam_probe_ledger_row_fkey" FOREIGN KEY ("tenant_id","row_id") REFERENCES "public"."seam_probe_rows"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seam_probe_rows" ADD CONSTRAINT "seam_probe_rows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "seam_probe_ledger_tenant_isolation" ON "seam_probe_ledger" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.system', true) = 'on')) WITH CHECK ((tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.system', true) = 'on'));--> statement-breakpoint
CREATE POLICY "seam_probe_rows_tenant_isolation" ON "seam_probe_rows" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.system', true) = 'on')) WITH CHECK ((tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.system', true) = 'on'));--> statement-breakpoint
CREATE POLICY "tenants_tenant_isolation" ON "tenants" AS PERMISSIVE FOR ALL TO public USING ((id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.system', true) = 'on')) WITH CHECK ((id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.system', true) = 'on'));
