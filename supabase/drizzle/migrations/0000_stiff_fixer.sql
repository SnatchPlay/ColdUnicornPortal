-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'launching', 'active', 'stopped', 'completed');--> statement-breakpoint
CREATE TYPE "public"."campaign_type" AS ENUM('outreach', 'ooo', 'nurture', 'ooo_followup');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('Active', 'Abo', 'On hold', 'Offboarding', 'Inactive', 'Sales');--> statement-breakpoint
CREATE TYPE "public"."crm_pipeline_stage" AS ENUM('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('active', 'warmup', 'blocked', 'retired');--> statement-breakpoint
CREATE TYPE "public"."lead_gender" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."lead_qualification" AS ENUM('preMQL', 'MQL', 'meeting_scheduled', 'meeting_held', 'offer_sent', 'won', 'rejected', 'OOO', 'NRR');--> statement-breakpoint
CREATE TYPE "public"."reply_classification" AS ENUM('OOO', 'Interested', 'NRR', 'Left_Company', 'Spam_Inbound', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'admin', 'manager', 'client');--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid,
	"email" text,
	"first_name" text,
	"last_name" text,
	"job_title" text,
	"company_name" text,
	"linkedin_url" text,
	"gender" "lead_gender",
	"qualification" "lead_qualification",
	"expected_return_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_id" text,
	"phone_number" varchar(50),
	"phone_source" varchar(30),
	"industry" varchar(255),
	"headcount_range" varchar(50),
	"website" varchar(500),
	"country" varchar(100),
	"message_title" varchar(500),
	"message_number" smallint,
	"response_time_hours" numeric(8, 2),
	"response_time_label" varchar(50),
	"meeting_booked" boolean DEFAULT false NOT NULL,
	"meeting_held" boolean DEFAULT false NOT NULL,
	"offer_sent" boolean DEFAULT false NOT NULL,
	"won" boolean DEFAULT false NOT NULL,
	"added_to_ooo_campaign" boolean DEFAULT false NOT NULL,
	"external_blacklist_id" integer,
	"external_domain_blacklist_id" integer,
	"source" varchar(30) DEFAULT 'cold_email' NOT NULL,
	"reply_text" text,
	"comments" text
);
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"report_date" date NOT NULL,
	"emails_sent" integer DEFAULT 0 NOT NULL,
	"prospects_in_base" integer DEFAULT 0 NOT NULL,
	"mql_count" integer DEFAULT 0 NOT NULL,
	"me_count" integer DEFAULT 0 NOT NULL,
	"response_count" integer DEFAULT 0 NOT NULL,
	"bounce_count" integer DEFAULT 0 NOT NULL,
	"won_count" integer DEFAULT 0 NOT NULL,
	"negative_count" integer DEFAULT 0 NOT NULL,
	"ooo_count" integer DEFAULT 0 NOT NULL,
	"human_replies_count" integer DEFAULT 0 NOT NULL,
	"inboxes_count" integer DEFAULT 0 NOT NULL,
	"prospects_count" integer DEFAULT 0 NOT NULL,
	"schedule_today" integer,
	"schedule_tomorrow" integer,
	"schedule_day_after" integer,
	"week_number" smallint,
	"month_number" smallint,
	"year" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_stats_client_id_report_date_key" UNIQUE("client_id","report_date")
);
--> statement-breakpoint
ALTER TABLE "daily_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"role" "user_role" NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"type" "campaign_type" NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "campaign_status" NOT NULL,
	"database_size" integer,
	"positive_responses" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"gender_target" varchar(10),
	CONSTRAINT "campaigns_external_id_key" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_id" uuid,
	"external_id" text NOT NULL,
	"sequence_step" smallint,
	"message_subject" text,
	"message_text" text,
	"received_at" timestamp with time zone NOT NULL,
	"client_id" uuid,
	"from_email_address" varchar(255),
	"is_automated_reply" boolean DEFAULT false NOT NULL,
	"classification" "reply_classification",
	"short_reason" text,
	"language_detected" varchar(10),
	"is_forwarded" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"manager_id" uuid NOT NULL,
	"kpi_leads" smallint,
	"kpi_meetings" smallint,
	"contracted_amount" numeric,
	"contract_due_date" date,
	"external_workspace_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "client_status" NOT NULL,
	"external_api_key" text,
	"min_daily_sent" smallint DEFAULT 0 NOT NULL,
	"inboxes_count" smallint DEFAULT 0 NOT NULL,
	"crm_config" jsonb DEFAULT '{}'::jsonb,
	"sms_phone_numbers" text[],
	"notification_emails" text[],
	"auto_ooo_enabled" boolean DEFAULT false NOT NULL,
	"linkedin_api_key" text,
	"prospects_signed" integer DEFAULT 0 NOT NULL,
	"prospects_added" integer DEFAULT 0 NOT NULL,
	"setup_info" text,
	"bi_setup_done" boolean DEFAULT false NOT NULL,
	"lost_reason" text,
	"notes" text,
	CONSTRAINT "clients_external_workspace_id_key" UNIQUE("external_workspace_id")
);
--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "client_ooo_routing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" uuid NOT NULL,
	"gender" "lead_gender",
	"campaign_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
