import { pgTable, index, foreignKey, pgPolicy, primaryKey, uuid, timestamp, text, date, varchar, smallint, numeric, boolean, integer, unique, jsonb, pgView, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const campaignStatus = pgEnum("campaign_status", ['draft', 'launching', 'active', 'stopped', 'completed'])
export const campaignType = pgEnum("campaign_type", ['outreach', 'ooo', 'nurture', 'ooo_followup'])
export const clientStatus = pgEnum("client_status", ['Active', 'Subscription', 'On hold', 'Offboarding', 'Inactive', 'Onboarding'])
export const crmPipelineStage = pgEnum("crm_pipeline_stage", ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'])
export const domainStatus = pgEnum("domain_status", ['active', 'warmup', 'blocked', 'retired'])
export const leadGender = pgEnum("lead_gender", ['male', 'female'])
export const leadQualification = pgEnum("lead_qualification", ['preMQL', 'MQL', 'meeting_scheduled', 'meeting_held', 'offer_sent', 'won', 'rejected'])
// `negative` + `neutral` added by 20260722b so outreach analytics can count them separately. The
// legacy labels stay — they are the live n8n contract and the value on every historical row; the
// mapping to the spec's domain names is documented in 11-integrations.md §6, not duplicated here.
export const replyClassification = pgEnum("reply_classification", ['OOO', 'Interested', 'NRR', 'Left_Company', 'Spam_Inbound', 'other', 'negative', 'neutral'])
export const userRole = pgEnum("user_role", ['super_admin', 'admin', 'master_admin', 'manager', 'client'])
export const meetingType = pgEnum("meeting_type", ['intro', 'summary', 'general'])
export const meetingStatus = pgEnum("meeting_status", ['planned', 'scheduled', 'held', 'cancelled', 'no_show'])
export const offerStatus = pgEnum("offer_status", ['planned', 'sent', 'accepted', 'rejected', 'cancelled'])
export const taskStatus = pgEnum("task_status", ['planned', 'in_progress', 'completed', 'cancelled', 'skipped'])
export const finalOutcome = pgEnum("final_outcome", ['won', 'lost', 'lost_premql'])
// ADR-0015 — OOO follow-up episode lifecycle. `submitted`/`confirmed` are NOT "active": see the
// uq_ooo_followups_active partial index in 20260722_ooo_model_tables.sql.
export const oooFollowupStatus = pgEnum("ooo_followup_status", ['pending', 'processing', 'submitted', 'confirmed', 'failed', 'skipped', 'cancelled'])
export const oooRoutingSource = pgEnum("ooo_routing_source", ['automatic', 'manual_override'])


export const leads = pgTable("leads", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	clientId: uuid("client_id").notNull(),
	campaignId: uuid("campaign_id"),
	email: text(),
	firstName: text("first_name"),
	lastName: text("last_name"),
	jobTitle: text("job_title"),
	companyName: text("company_name"),
	linkedinUrl: text("linkedin_url"),
	gender: leadGender(),
	qualification: leadQualification(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	externalId: text("external_id"),
	phoneNumber: varchar("phone_number", { length: 50 }),
	phoneSource: varchar("phone_source", { length: 30 }),
	industry: varchar({ length: 255 }),
	headcountRange: varchar("headcount_range", { length: 50 }),
	website: varchar({ length: 500 }),
	country: varchar({ length: 100 }),
	messageTitle: varchar("message_title", { length: 500 }),
	messageNumber: smallint("message_number"),
	responseTimeHours: numeric("response_time_hours", { precision: 8, scale:  2 }),
	responseTimeLabel: varchar("response_time_label", { length: 50 }),
	meetingBooked: boolean("meeting_booked").default(false).notNull(),
	meetingHeld: boolean("meeting_held").default(false).notNull(),
	offerSent: boolean("offer_sent").default(false).notNull(),
	won: boolean().default(false).notNull(),
	externalBlacklistId: integer("external_blacklist_id"),
	externalDomainBlacklistId: integer("external_domain_blacklist_id"),
	source: varchar({ length: 30 }).default('cold_email').notNull(),
	replyText: text("reply_text"),
	clientNote: text("client_note"),
	coldunicornNote: text("coldunicorn_note"),
	highlight: text(),
	sequencerId: uuid("sequencer_id").default(sql`'00000000-0000-4000-a000-000000000002'::uuid`).notNull(),
	linkedinInvitationSentAt: timestamp("linkedin_invitation_sent_at", { withTimezone: true, mode: 'string' }),
	contactMadeAt: timestamp("contact_made_at", { withTimezone: true, mode: 'string' }),
	contactMethod: text("contact_method"),
	negotiationStartedAt: timestamp("negotiation_started_at", { withTimezone: true, mode: 'string' }),
	conclusion: text(),
	concludedAt: timestamp("concluded_at", { withTimezone: true, mode: 'string' }),
	finalOutcome: finalOutcome("final_outcome"),
	// ADR-0015 provenance: which external contact this lead was promoted from, and the positive
	// reply that caused it. Both carry partial unique indexes (uq_leads_source_sequencer_contact,
	// uq_leads_origin_reply) — one contact never yields two leads, one reply never yields two leads.
	sourceSequencerContactId: uuid("source_sequencer_contact_id"),
	originReplyId: uuid("origin_reply_id"),
}, (table) => [
	index("idx_leads_email").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("idx_leads_qualification").using("btree", table.qualification.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.campaignId],
			foreignColumns: [campaigns.id],
			name: "leads_campaign_id_fkey"
		}),
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "leads_client_id_fkey"
		}),
	pgPolicy("leads_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: sql`private.can_access_client(client_id)` }),
	pgPolicy("leads_update_scoped", { as: "permissive", for: "update", to: ["authenticated"] }),
]);

