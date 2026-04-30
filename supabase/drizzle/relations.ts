import { relations } from "drizzle-orm/relations";
import { campaigns, leads, clients, dailyStats, replies, users, clientOooRouting, campaignDailyStats, invoices, agencyCrmDeals, clientUsers, domains, conditionRules } from "./schema";

export const leadsRelations = relations(leads, ({one, many}) => ({
	campaign: one(campaigns, {
		fields: [leads.campaignId],
		references: [campaigns.id]
	}),
	client: one(clients, {
		fields: [leads.clientId],
		references: [clients.id]
	}),
	replies: many(replies),
}));

export const campaignsRelations = relations(campaigns, ({one, many}) => ({
	leads: many(leads),
	client: one(clients, {
		fields: [campaigns.clientId],
		references: [clients.id]
	}),
	clientOooRoutings: many(clientOooRouting),
	campaignDailyStats: many(campaignDailyStats),
}));

export const clientsRelations = relations(clients, ({one, many}) => ({
	leads: many(leads),
	dailyStats: many(dailyStats),
	campaigns: many(campaigns),
	user: one(users, {
		fields: [clients.managerId],
		references: [users.id]
	}),
	clientOooRoutings: many(clientOooRouting),
	invoices: many(invoices),
	clientUsers: many(clientUsers),
	domains: many(domains),
	conditionRules: many(conditionRules),
}));

export const dailyStatsRelations = relations(dailyStats, ({one}) => ({
	client: one(clients, {
		fields: [dailyStats.clientId],
		references: [clients.id]
	}),
}));

export const repliesRelations = relations(replies, ({one}) => ({
	lead: one(leads, {
		fields: [replies.leadId],
		references: [leads.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	clients: many(clients),
	agencyCrmDeals: many(agencyCrmDeals),
	clientUsers: many(clientUsers),
}));

export const clientOooRoutingRelations = relations(clientOooRouting, ({one}) => ({
	campaign: one(campaigns, {
		fields: [clientOooRouting.campaignId],
		references: [campaigns.id]
	}),
	client: one(clients, {
		fields: [clientOooRouting.clientId],
		references: [clients.id]
	}),
}));

export const campaignDailyStatsRelations = relations(campaignDailyStats, ({one}) => ({
	campaign: one(campaigns, {
		fields: [campaignDailyStats.campaignId],
		references: [campaigns.id]
	}),
}));

export const invoicesRelations = relations(invoices, ({one}) => ({
	client: one(clients, {
		fields: [invoices.clientId],
		references: [clients.id]
	}),
}));

export const agencyCrmDealsRelations = relations(agencyCrmDeals, ({one}) => ({
	user: one(users, {
		fields: [agencyCrmDeals.salespersonId],
		references: [users.id]
	}),
}));

export const clientUsersRelations = relations(clientUsers, ({one}) => ({
	client: one(clients, {
		fields: [clientUsers.clientId],
		references: [clients.id]
	}),
	user: one(users, {
		fields: [clientUsers.userId],
		references: [users.id]
	}),
}));

export const domainsRelations = relations(domains, ({one}) => ({
	client: one(clients, {
		fields: [domains.clientId],
		references: [clients.id]
	}),
}));

export const conditionRulesRelations = relations(conditionRules, ({one}) => ({
	client: one(clients, {
		fields: [conditionRules.clientId],
		references: [clients.id]
	}),
	manager: one(users, {
		fields: [conditionRules.managerId],
		references: [users.id]
	}),
}));