ALTER TABLE "client_ooo_routing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"report_date" date NOT NULL,
	"sent_count" smallint DEFAULT '0',
	"reply_count" smallint DEFAULT '0',
	"bounce_count" smallint DEFAULT '0',
	"unique_open_count" smallint DEFAULT '0',
	"inboxes_active" smallint NOT NULL,
	"positive_replies_count" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "campaign_daily_stats_campaign_date_uk" UNIQUE("campaign_id","report_date")
);
--> statement-breakpoint
ALTER TABLE "campaign_daily_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" uuid NOT NULL,
	"issue_date" date NOT NULL,
	"amount" numeric NOT NULL,
	"status" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_exclude_list" (
	"domain" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_exclude_list" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agency_crm_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company_name" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"source" text,
	"salesperson_id" uuid NOT NULL,
	"stage" text,
	"stage_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"estimated_value" numeric,
	"win_chance" smallint,
	"lesson_learned" text,
	"updated_at" date DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agency_crm_deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "client_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "client_users_client_id_user_id_key" UNIQUE("client_id","user_id"),
	CONSTRAINT "client_users_user_id_key" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "client_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" uuid NOT NULL,
	"domain_name" text NOT NULL,
	"setup_email" text NOT NULL,
	"purchase_date" date NOT NULL,
	"exchange_date" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "domain_status",
	"reputation" text,
	"exchange_cost" numeric(8, 2),
	"campaign_verified_at" date,
	"warmup_verified_at" date
);
--> statement-breakpoint
ALTER TABLE "domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_ooo_routing" ADD CONSTRAINT "client_ooo_routing_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_ooo_routing" ADD CONSTRAINT "client_ooo_routing_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_daily_stats" ADD CONSTRAINT "campaign_daily_stats_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_crm_deals" ADD CONSTRAINT "agency_crm_deals_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_leads_email" ON "leads" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "idx_leads_qualification" ON "leads" USING btree ("qualification" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_daily_stats_date" ON "daily_stats" USING btree ("report_date" date_ops);--> statement-breakpoint
CREATE INDEX "idx_replies_classification" ON "replies" USING btree ("classification" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_replies_client" ON "replies" USING btree ("client_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_replies_received" ON "replies" USING btree ("received_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "campaign_daily_stats_campaign_id_idx" ON "campaign_daily_stats" USING btree ("campaign_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "campaign_daily_stats_report_date_idx" ON "campaign_daily_stats" USING btree ("report_date" date_ops);--> statement-breakpoint
CREATE INDEX "client_users_client_id_idx" ON "client_users" USING btree ("client_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "client_users_user_id_idx" ON "client_users" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE VIEW "public"."admin_dashboard_daily" WITH (security_invoker = on) AS (SELECT cds.report_date, c.client_id, sum(cds.sent_count)::integer AS sent_count, sum(cds.reply_count)::integer AS reply_count, sum(cds.bounce_count)::integer AS bounce_count, sum(cds.unique_open_count)::integer AS unique_open_count, sum(cds.positive_replies_count)::integer AS positive_replies_count, sum(cds.inboxes_active)::integer AS inboxes_active FROM campaign_daily_stats cds JOIN campaigns c ON c.id = cds.campaign_id WHERE cds.report_date >= (CURRENT_DATE - '21 days'::interval) GROUP BY cds.report_date, c.client_id);--> statement-breakpoint
CREATE POLICY "leads_select_scoped" ON "leads" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.can_access_client(client_id));--> statement-breakpoint
CREATE POLICY "leads_update_scoped" ON "leads" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "daily_stats_select_scoped" ON "daily_stats" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((client_id IN ( SELECT clients.id
   FROM clients
  WHERE private.can_access_client(clients.id))));--> statement-breakpoint
CREATE POLICY "users_select_self" ON "users" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((auth.uid() = id));--> statement-breakpoint
CREATE POLICY "users_select_internal" ON "users" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "campaigns_update_scoped" ON "campaigns" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.can_manage_client(client_id)) WITH CHECK (private.can_manage_client(client_id));--> statement-breakpoint
CREATE POLICY "campaigns_select_scoped" ON "campaigns" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "replies_select_scoped" ON "replies" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.can_access_reply(client_id, lead_id));--> statement-breakpoint
CREATE POLICY "clients_select_scoped" ON "clients" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.can_access_client(id));--> statement-breakpoint
CREATE POLICY "clients_update_scoped" ON "clients" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "client_ooo_routing_select_scoped" ON "client_ooo_routing" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.can_manage_client(client_id));--> statement-breakpoint
CREATE POLICY "client_ooo_routing_insert_scoped" ON "client_ooo_routing" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "client_ooo_routing_update_scoped" ON "client_ooo_routing" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "client_ooo_routing_delete_scoped" ON "client_ooo_routing" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "campaign_daily_stats_select_scoped" ON "campaign_daily_stats" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((campaign_id IN ( SELECT c.id
   FROM campaigns c
  WHERE (private.can_access_client(c.client_id) AND ((private.current_app_role() <> 'client'::text) OR (c.type = 'outreach'::campaign_type))))));--> statement-breakpoint