export const dailyStats = pgTable("daily_stats", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clientId: uuid("client_id").notNull(),
	reportDate: date("report_date").notNull(),
	emailsSent: integer("emails_sent").default(0).notNull(),
	prospectsInBase: integer("prospects_in_base").default(0).notNull(),
	mqlCount: integer("mql_count").default(0).notNull(),
	meCount: integer("me_count").default(0).notNull(),
	responseCount: integer("response_count").default(0).notNull(),
	bounceCount: integer("bounce_count").default(0).notNull(),
	wonCount: integer("won_count").default(0).notNull(),
	negativeCount: integer("negative_count").default(0).notNull(),
	oooCount: integer("ooo_count").default(0).notNull(),
	humanRepliesCount: integer("human_replies_count").default(0).notNull(),
	inboxesCount: integer("inboxes_count").default(0).notNull(),
	prospectsCount: integer("prospects_count").default(0).notNull(),
	scheduleToday: integer("schedule_today"),
	scheduleTomorrow: integer("schedule_tomorrow"),
	scheduleDayAfter: integer("schedule_day_after"),
	weekNumber: smallint("week_number"),
	monthNumber: smallint("month_number"),
	year: smallint(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_daily_stats_date").using("btree", table.reportDate.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "daily_stats_client_id_fkey"
		}).onDelete("restrict"),
	unique("daily_stats_client_id_report_date_key").on(table.clientId, table.reportDate),
	pgPolicy("daily_stats_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(client_id IN ( SELECT clients.id
   FROM clients
  WHERE private.can_access_client(clients.id)))` }),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	email: text().notNull(),
	firstName: text("first_name").notNull(),
	lastName: text("last_name").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	role: userRole().notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	deactivatedAt: timestamp("deactivated_at", { withTimezone: true, mode: 'string' }),
	deactivatedBy: uuid("deactivated_by"),
	avatarPath: text("avatar_path"),
	avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	unique("users_email_key").on(table.email),
	pgPolicy("users_select_self", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(auth.uid() = id)` }),
	pgPolicy("users_select_internal", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("users_update_self", { as: "permissive", for: "update", to: ["authenticated"], using: sql`(auth.uid() = id)`, withCheck: sql`(auth.uid() = id)` }),
]);

export const campaigns = pgTable("campaigns", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	clientId: uuid("client_id").notNull(),
	externalId: text("external_id").notNull(),
	type: campaignType().notNull(),
	name: text().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: campaignStatus().notNull(),
	databaseSize: integer("database_size"),
	positiveResponses: integer("positive_responses").default(0).notNull(),
	startDate: date("start_date"),
	genderTarget: varchar("gender_target", { length: 10 }),
	// ADR-0012: sequencer attribution. DB default = EmailBison (fixed load-bearing UUID).
	sequencerId: uuid("sequencer_id").default(sql`'00000000-0000-4000-a000-000000000002'::uuid`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "campaigns_client_id_fkey"
		}),
	unique("campaigns_external_id_key").on(table.externalId),
	pgPolicy("campaigns_update_scoped", { as: "permissive", for: "update", to: ["authenticated"], using: sql`private.can_manage_client(client_id)`, withCheck: sql`private.can_manage_client(client_id)`  }),
	pgPolicy("campaigns_select_scoped", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

export const replies = pgTable("replies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	leadId: uuid("lead_id"),
	externalId: text("external_id").notNull(),
	sequenceStep: smallint("sequence_step"),
	messageSubject: text("message_subject"),
	messageText: text("message_text"),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).notNull(),
	clientId: uuid("client_id"),
	fromEmailAddress: varchar("from_email_address", { length: 255 }),
	isAutomatedReply: boolean("is_automated_reply").default(false).notNull(),
	classification: replyClassification(),
	shortReason: text("short_reason"),
	languageDetected: varchar("language_detected", { length: 10 }),
	isForwarded: boolean("is_forwarded").default(false).notNull(),
	// ADR-0015: a reply is anchored to the external contact, so it can exist before (or without) any
	// CRM lead. `leadId` stays nullable and is filled in when the contact is promoted.
	sequencerContactId: uuid("sequencer_contact_id"),
}, (table) => [
	index("idx_replies_classification").using("btree", table.classification.asc().nullsLast().op("enum_ops")),
	index("idx_replies_sequencer_contact").using("btree", table.sequencerContactId.asc().nullsLast().op("uuid_ops")),
	unique("replies_external_id_uk").on(table.externalId),
	index("idx_replies_client").using("btree", table.clientId.asc().nullsLast().op("uuid_ops")),
	index("idx_replies_received").using("btree", table.receivedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.leadId],
			foreignColumns: [leads.id],
			name: "replies_lead_id_fkey"
		}),
	pgPolicy("replies_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: sql`private.can_access_reply(client_id, lead_id)` }),
]);

