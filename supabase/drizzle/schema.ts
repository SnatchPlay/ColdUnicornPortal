import { pgTable, index, foreignKey, pgPolicy, uuid, timestamp, text, date, varchar, smallint, numeric, boolean, integer, unique, jsonb, pgView, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const campaignStatus = pgEnum("campaign_status", ['draft', 'launching', 'active', 'stopped', 'completed'])
export const campaignType = pgEnum("campaign_type", ['outreach', 'ooo', 'nurture', 'ooo_followup'])
export const clientStatus = pgEnum("client_status", ['Active', 'Abo', 'On hold', 'Offboarding', 'Inactive', 'Sales'])
export const crmPipelineStage = pgEnum("crm_pipeline_stage", ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'])
export const domainStatus = pgEnum("domain_status", ['active', 'warmup', 'blocked', 'retired'])
export const leadGender = pgEnum("lead_gender", ['male', 'female'])
export const leadQualification = pgEnum("lead_qualification", ['preMQL', 'MQL', 'meeting_scheduled', 'meeting_held', 'offer_sent', 'won', 'rejected', 'OOO', 'NRR'])
export const replyClassification = pgEnum("reply_classification", ['OOO', 'Interested', 'NRR', 'Left_Company', 'Spam_Inbound', 'other'])
export const userRole = pgEnum("user_role", ['super_admin', 'admin', 'manager', 'client'])


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
	expectedReturnDate: date("expected_return_date"),
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
	addedToOooCampaign: boolean("added_to_ooo_campaign").default(false).notNull(),
	externalBlacklistId: integer("external_blacklist_id"),
	externalDomainBlacklistId: integer("external_domain_blacklist_id"),
	source: varchar({ length: 30 }).default('cold_email').notNull(),
	replyText: text("reply_text"),
	comments: text(),
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
}, (table) => [
	index("idx_replies_classification").using("btree", table.classification.asc().nullsLast().op("enum_ops")),
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
	managerId: uuid("manager_id").notNull(),
	kpiLeads: smallint("kpi_leads"),
	kpiMeetings: smallint("kpi_meetings"),
	contractedAmount: numeric("contracted_amount"),
	contractDueDate: date("contract_due_date"),
	externalWorkspaceId: integer("external_workspace_id"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: clientStatus().notNull(),
	externalApiKey: text("external_api_key"),
	minDailySent: smallint("min_daily_sent").default(0).notNull(),
	inboxesCount: smallint("inboxes_count").default(0).notNull(),
	crmConfig: jsonb("crm_config").default({}),
	smsPhoneNumbers: text("sms_phone_numbers").array(),
	notificationEmails: text("notification_emails").array(),
	autoOooEnabled: boolean("auto_ooo_enabled").default(false).notNull(),
	linkedinApiKey: text("linkedin_api_key"),
	prospectsSigned: integer("prospects_signed").default(0).notNull(),
	prospectsAdded: integer("prospects_added").default(0).notNull(),
	setupInfo: text("setup_info"),
	biSetupDone: boolean("bi_setup_done").default(false).notNull(),
	lostReason: text("lost_reason"),
	notes: text(),
}, (table) => [
	foreignKey({
			columns: [table.managerId],
			foreignColumns: [users.id],
			name: "clients_manager_id_fkey"
		}),
	unique("clients_external_workspace_id_key").on(table.externalWorkspaceId),
	pgPolicy("clients_select_scoped", { as: "permissive", for: "select", to: ["authenticated"], using: sql`private.can_access_client(id)` }),
	pgPolicy("clients_update_scoped", { as: "permissive", for: "update", to: ["authenticated"] }),
]);

export const clientOooRouting = pgTable("client_ooo_routing", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	clientId: uuid("client_id").notNull(),
	gender: leadGender(),
	campaignId: uuid("campaign_id").notNull(),
	isActive: boolean("is_active").default(true),
}, (table) => [
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
	clientId: uuid("client_id").notNull(),
	domainName: text("domain_name").notNull(),
	setupEmail: text("setup_email").notNull(),
	purchaseDate: date("purchase_date").notNull(),
	exchangeDate: date("exchange_date").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: domainStatus(),
	reputation: text(),
	exchangeCost: numeric("exchange_cost", { precision: 8, scale:  2 }),
	campaignVerifiedAt: date("campaign_verified_at"),
	warmupVerifiedAt: date("warmup_verified_at"),
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
export const adminDashboardDaily = pgView("admin_dashboard_daily", {	reportDate: date("report_date"),
	clientId: uuid("client_id"),
	sentCount: integer("sent_count"),
	replyCount: integer("reply_count"),
	bounceCount: integer("bounce_count"),
	uniqueOpenCount: integer("unique_open_count"),
	positiveRepliesCount: integer("positive_replies_count"),
	inboxesActive: integer("inboxes_active"),
}).with({"securityInvoker":"on"}).as(sql`SELECT cds.report_date, c.client_id, sum(cds.sent_count)::integer AS sent_count, sum(cds.reply_count)::integer AS reply_count, sum(cds.bounce_count)::integer AS bounce_count, sum(cds.unique_open_count)::integer AS unique_open_count, sum(cds.positive_replies_count)::integer AS positive_replies_count, sum(cds.inboxes_active)::integer AS inboxes_active FROM campaign_daily_stats cds JOIN campaigns c ON c.id = cds.campaign_id WHERE cds.report_date >= (CURRENT_DATE - '21 days'::interval) GROUP BY cds.report_date, c.client_id`);