CREATE POLICY "invoices_select_scoped" ON "invoices" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.can_access_client(client_id));--> statement-breakpoint
CREATE POLICY "invoices_insert_admin" ON "invoices" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "invoices_update_admin" ON "invoices" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "invoices_delete_admin" ON "invoices" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "email_exclude_list_select_internal" ON "email_exclude_list" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_internal_user());--> statement-breakpoint
CREATE POLICY "email_exclude_list_insert_admin" ON "email_exclude_list" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "email_exclude_list_update_admin" ON "email_exclude_list" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "email_exclude_list_delete_admin" ON "email_exclude_list" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "agency_crm_deals_select_scoped" ON "agency_crm_deals" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((private.is_admin_user() OR ((private.current_app_role() = 'manager'::text) AND (salesperson_id = auth.uid()))));--> statement-breakpoint
CREATE POLICY "agency_crm_deals_insert_scoped" ON "agency_crm_deals" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "agency_crm_deals_update_scoped" ON "agency_crm_deals" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "agency_crm_deals_delete_admin" ON "agency_crm_deals" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "client_users_select_scoped" ON "client_users" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((private.is_admin_user() OR (user_id = auth.uid()) OR ((private.current_app_role() = 'manager'::text) AND (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = client_users.client_id) AND (c.manager_id = auth.uid())))))));--> statement-breakpoint
CREATE POLICY "client_users_insert_admin" ON "client_users" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "client_users_update_admin" ON "client_users" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "client_users_delete_admin" ON "client_users" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "domains_select_scoped" ON "domains" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.can_access_client(client_id));--> statement-breakpoint
CREATE POLICY "domains_insert_scoped" ON "domains" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "domains_update_scoped" ON "domains" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "domains_delete_scoped" ON "domains" AS PERMISSIVE FOR DELETE TO "authenticated";
*/