export const clients = pgTable("clients", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	name: text().notNull(),
	managerId: uuid("manager_id"),
	kpiLeads: smallint("kpi_leads"),
	kpiMeetings: smallint("kpi_meetings"),
	contractedAmount: numeric("contracted_amount"),
	contractDueDate: date("contract_due_date"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: clientStatus().notNull(),
	minDailySent: smallint("min_daily_sent").default(0).notNull(),
	inboxesCount: smallint("inboxes_count").default(0).notNull(),
	crmConfig: jsonb("crm_config").default({}),
	smsPhoneNumbers: text("sms_phone_numbers").array(),
	notificationEmails: text("notification_emails").array(),
	autoOooEnabled: boolean("auto_ooo_enabled").default(false).notNull(),
	prospectsSigned: integer("prospects_signed").default(0).notNull(),
	prospectsAdded: integer("prospects_added").default(0).notNull(),
	setupInfo: text("setup_info"),
	biSetupDone: boolean("bi_setup_done").default(false).notNull(),
	lostReason: text("lost_reason"),
	notes: text(),
	satisfaction: smallint(),
}, (table) => [
	foreignKey({
			columns: [table.managerId],
			foreignColumns: [users.id],
			name: "clients_manager_id_fkey"
		}),
	pgPolicy("clients_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: sql`private.can_access_client(id)` }),
	pgPolicy("clients_update_scoped", { as: "permissive", for: "update", to: ["authenticated"] }),
]);

export const clientOooRouting = pgTable("client_ooo_routing", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	clientId: uuid("client_id").notNull(),
	// `gender` is superseded by `routingKey` and is dropped by the deferred
	// migrations/deferred/20260722z. Until then it is still written by pre-cutover n8n.
	gender: leadGender(),
	// ADR-0015: explicit 'male' | 'female' | 'general'. NULL is never an implicit "general" (spec §11).
	routingKey: text("routing_key").notNull(),
	campaignId: uuid("campaign_id").notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	// NOTE: the partial unique index uq_client_ooo_routing_active on (client_id, routing_key)
	// WHERE is_active lives only in 20260722_ooo_model_tables.sql — drizzle-kit does not model
	// partial indexes. At most one ACTIVE configuration per (client, routing key).
	foreignKey({
			columns: [table.campaignId],
			foreignColumns: [campaigns.id],
			name: "client_ooo_routing_campaign_id_fkey"
		}),
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "client_ooo_routing_client_id_fkey"
		}),
	pgPolicy("client_ooo_routing_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: sql`private.can_manage_client(client_id)` }),
	pgPolicy("client_ooo_routing_insert_scoped", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("client_ooo_routing_update_scoped", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("client_ooo_routing_delete_scoped", { as: "permissive", for: "delete", to: ["authenticated"] }),
]);

export const campaignDailyStats = pgTable("campaign_daily_stats", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	campaignId: uuid("campaign_id").notNull(),
	reportDate: date("report_date").notNull(),
	sentCount: smallint("sent_count").default(sql`'0'`),
	replyCount: smallint("reply_count").default(sql`'0'`),
	bounceCount: smallint("bounce_count").default(sql`'0'`),
	uniqueOpenCount: smallint("unique_open_count").default(sql`'0'`),
	inboxesActive: smallint("inboxes_active").notNull(),
	positiveRepliesCount: smallint("positive_replies_count").default(0).notNull(),
}, (table) => [
	index("campaign_daily_stats_campaign_id_idx").using("btree", table.campaignId.asc().nullsLast().op("uuid_ops")),
	index("campaign_daily_stats_report_date_idx").using("btree", table.reportDate.desc().nullsFirst().op("date_ops")),
	foreignKey({
			columns: [table.campaignId],
			foreignColumns: [campaigns.id],
			name: "campaign_daily_stats_campaign_id_fkey"
		}),
	unique("campaign_daily_stats_campaign_date_uk").on(table.campaignId, table.reportDate),
	pgPolicy("campaign_daily_stats_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(campaign_id IN ( SELECT c.id
   FROM campaigns c
  WHERE (private.can_access_client(c.client_id) AND ((private.current_app_role() <> 'client'::text) OR (c.type = 'outreach'::campaign_type)))))` }),
]);

export const invoices = pgTable("invoices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	clientId: uuid("client_id").notNull(),
	issueDate: date("issue_date").notNull(),
	amount: numeric().notNull(),
	status: text(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "invoices_client_id_fkey"
		}),
	pgPolicy("invoices_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: sql`private.can_access_client(client_id)` }),
	pgPolicy("invoices_insert_admin", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("invoices_update_admin", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("invoices_delete_admin", { as: "permissive", for: "delete", to: ["authenticated"] }),
]);

export const emailExcludeList = pgTable("email_exclude_list", {
	domain: text().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("email_exclude_list_select_internal", { as: "permissive", for: "select", to: ["authenticated"], using: sql`private.is_internal_user()` }),
	pgPolicy("email_exclude_list_insert_admin", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("email_exclude_list_update_admin", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("email_exclude_list_delete_admin", { as: "permissive", for: "delete", to: ["authenticated"] }),
]);

export const conditionRules = pgTable("condition_rules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	key: text().notNull(),
	name: text().notNull(),
	description: text(),
	targetEntity: text("target_entity").default('client').notNull(),
	surface: text().notNull(),
	metricKey: text("metric_key").notNull(),
	sourceSheet: text("source_sheet"),
	sourceRange: text("source_range"),
	scopeType: text("scope_type").default('global').notNull(),
	clientId: uuid("client_id"),
	managerId: uuid("manager_id"),
	applyTo: text("apply_to").default('cell').notNull(),
	columnKey: text("column_key"),
	branches: jsonb().notNull(),
	baseFilter: jsonb("base_filter"),
	priority: integer().default(100).notNull(),
	enabled: boolean().default(true).notNull(),
	notes: text(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_condition_rules_lookup").using("btree", table.targetEntity.asc().nullsLast().op("text_ops"), table.surface.asc().nullsLast().op("text_ops"), table.enabled.asc().nullsLast().op("bool_ops"), table.priority.asc().nullsLast().op("int4_ops")),
	index("idx_condition_rules_client_scope").using("btree", table.clientId.asc().nullsLast().op("uuid_ops")).where(sql`scope_type = 'client'::text`),
	index("idx_condition_rules_manager_scope").using("btree", table.managerId.asc().nullsLast().op("uuid_ops")).where(sql`scope_type = 'manager'::text`),
	unique("condition_rules_key_key").on(table.key),
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "condition_rules_client_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.managerId],
			foreignColumns: [users.id],
			name: "condition_rules_manager_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "condition_rules_created_by_fkey"
		}),
	pgPolicy("condition_rules_select_scoped", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("condition_rules_admin_insert", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("condition_rules_admin_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("condition_rules_admin_delete", { as: "permissive", for: "delete", to: ["authenticated"] }),
]);

export const agencyCrmDeals = pgTable("agency_crm_deals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	companyName: text("company_name"),
	contactName: text("contact_name"),
	email: text(),
	phone: text(),
	source: text(),
	salespersonId: uuid("salesperson_id").notNull(),
	stage: text(),
	stageUpdatedAt: timestamp("stage_updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	estimatedValue: numeric("estimated_value"),
	winChance: smallint("win_chance"),
	lessonLearned: text("lesson_learned"),
	updatedAt: date("updated_at").defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.salespersonId],
			foreignColumns: [users.id],
			name: "agency_crm_deals_salesperson_id_fkey"
		}),
	pgPolicy("agency_crm_deals_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(private.is_admin_user() OR ((private.current_app_role() = 'manager'::text) AND (salesperson_id = auth.uid())))` }),
	pgPolicy("agency_crm_deals_insert_scoped", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("agency_crm_deals_update_scoped", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("agency_crm_deals_delete_admin", { as: "permissive", for: "delete", to: ["authenticated"] }),
]);

