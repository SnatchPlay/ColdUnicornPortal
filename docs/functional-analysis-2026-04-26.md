---
title: Функціональний аналіз ColdUnicorn PDCA Portal — хто, що, де може
date: 2026-04-26
author: Claude (Playwright-driven functional audit)
scope: 3 ролі × всі сторінки × інтерактивні стани (drawer-и, форми, табі)
data: жива Supabase (project bnetnuzxynmdftiadwef), реальні аккаунти, реальні mutation-и
companion: docs/visual-analysis-2026-04-26.md
---

# Функціональний аналіз — ColdUnicorn PDCA Portal

**Версія:** main @ `8c52143` · **Дата:** 2026-04-26
**Метод:** автоматизований Playwright-обхід під трьох ролей з відкриттям drawer-ів, заповненням форм, перемиканням табів. Кросс-перевірка з [`repository.ts`](../src/app/data/repository.ts), [09-mutations-rls.md](reference/functional/09-mutations-rls.md), RLS-політиками.

---

## 0. Як цей звіт читати

- Документ відповідає на питання: **що бачить кожна роль, що може редагувати/створювати/видаляти, де UI має дірки**.
- Усі screenshot-и під шляхом [`docs/screenshots/functional-analysis-2026-04-26/`](screenshots/functional-analysis-2026-04-26/) — повноекранні; зменшені 1600 px-превʼю в [`thumbs/`](screenshots/functional-analysis-2026-04-26/thumbs/).
- Базові скріни кожної сторінки (без інтеракції) лишаються в [`docs/screenshots/visual-analysis-2026-04-26/`](screenshots/visual-analysis-2026-04-26/).
- Цитати коду = посилання `path#Lstart-Lend` — клікабельні.
- **Що зараз бракує** — це окрема секція в кінці кожної ролі. Не баги, а логічні наступні кроки.

---

## 1. Архітектурна основа доступу

> Прочитати один раз — далі йдеться про деталі.

### 1.1 Ролі та scope-функції

| Роль | Як визначається | Scope при читанні | Scope при записі |
|------|-----------------|-------------------|------------------|
| `client` | `auth.users.app_metadata.role = 'client'` + рядок у `client_users` | RLS обмежує до `clients.id IN (client_users WHERE user_id = auth.uid())`; UI ще раз фільтрує через [`scopeClients` / `scopeCampaigns` / `scopeLeads`](../src/app/lib/selectors.ts) | **Жодних записів у БД**. Тільки `auth.updateUser()` для імʼя/пароля. |
| `manager` | `app_metadata.role = 'manager'` | RLS: `clients.manager_id = auth.uid()`. UI scope-функції повторюють. | Усі поля своїх клієнтів через `private.can_manage_client(client_id)`. |
| `admin` / `super_admin` | `app_metadata.role IN ('admin','super_admin')` | Глобально все. | Усі mutation-и + invite edge-functions + email_exclude_list. `super_admin` додатково має імперсонацію. |

### 1.2 Канонічна матриця mutation-ів