export const clientUsers = pgTable("client_users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	clientId: uuid("client_id").notNull(),
	userId: uuid("user_id").notNull(),
}, (table) => [
	index("client_users_client_id_idx").using("btree", table.clientId.asc().nullsLast().op("uuid_ops")),
	index("client_users_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "client_users_client_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "client_users_user_id_fkey"
		}).onDelete("cascade"),
	unique("client_users_client_id_user_id_key").on(table.clientId, table.userId),
	unique("client_users_user_id_key").on(table.userId),
	pgPolicy("client_users_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(private.is_admin_user() OR (user_id = auth.uid()) OR ((private.current_app_role() = 'manager'::text) AND (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = client_users.client_id) AND (c.manager_id = auth.uid()))))))` }),
	pgPolicy("client_users_insert_admin", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("client_users_update_admin", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("client_users_delete_admin", { as: "permissive", for: "delete", to: ["authenticated"] }),
]);

export const domains = pgTable("domains", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Nullable since 20260720h — Winnr-synced domains have no agency link/setup/purchase data.
	clientId: uuid("client_id"),
	domainName: text("domain_name").notNull(),
	setupEmail: text("setup_email"),
	purchaseDate: date("purchase_date"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: domainStatus(),
	// Winnr sync fields (20260720f), ingestion-only — n8n writes them via service_role; the portal
	// only reads. Kept separate from the local domain_status enum above. (raw_payload / winnr_domain_id
	// / winnr_updated_at / last_seen_at exist in the DB but are intentionally not read by the gateway.)
	winnrStatus: text("winnr_status"),
	dnsProvider: text("dns_provider"),
	winnrTags: text("winnr_tags").array(),
	winnrEmailUserCount: integer("winnr_email_user_count"),
	winnrCreatedAt: timestamp("winnr_created_at", { withTimezone: true, mode: 'string' }),
	lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: 'string' }),
	missingSince: timestamp("missing_since", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "domains_client_id_fkey"
		}),
	pgPolicy("domains_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: sql`private.can_access_client(client_id)` }),
	pgPolicy("domains_insert_scoped", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("domains_update_scoped", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("domains_delete_scoped", { as: "permissive", for: "delete", to: ["authenticated"] }),
]);

// Ingestion-only (n8n via service_role writes; portal reads). Set-based SELECT RLS scoped through
// domain → client, mirroring replies / campaign_daily_stats (ADR-0006). See 20260720e migration.
// 20260720g: include unlinked (client_id null) domains for admin-tier callers so their mailboxes
// surface, matching domain visibility. is_admin_user() is a hoisted scalar — stays set-based.
const emailAccountSelect = sql`(domain_id IN ( SELECT d.id FROM domains d WHERE (d.client_id IN ( SELECT clients.id FROM clients WHERE private.can_access_client(clients.id))) OR (d.client_id IS NULL AND private.is_admin_user())))`;
const warmingDailySelect = sql`(email_account_id IN ( SELECT ea.id FROM email_accounts ea WHERE (ea.domain_id IN ( SELECT d.id FROM domains d WHERE (d.client_id IN ( SELECT clients.id FROM clients WHERE private.can_access_client(clients.id))) OR (d.client_id IS NULL AND private.is_admin_user())))))`;

export const emailAccounts = pgTable("email_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	domainId: uuid("domain_id").notNull(),
	winnrEmailUserId: text("winnr_email_user_id").notNull(),
	emailAddress: text("email_address").notNull(),
	username: text(),
	displayName: text("display_name"),
	status: text(),
	warmingStatus: text("warming_status"),
	warmingHealthScore: numeric("warming_health_score"),
	warmingInboxRate: numeric("warming_inbox_rate"),
	warmingSpamRate: numeric("warming_spam_rate"),
	warmingDailyVolume: integer("warming_daily_volume"),
	warmingProgress: numeric("warming_progress"),
	winnrCreatedAt: timestamp("winnr_created_at", { withTimezone: true, mode: 'string' }),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: 'string' }),
	missingSince: timestamp("missing_since", { withTimezone: true, mode: 'string' }),
	rawPayload: jsonb("raw_payload").default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("email_accounts_domain_id_idx").using("btree", table.domainId.asc().nullsLast()),
	index("email_accounts_warming_status_idx").using("btree", table.warmingStatus.asc().nullsLast()),
	// NOTE: the case-insensitive unique index email_accounts_email_uq on lower(email_address) lives
	// only in 20260720e_email_accounts_warming.sql — drizzle-kit does not model the lower() expression.
	foreignKey({ columns: [table.domainId], foreignColumns: [domains.id], name: "email_accounts_domain_id_fkey" }).onDelete("cascade"),
	unique("email_accounts_winnr_email_user_id_key").on(table.winnrEmailUserId),
	pgPolicy("email_accounts_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: emailAccountSelect }),
]);

export const emailAccountWarmingDaily = pgTable("email_account_warming_daily", {
	emailAccountId: uuid("email_account_id").notNull(),
	metricDate: date("metric_date").notNull(),
	warmingStatus: text("warming_status"),
	emailsSent: integer("emails_sent"),
	healthScore: numeric("health_score"),
	inboxRate: numeric("inbox_rate"),
	spamRate: numeric("spam_rate"),
	dailyVolume: integer("daily_volume"),
	warmupProgress: numeric("warmup_progress"),
	rawPayload: jsonb("raw_payload").default({}).notNull(),
	syncedAt: timestamp("synced_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("email_account_warming_date_idx").using("btree", table.metricDate.asc().nullsLast()),
	foreignKey({ columns: [table.emailAccountId], foreignColumns: [emailAccounts.id], name: "email_account_warming_daily_email_account_id_fkey" }).onDelete("cascade"),
	primaryKey({ columns: [table.emailAccountId, table.metricDate], name: "email_account_warming_daily_pkey" }),
	pgPolicy("email_account_warming_daily_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: warmingDailySelect }),
]);

export const domainWarmingSummary = pgView("domain_warming_summary", {
	domainId: uuid("domain_id"),
	emailAccountsCount: integer("email_accounts_count"),
	activeWarmingAccountsCount: integer("active_warming_accounts_count"),
	averageHealthScore: numeric("average_health_score"),
	lowestInboxRate: numeric("lowest_inbox_rate"),
	highestSpamRate: numeric("highest_spam_rate"),
}).with({"securityInvoker":"on"}).as(sql`SELECT d.id AS domain_id, count(ea.id)::integer AS email_accounts_count, count(ea.id) FILTER (WHERE ea.warming_status = 'active')::integer AS active_warming_accounts_count, avg(ea.warming_health_score) AS average_health_score, min(ea.warming_inbox_rate) AS lowest_inbox_rate, max(ea.warming_spam_rate) AS highest_spam_rate FROM domains d LEFT JOIN email_accounts ea ON ea.domain_id = d.id GROUP BY d.id`);

export const adminDashboardDaily = pgView("admin_dashboard_daily", {	reportDate: date("report_date"),
	clientId: uuid("client_id"),
	sentCount: integer("sent_count"),
	replyCount: integer("reply_count"),
	bounceCount: integer("bounce_count"),
	uniqueOpenCount: integer("unique_open_count"),
	positiveRepliesCount: integer("positive_replies_count"),
	inboxesActive: integer("inboxes_active"),
}).with({"securityInvoker":"on"}).as(sql`SELECT cds.report_date, c.client_id, sum(cds.sent_count)::integer AS sent_count, sum(cds.reply_count)::integer AS reply_count, sum(cds.bounce_count)::integer AS bounce_count, sum(cds.unique_open_count)::integer AS unique_open_count, sum(cds.positive_replies_count)::integer AS positive_replies_count, sum(cds.inboxes_active)::integer AS inboxes_active FROM campaign_daily_stats cds JOIN campaigns c ON c.id = cds.campaign_id WHERE cds.report_date >= (CURRENT_DATE - '21 days'::interval) GROUP BY cds.report_date, c.client_id`);

// --- Lead CRM child tables (ADR-0013, migrations 20260719*) -----------------------------------
const leadChildSelect = sql`(lead_id IN ( SELECT l.id FROM leads l WHERE (l.client_id IN ( SELECT clients.id FROM clients WHERE private.can_access_client(clients.id)))))`;
const leadChildWrite = sql`(lead_id IN ( SELECT l.id FROM leads l WHERE (l.client_id IN ( SELECT clients.id FROM clients WHERE private.can_manage_client(clients.id)))))`;

export const leadMeetings = pgTable("lead_meetings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id").notNull(),
	meetingType: meetingType("meeting_type").notNull(),
	status: meetingStatus().default('planned').notNull(),
	callScript: text("call_script"),
	scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: 'string' }),
	heldAt: timestamp("held_at", { withTimezone: true, mode: 'string' }),
	meetingUrl: text("meeting_url"),
	calendarEventId: text("calendar_event_id"),
	transcriptionUrl: text("transcription_url"),
	preMeetingInsights: text("pre_meeting_insights"),
	preMeetingInsightsGeneratedAt: timestamp("pre_meeting_insights_generated_at", { withTimezone: true, mode: 'string' }),
	processScore: numeric("process_score", { precision: 5, scale: 2 }),
	conversionInsights: text("conversion_insights"),
	postMeetingAnalysisGeneratedAt: timestamp("post_meeting_analysis_generated_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lead_meetings_lead_type").using("btree", table.leadId.asc().nullsLast(), table.meetingType.asc().nullsLast()),
	// NOTE: two partial unique indexes (uq_lead_meetings_intro / uq_lead_meetings_summary, one intro +
	// one summary per lead) live only in 20260719_lead_crm_tables.sql — drizzle-kit does not model the
	// `WHERE meeting_type = …` predicate, so they are intentionally not declared here.
	foreignKey({ columns: [table.leadId], foreignColumns: [leads.id], name: "lead_meetings_lead_id_fkey" }).onDelete("cascade"),
	pgPolicy("lead_meetings_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: leadChildSelect }),
	pgPolicy("lead_meetings_write_scoped", { as: "permissive", for: "all", to: ["authenticated"], using: leadChildWrite, withCheck: leadChildWrite }),
]);