З [09-mutations-rls.md §4](reference/functional/09-mutations-rls.md#4-mutation-ownership-matrix), додаткова перевірка через [`repository.ts:284-302`](../src/app/data/repository.ts#L284-L302):

| Сутність | Client | Manager (свої) | Admin (всі) | Що саме редагується |
|----------|:------:|:--------------:|:-----------:|---------------------|
| **clients** | ✖ | ✓ | ✓ | `name`, `status`, `manager_id`, `min_daily_sent`, `inboxes_count`, `notification_emails`, `sms_phone_numbers`, `auto_ooo_enabled`, `setup_info`, `kpi_leads`, `kpi_meetings` |
| **campaigns** | ✖ | ✓ | ✓ | `name`, `status`, `database_size`, `positive_responses` |
| **leads** | ✖ | ✓ | ✓ | **whitelist [ADR-0004](adr/0004-lead-state-boundaries.md):** `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`, `won`, `comments` |
| **domains** | ✖ | ✓ | ✓ | `status`, `reputation`, `exchange_cost`, `campaign_verified_at`, `warmup_verified_at` |
| **invoices** | ✖ | ✓ | ✓ | `issue_date`, `amount`, `status` |
| **email_exclude_list** | ✖ | ✖ | ✓ | upsert(domain), delete(domain) |
| **client_users** | ✖ | ✖ | ✓ (тільки програмно — UI не виставляє) | upsert/delete mapping |
| **invites** (edge fn) | ✖ | ✖ | ✓ | sendInvite / resendInvite / revokeInvice |
| **users.profile_name / password** | own | own | own | через Supabase Auth |
| **replies / campaign_daily_stats / daily_stats** | ✖ | ✖ | ✖ | **ingestion-only — n8n** ([11-integrations §2](reference/functional/11-integrations.md#2-ingestion-only-tables)) |

### 1.3 Шлях кожного запису

`Page → useCoreData().updateX() → CoreDataProvider (optimistic snapshot patch) → repository.updateX() → supabase.from(table).update(...).eq('id', ...).select().single()`. На помилці → `toast.error()` + rollback. Деталі — [09-mutations-rls §5](reference/functional/09-mutations-rls.md#5-optimistic-updates--rollback).

---

## 2. CLIENT — `sipofij887@pmdeal.com` (UniTalk)

> Базовий принцип: client — **виключно споживач даних**. Нуль mutation-ів у БД. Єдині дозволені дії — Auth (профіль/пароль/sign-out) і CSV-експорт лідів.

### 2.1 Меню (`NAV_BY_ROLE.client`)

5 пунктів: Dashboard, My Pipeline, Campaigns, Analytics, Settings. Жодних адмінських/менеджерських розділів. Внизу sidebar — додатковий блок **«Contract KPIs · MQL target / Meetings»** (read-only, тягнеться з `clients.kpi_leads / kpi_meetings`).

### 2.2 Що бачить і чим оперує

| Сторінка | Що бачить | Що може робити | Що **не може** |
|----------|-----------|----------------|---------------|
| **Dashboard** ([client-01-dashboard-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/client-01-dashboard-desktop.png)) | 5 KPI (MQLs, Meetings, Won, Sent, Prospects) + 8 чартів (daily sent, leads/week, leads/month, prospects, sent 3m, prospects/month, velocity, conversion funnel + reply rates). Дані відфільтровані за `clientId`. | Перемикати `DateRangeButton` (Last 7/14/30/90/YTD/All/Custom). | Drill-down (KPI/чарти не клікабельні). Експорт. |
| **My Pipeline** ([client-02-pipeline-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/client-02-pipeline-desktop.png)) | Список лідів свого клієнта зі стейджем; пошук, filter chips по етапах, фільтр по кампанії, фільтр «Lead OOO scope». Drawer лідa з повною історією reply (read-only). | **Пошук** (4 поля: name, email, company, title). **Фільтр**. **Sort** по колонках. **CSV-експорт** поточного фільтрованого набору. **Pagination** (Load more, PAGE_SIZE=50). | Будь-які mutation-и (qualification, meeting_booked, won, коментарі — все disabled у drawer-і). Класифікація reply. |
| **Campaigns** ([client-03-campaigns-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/client-03-campaigns-desktop.png)) | Тільки кампанії з `type='outreach'` ([ADR-0003](adr/0003-client-campaign-visibility.md)). Кожна — `Database / Sent / Positive / reply rate`. Drawer з технічними полями (External id, Daily stat rows). | Перегляд + drill-down у read-only drawer. | Створити/зупинити/перейменувати кампанію. Жодних запитів через portal — це робить менеджер у Smartlead/Bison + n8n. |
| **Analytics** ([client-04-analytics-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/client-04-analytics-desktop.png)) | 4 «live» KPI + Pipeline activity + Daily sent + Campaign reply rates + Conversion Funnel. | Date range. | Drill-down у конкретний день/кампанію. |
| **Settings** ([client-settings-full.png](screenshots/functional-analysis-2026-04-26/thumbs/client-settings-full.png)) | Profile name (input), Change password (2 inputs), Session control (Sign out). | `Update name`, `Update password`, `Sign out`. | **Немає `Send password reset link`** (як в admin/manager). Немає 2FA. Немає управління сесіями (active devices). |

### 2.3 Чого зараз бракує — Client (Open backlog)

| # | Пріоритет | Що бракує | Чому це важливо | Як вирішити (з reuse) |
|---|-----------|-----------|-----------------|------------------------|
| **CL-1** | 🔴 | **Edit «My company info»** (notification emails, OOO email, company POC). Зараз — повністю недоступно з portal-у. | Користувач не може швидко змінити свої контакти для MQL-нотифікацій без писання в support. | Додати read-only secção `Company contacts` в Settings (підтягувати `clients.notification_emails / sms_phone_numbers`) і опційно `request-change` форму, що пише в audit-log без прямого update (бо по [ADR-0004](adr/0004-lead-state-boundaries.md) клієнти не пишуть). |
| **CL-2** | 🟡 | **Класифікувати reply як «не за адресою / OOO / справжній лід»** (зараз класифікація 100% автоматична від n8n). | Бувають false-positive — клієнт хоче їх перекласифікувати. | Per [BUSINESS_LOGIC.md §10 Out-of-scope «Reply triage UI»](BUSINESS_LOGIC.md#10-out-of-scope-legacy) — explicitly out of scope. Жодного бюджету. **Лишити в out-of-scope**, але дати можливість «прапорця» reply → CSM-нотифікація. |
| **CL-3** | 🟡 | **Завантажити CSV з власним «target list»** для нової кампанії. | Сьогодні — клієнт надсилає Excel CSM-у в Slack/email; CSM вручну заводить в n8n. | Per [BUSINESS_LOGIC.md §10 Out-of-scope «CSV bulk import UI»](BUSINESS_LOGIC.md#10-out-of-scope-legacy) — explicitly out of scope (n8n ingest робить це). Лишити. |
| **CL-4** | 🟡 | **Перегляд reply-thread без «технічних» полів кампанії**. У drawer-і поточно показуються `External id`, `Daily stat rows`, `Gender target` — клієнту нічого не кажуть. | Шум. | У [`getCampaignPerformance`](../src/app/lib/client-view-models.ts) під `role==='client'` повертати урізаний об`єкт. |
| **CL-5** | 🟡 | **Send password reset link** (для self-recovery). | На login-екрані теж немає — див. [visual-analysis L1](visual-analysis-2026-04-26.md#22-знахідки). | Reuse того самого блоку, що у admin Settings ([admin-10-settings](screenshots/visual-analysis-2026-04-26/thumbs/admin-10-settings-desktop.png)). |
| **CL-6** | 🟢 | **Прокрутити пайплайн до конкретного етапу** з KPI-tile (клік `MQLs Delivered = 99` → відфільтрований pipeline). | Drill-down — стандартна потреба. | KPI-tile clickable + `navigate('/client/leads?stage=MQL')`. |
| **CL-7** | 🟢 | **Bookmark / save filter combination** на pipeline. | Менеджер часто перевіряє ту саму вибірку. | localStorage + dropdown «Saved views». |

---

## 3. MANAGER (CS Manager) — `nocaxeb217@pmdeal.com`

> Базовий принцип: менеджер **«володіє»** своїми клієнтами. Може редагувати все, що стосується операцій, але не може створювати/видаляти клієнтів, користувачів, чи блек-листи. Глобальні налаштування — за admin-ом.

### 3.1 Меню (`NAV_BY_ROLE.manager`)

9 пунктів: Dashboard, Clients, Leads, Campaigns, Analytics, Domains, Invoices, Blacklist, Settings. Workspace-лейбл = «CS Manager».

### 3.2 Що бачить і чим оперує

| Сторінка | Що бачить | Що може робити | Что **не може** |
|----------|-----------|----------------|----------------|
| **Dashboard** ([manager-01-dashboard-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-01-dashboard-desktop.png)) | 4 KPI (Assigned clients, Active campaigns, Leads in progress, Unclassified replies) + Campaign watchlist + Client portfolio + Lead queue (10 latest). | Клік по клієнту → перехід у Clients page з відкритим drawer-ом. | Drill-down у конкретну кампанію. KPI-фільтри. |
| **Clients** ([manager-02-clients-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-02-clients-desktop.png)) | Таблиця з 5-ма табами: Overview, DoD, 3-DoD, WoW, MoM. Тільки `clients WHERE manager_id = self`. | **Клік рядка → drawer редагування** ([manager-clients-drawer.png](screenshots/functional-analysis-2026-04-26/thumbs/manager-clients-drawer.png)): Assigned manager, Contract amount, Contract due date, Auto OOO, Performance metrics tables (DoD/3DoD/WoW/MoM). **Save changes / Cancel changes**. Sort за колонками. Resize columns. | Видалити клієнта. Створити нового (тільки через invite). |
| **Leads** ([manager-03-leads-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-03-leads-desktop.png)) | Лід-таблиця по всіх своїх клієнтах. Filter chips (Pre-MQL/MQL/Meeting Scheduled/Held/Offer Sent/Reported), filter по кампанії, по клієнту. Date range. | **Drawer редагування** ([manager-leads-drawer.png](screenshots/functional-analysis-2026-04-26/thumbs/manager-leads-drawer.png)): `Qualification` (select MQL / preMQL / OOO / rejected), `Comments` (textarea), `Meeting booked / Held / Offer sent / Won` (Yes/No toggles). Reply history — read-only. **Save / Cancel**. CSV-експорт. | Створити лід вручну. Видалити. Класифікувати reply. Редагувати raw поля (email, name, company). |
| **Campaigns** ([manager-04-campaigns-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-04-campaigns-desktop.png) · [manager-campaigns-drawer.png](screenshots/functional-analysis-2026-04-26/thumbs/manager-campaigns-drawer.png)) | Список кампаній з колонками: Campaign name, Type, Status, Positive. Filter: timeframe, status, client scope. | Drawer редагування: `name`, `status`, `database_size`, `positive_responses`. **Save / Cancel**. | Створити нову кампанію (це робиться в Smartlead/Bison → n8n синхронізує). Видалити. Запустити/зупинити (status можна змінити, але це **не** тригерить дію в Smartlead — тільки маркер у БД). |
| **Analytics** ([manager-05-analytics-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-05-analytics-desktop.png)) | Aggregate KPI + Daily sent + Replies trend + Campaign performance + Conversion funnel — по ВСІХ своїх клієнтах одразу. | Date range. | Drill-down у конкретного клієнта (дані вже scoped, але крізь-tabs нема). |
| **Domains** ([manager-06-domains-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-06-domains-desktop.png)) | Empty-state «No domains in current scope» (бо у цього менеджера ще нема). | По коду: drawer редагування `status / reputation / exchange_cost / verified_at`. Save/Cancel. | Додати домен (це n8n із Smartlead-warmup). Видалити. |
| **Invoices** ([manager-07-invoices-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-07-invoices-desktop.png)) | 3 KPI (Invoices, Paid, Overdue · Scope total) + список (зараз empty). | По коду: drawer редагування `issue_date / amount / status`. | Створити інвойс (теж з n8n / external). |
| **Blacklist** ([manager-blacklist-top.png](screenshots/functional-analysis-2026-04-26/thumbs/manager-blacklist-top.png)) | **Зелений банер «You have read-only access. Only admin roles can add or remove blacklist entries.»** + список 161 заблокованого домену + поле пошуку. **НІЯКИХ кнопок Add / Remove**. | Тільки **search** + перегляд. | Add domain. Remove domain. |
| **Settings** ([manager-09-settings-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-09-settings-desktop.png)) | Current identity (Actor, Effective email/role, Impersonation status) + Security controls (Profile name, Change password, **Send reset link**, Sign out). | Update name. Update password. Send reset link. Sign out. | Активні сесії на інших девайсах. 2FA. |

### 3.3 Цікаві спостереження по UX

1. **Manager Blacklist має ідеальну read-only комунікацію** ([manager-blacklist-top.png](screenshots/functional-analysis-2026-04-26/thumbs/manager-blacklist-top.png)): зелений банер з ясним поясненням «чому». Це **зразок** для решти сторінок (наприклад, на Domains/Invoices з пустим scope варто було б показати такий самий банер, якщо менеджер не може ініціювати sync).
2. **Drawer-pattern узгоджений** між Clients, Leads, Campaigns: однакова структура «Cancel changes / Save changes» зверху, секції згруповані смисловими блоками. Reuse-працює.
3. **«(SORT)» / «(ASC)» суфікси** в headers таблиць (раніше я в visual-analysis помилково кваліфікував їх як «(Code)» дебаг-маркер — **це насправді індикатор сортування**). Коректний фікс — замінити на іконку `↑↓ / ↑ / ↓` як у [`<Button>` shadcn pattern](../src/app/components/ui/button.tsx).

### 3.4 Чого зараз бракує — Manager (Open backlog)

| # | Пріоритет | Що бракує | Чому це важливо | Як вирішити |
|---|-----------|-----------|-----------------|--------------|
| **MG-1** | 🔴 | **Bulk-actions на Leads** (масово виставити «MQL = false» для серії false-positive). | Зараз треба клікати по 50 лідах. Менеджер на 5+ клієнтах робить це щодня. | Додати чекбокси в табл. Reuse [`Checkbox`](../src/app/components/ui/checkbox.tsx). Bulk endpoint = N послідовних `updateLead` через `Promise.all`. |
| **MG-2** | 🔴 | **Класифікація reply** менеджером (зараз тільки n8n). | Хоча в [BUSINESS_LOGIC.md §10 «Reply triage UI» — out-of-scope](BUSINESS_LOGIC.md#10-out-of-scope-legacy), менеджер **бачить** unclassified replies на dashboard, але **не може нічого з ними зробити з порталу**. UX-розбіжність: «Я бачу проблему, але мене відсилають назад до n8n». | Або (а) **прибрати «Unclassified replies» KPI** — якщо ми кажемо що це out-of-scope, не показуй; або (б) дати «mark as positive / negative» прапорець, що йде в n8n webhook. |
| **MG-2.5** | 🟡 | **Re-asign client to another manager** з drawer-у (поле `manager_id` теоретично editable, але в drawer-і не показано). | Менеджер не може передати клієнта колезі. | Додати `Manager` select в Clients drawer (дозволено лише якщо менеджер == admin або це OOO-режим). |
| **MG-3** | 🟡 | **Notify-test** — натиснути «Send test MQL notification» щоб перевірити, чи doesn`t-reach-spam контактів. | Менеджер тільки змінює `notification_emails`, не знаючи, чи дійшло. | Edge function `notify-test` (новий), що пише в той самий n8n queue з `dryRun=true`. |
| **MG-4** | 🟡 | **«Pause campaign»** — швидка дія з рядка таблиці, без drawer-а. | Зараз: клік → drawer → status select → Save. Три кліки замість одного. | Inline action menu (`...`) у row, як у shadcn `<DropdownMenu>`. |
| **MG-5** | 🟡 | **Per-client drill-down в Analytics** (поточно — лише агрегат). | Менеджер хоче розклад «клієнт X — як йому справи цього тижня». | Додати `<Select>` «Client» вгорі Analytics-сторінки. |
| **MG-6** | 🟢 | **Saved views / preset filters** на Leads та Clients. | Часто-використовувані вибірки. | Reuse [`Tabs`](../src/app/components/ui/tabs.tsx) + localStorage. |
| **MG-7** | 🟢 | **Кольорові статуси** (Active = green, On hold = amber, Sales = blue, Offboarding = red) на Clients-таблиці. | Зараз усі однакового кольору. | Conditional className у Status-cell. |
| **MG-8** | 🟢 | **Export to CSV** на Manager Leads (зараз тільки на Client Leads). | Менеджер хоче забрати в Google Sheets для звіту. | Reuse `toCsvCell` з [`client-leads-page.tsx`](../src/app/pages/client-leads-page.tsx). |

---

## 4. ADMIN (and SUPER_ADMIN) — `medaval606@tatefarm.com`

> Базовий принцип: admin = manager + глобальний scope + invite-управління + email_exclude_list. `super_admin` = admin + імперсонація.

### 4.1 Меню (`NAV_BY_ROLE.admin`)

10 пунктів: Dashboard, **User management** (admin-only), Clients, Leads, Campaigns, Analytics, Domains, Invoices, Blacklist, Settings. Workspace-лейбл = «admin».

### 4.2 Що бачить і чим оперує

| Сторінка | Що бачить | Що може робити | Що **не може** |
|----------|-----------|----------------|---------------|
| **Dashboard** ([admin-01-dashboard-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-01-dashboard-desktop.png)) | 4 KPI (Clients · "X without manager", Active campaigns, Lead pipeline, Unclassified replies) + Campaign momentum (21d area chart) + Non-active clients + Manager capacity (по кожному менеджеру). | Клік по non-active clients → drill-down у Clients drawer. | Прямі actions з KPI-tile (наприклад, «assign all unassigned»). |
| **User management** ([admin-02-users-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-02-users-desktop.png) · [admin-users-form-client-role.png](screenshots/functional-analysis-2026-04-26/thumbs/admin-users-form-client-role.png) · [admin-users-form-manager-role.png](screenshots/functional-analysis-2026-04-26/thumbs/admin-users-form-manager-role.png)) | Форма Create invitation + 4 KPI (Total/Pending/Accepted/Expired) + lifecycle list з табами (All/Pending/Accepted/Expired). | **Send invite** (`email + role + (client if role=client)`). Дуже акуратно: коли role=`client`, з`являється `Select client` поле; коли role=`manager` — поле зникає. **Resend / Revoke** на pending invites. | Видалити вже-accepted user-а з UI (треба SQL у Supabase Studio). Змінити роль існуючого user-а (тільки SQL). Reset пароль для іншого user-а (тільки sendInvite заново). |
| **Clients** ([admin-03-clients-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-03-clients-desktop.png) · [admin-clients-drawer.png](screenshots/functional-analysis-2026-04-26/thumbs/admin-clients-drawer.png)) | Усі клієнти всіх менеджерів. Та сама таблиця, що в manager. | Editable drawer, ті самі поля + потенційно reassign manager_id. | Видалити клієнта. Створити нового (тільки invite client → triggers `client_users` upsert). |
| **Leads / Campaigns / Analytics / Domains / Invoices** | Те саме, що в manager — але глобально. | Те саме edit-меню. | Створити лід/інвойс/домен з нуля (це n8n). |
| **Blacklist** ([admin-blacklist-top.png](screenshots/functional-analysis-2026-04-26/thumbs/admin-blacklist-top.png)) | Список 161 домену + **search field** + **`example.com` add input** + **`Add domain` button** + **`Remove domain`** на кожному рядку. | **Add domain** (`upsertEmailExcludeDomain`) **Remove domain** (`deleteEmailExcludeDomain`). Search. | Bulk import. Bulk delete. Edit (тільки add+remove). |
| **Settings** ([admin-10-settings-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-10-settings-desktop.png)) | Current identity + Security controls (Profile, Change password, Send reset link, Sign out). | Те саме, що manager. | Те саме. |

### 4.3 Super_admin — імперсонація

Тільки `super_admin` бачить додаткову іконку «Impersonate» біля кожного user-а у User management ([app-shell.tsx](../src/app/components/app-shell.tsx)). Імперсонація:

- Зберігає original `actorIdentity`, замінює `identity` на target.
- В UI сидить золото-amber `<Banner>` «You are impersonating X. Stop impersonating» (не в screenshot-ах — admin-користувач не super_admin).
- Усі mutation-и виконуються від target user-а (тобто RLS враховує їхню роль). Це робить імперсонацію безпечною — ти не «магічно admin», ти буквально стаєш ним.

### 4.4 Чого зараз бракує — Admin (Open backlog)

| # | Пріоритет | Що бракує | Чому це важливо | Як вирішити |
|---|-----------|-----------|-----------------|--------------|
| **AD-1** | 🔴 | **Видалення / деактивація user-а з UI** (зараз тільки SQL у Supabase Studio). | Менеджер пішов з компанії — admin має бігти в Studio. Risk: неактивний user з access. | Edge function `deactivate-user` (set `app_metadata.disabled=true` + revoke session). Reuse pattern з `manage-invites`. |
| **AD-2** | 🔴 | **Зміна ролі існуючого user-а** (наприклад, manager → admin). | Зараз — SQL. | Edge function `update-user-role`. UI: dropdown в lifecycle-row (тільки для `accepted`). |
| **AD-3** | 🔴 | **Створення client-record** з UI (зараз — лише через invite-edge, що під капотом створює `client_users` рядок, але не сам `clients`). Якщо клієнт без юзера — admin не може його завести. | Sales-flow: спочатку контракт, потім access. | Форма «Create client» в Clients page з кнопкою + drawer-аналог create-варіанта. `repository.createClient(...)` (нова mutation). |
| **AD-4** | 🟡 | **Bulk-import blacklist** (CSV-upload). | 161 домен зараз — handled. 1000+ — біль. | `<input type="file">` + per-row upsert. |
| **AD-5** | 🟡 | **Audit log** — хто змінив що і коли. | Compliance. Команда росте. | Окрема `audit_log` таблиця + trigger на mutation-tables. |
| **AD-6** | 🟡 | **Manage `client_users` mapping з UI** (admin-only). Зараз — лише програмно, без UI ([repository.ts:476-490](../src/app/data/repository.ts#L476-L490)). | Якщо клієнт перейшов до іншого workspace — admin має шукати скрипт. | Drawer-секція в Clients: «Authorized users» list with add/remove. |
| **AD-7** | 🟡 | **Force snapshot refresh / sync trigger** для домен/інвойс/reply. | Зараз — тільки чекати n8n cron. | UI-button «Sync now» → виклик n8n webhook. Async, з toast. |
| **AD-8** | 🟢 | **Розшифровка `Manager capacity`** на admin dashboard з drill-down. | Зараз — таблиця, без переходу. | Клік на manager → `/admin/clients?manager=...`. |
| **AD-9** | 🟢 | **Кольорове виділення `clients without manager`** на Clients-таблиці. | Зараз — admin dashboard каже «3 without manager», але на Clients-таблиці це не видно. | `manager_id IS NULL` → orange row-tint. |
| **AD-10** | 🟢 | **«Backfill metrics for date X»** — manual trigger на пере-обробку daily_stats для конкретного дня (на випадок ingestion-проблеми). | Edge case, але повторюваний. | Edge function + admin-only button у Settings → «Maintenance». |

---

## 5. Cross-cutting: інтеракції, яких системно бракує

Ці прогалини зачіпають усі ролі або саму архітектуру UX:

| # | Pri | Прогалина | Сценарій | Рекомендація |
|---|-----|-----------|----------|--------------|
| **X-1** | 🔴 | **Realtime / push-update** — два менеджери одночасно редагують той самий лід. Останній перезаписує попереднього **silently**. ([09-mutations-rls §5](reference/functional/09-mutations-rls.md#5-optimistic-updates--rollback)) | Concurrent edit. | Optimistic concurrency (порівнювати `updated_at` перед save) + конфлікт-діалог. **НЕ** обовʼязково Supabase Realtime — version-check достатньо. |
| **X-2** | 🔴 | **Немає audit-trail** хто-що-змінив. | Compliance + debug. | Trigger-based `audit_log` таблиця. |
| **X-3** | 🟡 | **Жодних confirm-діалогів** на потенційно destructive дії: revoke invite, remove blacklist domain. Якщо misclick — irreversible. | UX safety. | Reuse [`Dialog`](../src/app/components/ui/dialog.tsx) для confirm. |
| **X-4** | 🟡 | **Drawer закривається при кліку на backdrop** ([clients-page.tsx:768](../src/app/pages/clients-page.tsx#L768)) — **навіть якщо є unsaved changes** (потрібно перевірити в коді — у leads page інакше? див. [09-mutations-rls §5](reference/functional/09-mutations-rls.md#5-optimistic-updates--rollback)). | Нерозсудливий клік губить редагування. | Якщо `isDraftDirty` — питати «Discard changes?». |
| **X-5** | 🟡 | **Немає keyboard shortcuts** (`g d` → dashboard, `/` → focus search, `?` → cheat-sheet). | Manager на 5+ клієнтів робить десятки кліків/день. | Reuse [`react-router`](../src/app/App.tsx) + global key handler. |
| **X-6** | 🟡 | **No undo** на mutation-и. `toast` пише «Saved», але якщо користувач помилився — треба знаходити, що він зробив. | UX. | `toast.action({ label: "Undo", onClick: ... })` (sonner це підтримує) + revert call. |
| **X-7** | 🟡 | **Drawer показує «Save changes» disabled, поки нічого не змінено** — добре. Але немає `Ctrl+S` shortcut для save. | Power users. | Global keydown у drawer. |
| **X-8** | 🟢 | **Toast не зникає при імперсонації-перемиканні** (якщо є). | Cosmetic. | Auto-dismiss on navigation. |

---

## 6. Узагальнена матриця CRUD-можливостей

> Швидко глянути «хто що може робити з чим». «R» = read, «U» = update, «C» = create, «D» = delete. Порожньо = заборонено.

| Сутність | Client | Manager (свої) | Admin (всі) |
|----------|:------:|:--------------:|:-----------:|
| `users` (профіль / пароль свій) | R/U own | R/U own | R/U own |
| `users` (інших) | — | R own team | R all (+ invite to add; **del/role-change тільки SQL**) |
| `clients` | R own | R/U | R/U (no Create) |
| `client_users` | — | — | R (программно U/D) |
| `campaigns` (outreach only для client) | R | R/U | R/U |
| `leads` | R | R/U (whitelist) | R/U (whitelist) |
| `replies` | R own | R | R |
| `campaign_daily_stats` / `daily_stats` | R own | R | R |
| `domains` | — | R/U | R/U |
| `invoices` | — | R/U | R/U |
| `email_exclude_list` (Blacklist) | — | R | R/C/D |
| `invites` | — | — | R/C + Resend/Revoke |
| `auth.users` (impersonation) | — | — | super_admin only |

### 6.1 Жодна роль НЕ може з UI:
- Видалити будь-яку основну сутність (clients/campaigns/leads/domains/invoices/users) — всі mutation-и обмежені до `update`.
- Створити новий `client`-запис (тільки через invite-edge, що `upsert`-ить `client_users`, але не сам клієнт).
- Створити campaign (n8n синхронізує з Smartlead/Bison).
- Класифікувати reply (n8n).
- Send одну email/SMS notification з порталу (n8n owns notifications).
- Bulk-update нічого.

> Це **навмисно** ([BUSINESS_LOGIC.md §10 Out-of-scope](BUSINESS_LOGIC.md#10-out-of-scope-legacy)). Більшість «створити» = ingestion (n8n). Більшість «видалити» = `status=offboarding/inactive` (soft).

---

## 7. Помилки минулого visual-analysis (виправлення)

Інтерактивний обхід виявив дві помилки в [visual-analysis-2026-04-26.md](visual-analysis-2026-04-26.md), які треба виправити:

| # | Помилкове твердження | Реальність |
|---|----------------------|------------|
| **MC1 / MCa1** (виправлено) | «`(Code)` суфікс у назвах колонок — debug-label що просочився» | Це **`(SORT)` / `(ASC)`** — індикатор стану сортування. Все ще погано (текст замість іконки), але **не зламана UI**. Фікс: замінити на `↑↓` icon. |
| **MB1-3** (виправлено для manager) | «Blacklist має Remove кнопки і немає search» | Для **admin** — так. Для **manager** — read-only банер пояснює і **немає Remove кнопок**. Дуже добре зроблено. |

---

## 8. Як було проведено

- **Інструмент:** локальний Playwright (`@playwright/test 1.56.0`), Chromium 1196.
- **Specs:**
  - [`e2e/functional-analysis.spec.ts`](../e2e/functional-analysis.spec.ts) — 10 інтерактивних тестів: open lead drawer (client/manager/admin), open clients drawer, open campaigns drawer, role=client/manager у admin invite form, blacklist top для manager+admin, client settings.
  - Виконувалися поверх baseline screenshot-ів з [visual-analysis](visual-analysis-2026-04-26.md).
- **Виходи:** 10 PNG-screenshot-ів інтерактивних станів у [`docs/screenshots/functional-analysis-2026-04-26/`](screenshots/functional-analysis-2026-04-26/).
- **Креденшіали** через env (`VA_*_EMAIL` / `VA_*_PASSWORD`); ніде не закомічено.
- **Перехресна перевірка** — кожна знахідка зіставлена з:
  - [`repository.ts`](../src/app/data/repository.ts) (що mutation **дійсно існує**),
  - [`09-mutations-rls.md`](reference/functional/09-mutations-rls.md) (хто має дозвіл),
  - [`BUSINESS_LOGIC.md §10-11`](BUSINESS_LOGIC.md#10-out-of-scope-legacy) (чи це навмисно out-of-scope чи відсутність).
- **Що НЕ перевірено:** `super_admin`-імперсонація (нема такого аккаунта), DKIM/sPF flows (це Smartlead-side), edge-function performance.

---

## 9. Що далі

1. **Конвертувати «бракує»-листи у backlog.** Більшість пунктів CL-1..7 / MG-1..8 / AD-1..10 / X-1..8 — це **готові backlog-айтеми**. Перенести у `BUSINESS_LOGIC.md §11 Open backlog` з пріоритетами.
2. **Sprint-1 кандидати (висока вартість, низькі зусилля):** MG-1 (bulk leads), MG-7 (status colors), MG-8 (csv export для manager), AD-2 (change role з UI), X-3 (confirm dialogs).
3. **Перезапускати spec при кожному релізі** — він швидкий (~2.5 хв) і ловить регресії доступу (наприклад, якщо випадково розширити RLS і клієнт побачить чужого ліда).
4. **Інтегрувати з RLS-тестами:** spec залогінений як кожна роль робить кілька read-операцій → запис у БД. Зараз — лише UI-верифікація. Можна розширити перевіркою: «client читає лід чужого клієнта → 403».

---

> **Висновок одним реченням.** Архітектура доступу зріла і чітка: client = реадер, manager = операційний редактор з обмеженим whitelist, admin = глобальний редактор + invite-керування. Дві системні дірки потребують уваги: (а) admin не може видаляти/змінювати ролі юзерів з UI, тільки SQL; (б) є read-state без write-state дисонанси (manager бачить «unclassified replies», але нічого зробити не може). Решта — backlog очікуваного росту.