export const leadOffers = pgTable("lead_offers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id").notNull(),
	status: offerStatus().default('planned').notNull(),
	contractedSendDate: date("contracted_send_date"),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	offerUrl: text("offer_url"),
	notes: text(),
	sourceMeetingId: uuid("source_meeting_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lead_offers_lead_created").using("btree", table.leadId.asc().nullsLast(), table.createdAt.desc().nullsLast()),
	foreignKey({ columns: [table.leadId], foreignColumns: [leads.id], name: "lead_offers_lead_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.sourceMeetingId], foreignColumns: [leadMeetings.id], name: "lead_offers_source_meeting_id_fkey" }).onDelete("set null"),
	pgPolicy("lead_offers_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: leadChildSelect }),
	pgPolicy("lead_offers_write_scoped", { as: "permissive", for: "all", to: ["authenticated"], using: leadChildWrite, withCheck: leadChildWrite }),
]);

export const leadTasks = pgTable("lead_tasks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id").notNull(),
	title: text().notNull(),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'string' }),
	status: taskStatus().default('planned').notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	sourceMeetingId: uuid("source_meeting_id"),
	notes: text(),
	position: smallint().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lead_tasks_lead_status_due").using("btree", table.leadId.asc().nullsLast(), table.status.asc().nullsLast(), table.dueAt.asc().nullsLast()),
	foreignKey({ columns: [table.leadId], foreignColumns: [leads.id], name: "lead_tasks_lead_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.sourceMeetingId], foreignColumns: [leadMeetings.id], name: "lead_tasks_source_meeting_id_fkey" }).onDelete("set null"),
	pgPolicy("lead_tasks_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: leadChildSelect }),
	pgPolicy("lead_tasks_write_scoped", { as: "permissive", for: "all", to: ["authenticated"], using: leadChildWrite, withCheck: leadChildWrite }),
]);

export const leadValueDeliveries = pgTable("lead_value_deliveries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id").notNull(),
	sequenceNumber: smallint("sequence_number").notNull(),
	plannedDate: date("planned_date"),
	valueItems: text("value_items").array().default(sql`'{}'::text[]`).notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	sourceMeetingId: uuid("source_meeting_id"),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("uq_lead_value_deliveries_seq").on(table.leadId, table.sequenceNumber),
	foreignKey({ columns: [table.leadId], foreignColumns: [leads.id], name: "lead_value_deliveries_lead_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.sourceMeetingId], foreignColumns: [leadMeetings.id], name: "lead_value_deliveries_source_meeting_id_fkey" }).onDelete("set null"),
	pgPolicy("lead_value_deliveries_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: leadChildSelect }),
	pgPolicy("lead_value_deliveries_write_scoped", { as: "permissive", for: "all", to: ["authenticated"], using: leadChildWrite, withCheck: leadChildWrite }),
]);

// --- OOO model (ADR-0015, migrations 20260722*) ------------------------------------------------
// Client scope is reached through client_sequencers, so both policies are one set-based semijoin
// (ADR-0006). Both use can_manage_client, not can_access_client: an OOO/NRR contact is precisely a
// person who is NOT a CRM lead, and the `client` role must not see that population (spec §17).
const sequencerContactScope = sql`(client_sequencer_id IN ( SELECT cs.id FROM client_sequencers cs WHERE (cs.client_id IN ( SELECT clients.id FROM clients WHERE private.can_manage_client(clients.id)))))`;
const oooFollowupScope = sql`(sequencer_contact_id IN ( SELECT sc.id FROM sequencer_contacts sc WHERE (sc.client_sequencer_id IN ( SELECT cs.id FROM client_sequencers cs WHERE (cs.client_id IN ( SELECT clients.id FROM clients WHERE private.can_manage_client(clients.id)))))))`;

// Per-client sequencer credentials (ADR-0012). Previously read by the gateway through raw SQL only;
// modelled here because sequencer_contacts hangs off it and the OOO read model joins through it.
export const clientSequencers = pgTable("client_sequencers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clientId: uuid("client_id").notNull(),
	sequencerId: uuid("sequencer_id").notNull(),
	apiKey: text("api_key"),
	externalWorkspaceId: text("external_workspace_id"),
	settings: jsonb().default({}).notNull(),
	enabled: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Last verdict of the workspace-setup workflows (20260807). Shaped like setup-result.schema.json
	// minus `candidates`, and never containing a secret. `{}` = never checked — tell that apart from
	// "checked and empty" via setupCheckedAt, not via this.
	setupState: jsonb("setup_state").default({}).notNull(),
	setupCheckedAt: timestamp("setup_checked_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_client_sequencers_sequencer").using("btree", table.sequencerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({ columns: [table.clientId], foreignColumns: [clients.id], name: "client_sequencers_client_id_fkey" }).onDelete("cascade"),
	unique("client_sequencers_client_id_sequencer_id_key").on(table.clientId, table.sequencerId),
]);

// Local identity of an external contact. The natural key is SCOPED — an external contact id means
// nothing without the workspace it came from (spec §2). Holds no CRM state by design.
export const sequencerContacts = pgTable("sequencer_contacts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clientSequencerId: uuid("client_sequencer_id").notNull(),
	externalContactId: text("external_contact_id").notNull(),
	email: text(),
	firstName: text("first_name"),
	lastName: text("last_name"),
	routingKey: text("routing_key").default('general').notNull(),
	firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	rawPayload: jsonb("raw_payload").default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	// NOTE: idx_sequencer_contacts_email is on lower(email) — expression indexes are not modelled here.
	foreignKey({ columns: [table.clientSequencerId], foreignColumns: [clientSequencers.id], name: "sequencer_contacts_client_sequencer_id_fkey" }).onDelete("cascade"),
	unique("uq_sequencer_contacts_identity").on(table.clientSequencerId, table.externalContactId),
	pgPolicy("sequencer_contacts_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: sequencerContactScope }),
]);

// One OOO episode. Never hard-deleted — cancel is a status change so the detection, the dates, the
// attempts and the reason survive (spec §6).
export const oooFollowups = pgTable("ooo_followups", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sequencerContactId: uuid("sequencer_contact_id").notNull(),
	sourceReplyId: uuid("source_reply_id"),
	/** The date actually determined from the reply. NULL when undetermined — never a fallback. */
	expectedReturnDate: date("expected_return_date"),
	/** When to re-enrol. MAY come from a fallback rule; that is what date_source records. */
	scheduledFor: date("scheduled_for").notNull(),
	dateSource: text("date_source").notNull(),
	status: oooFollowupStatus().default('pending').notNull(),
	/** Routing SNAPSHOT — a finished episode keeps showing the campaign it actually went to. */
	routingKey: text("routing_key").notNull(),
	targetCampaignId: uuid("target_campaign_id"),
	routingSource: oooRoutingSource("routing_source").default('automatic').notNull(),
	/** Last attempt only — NOT a per-attempt audit trail. Do not document it as attempt history. */
	attemptCount: integer("attempt_count").default(0).notNull(),
	nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: 'string' }),
	lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: 'string' }),
	submittedAt: timestamp("submitted_at", { withTimezone: true, mode: 'string' }),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	cancellationReason: text("cancellation_reason"),
	skipReason: text("skip_reason"),
	lastError: text("last_error"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_ooo_followups_due").using("btree", table.status.asc().nullsLast(), table.scheduledFor.asc().nullsLast()),
	index("idx_ooo_followups_contact").using("btree", table.sequencerContactId.asc().nullsLast().op("uuid_ops")),
	// NOTE: the two partial unique indexes that carry the real invariants live only in
	// 20260722_ooo_model_tables.sql (drizzle-kit does not model partial indexes):
	//   uq_ooo_followups_active       — one ACTIVE (pending|processing|failed) episode per contact
	//   uq_ooo_followups_source_reply — one episode per source reply, which survives `submitted`
	foreignKey({ columns: [table.sequencerContactId], foreignColumns: [sequencerContacts.id], name: "ooo_followups_sequencer_contact_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.sourceReplyId], foreignColumns: [replies.id], name: "ooo_followups_source_reply_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.targetCampaignId], foreignColumns: [campaigns.id], name: "ooo_followups_target_campaign_id_fkey" }).onDelete("set null"),
	pgPolicy("ooo_followups_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: oooFollowupScope }),
	pgPolicy("ooo_followups_update_scoped", { as: "permissive", for: "update", to: ["authenticated"], using: oooFollowupScope, withCheck: oooFollowupScope }),
]);
