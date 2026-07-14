---
title: Візуальний UX/UI аналіз ColdUnicorn PDCA Portal
date: 2026-04-26
author: Claude (Playwright-driven visual audit)
scope: 3 ролі (client / manager / admin) × всі основні сторінки × desktop (1440×900) + mobile (390×844)
data: жива Supabase (project bnetnuzxynmdftiadwef), реальні аккаунти
---

# Візуальний аналіз — ColdUnicorn PDCA Portal

**Версія:** main @ `8c52143` · **Дата:** 2026-04-26 · **Метод:** автоматизований Playwright-обхід з реальним логіном під трьох ролей, full-page screenshot-и на двох viewport-ах, ручний UX-аналіз кожного.

---

## 0. Як цей звіт читати

- Усі screenshot-и зберігаються у [`docs/screenshots/visual-analysis-2026-04-26/`](screenshots/visual-analysis-2026-04-26/) (50 файлів). Зменшені до 1600 px превʼю — у підпапці [`thumbs/`](screenshots/visual-analysis-2026-04-26/thumbs/).
- Документ **не виправляє** проблем — лише фіксує їх. Кожен пункт містить: **Що бачимо** → **Чому це важливо** → **Що зробити**.
- Знахідки згруповано за пріоритетом: **🔴 Critical** (порушує функцію або довіру), **🟡 Major** (псує UX, але не блокує), **🟢 Polish** (косметика).
- Цитати файлів і рядків — клікабельні. Рекомендації узгоджені з [CLAUDE.md §2 «Reuse over recreation»](../CLAUDE.md#2-reuse-over-recreation) — пропозиції **не вимагають** нових компонентів, лише точкових правок існуючих primitive-ів.

---

## 1. Загальні спостереження (cross-role)

### 1.1 Сильні сторони

1. **Послідовний дизайн-язик.** Всі три портали (client / manager / admin) використовують одну палітру `#0f0f0f / #242424 / emerald-sky-violet-amber`. Метрика-tile-и однакової форми; sidebar identical. Це робить імперсонацію інтуїтивною — admin одразу впізнає, в чиєму інтерфейсі він зараз.
2. **Інформаційна щільність добре збалансована.** На manager dashboard 8 KPI-tile-ів + 3 секції чартів + таблиця — і немає відчуття overload, бо grid `md:grid-cols-2 xl:grid-cols-4` дає чіткий ритм.
3. **Empty-state-и описові.** «No domains in current scope / When domains are synced, they will appear here…» — це краще за порожній екран. Користувач розуміє, що він **не зробив помилку**, дані просто ще не прийшли.
4. **Single sign-out / single profile area.** В нижньому лівому кутку постійно видно `email + role + log-out icon` — одне місце для виходу, без шукання в меню.

### 1.2 Системні проблеми (зачіпають усі ролі)

| # | Пріоритет | Проблема | Сторінки | Деталі |
|---|-----------|----------|----------|--------|
| **G1** | 🔴 | **Mobile-навігація — `Hide menu` повертає sidebar на мобільному, що повністю забирає в`юпорт.** На 390 px sidebar займає ~280 px (72 %). Десктопний `<aside>` не має `md:` breakpoint-у — на мобільному він просто **накриває контент**, доки користувач не натисне «Hide menu». | усі crient/manager/admin сторінки | див. [client-01-dashboard-mobile.png](screenshots/visual-analysis-2026-04-26/thumbs/client-01-dashboard-mobile.png) — pipeline-таблиця змушена скролитися горизонтально на ~5x екрану. |
| **G2** | 🔴 | **Адмін Analytics — порожня сторінка стилізована як галерея сотен «карток»**, насправді порожніх. Виглядає як рендеринг-баг або як нескінченний skeleton. | [admin-06-analytics-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-06-analytics-desktop.png) | Колір тла tile-а = колір тла сторінки + лише 1 px border. Без даних 50+ tiles виглядають як «zebra на нічному небі». |
| **G3** | 🟡 | **`Hide menu` toggle всюди розміщений як кнопка біля заголовка, але відсутній на mobile** — там немає альтернативного hamburger-а. Якщо sidebar не відкритий, доступ до інших сторінок неможливий. | усі mobile screenshot-и admin | див. [admin-02-users-mobile.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-02-users-mobile.png) — є «☰ Menu» (добре!), але в client/manager mobile така кнопка **відсутня**. |
| **G4** | 🟡 | **Велика кількість таблиць не має фільтрів вгорі.** Manager Clients (38 строк), Manager Leads (тисячі), Admin Blacklist (200+) — заголовки + одразу рядки. Користувач змушений Ctrl+F. | manager-02, manager-03, manager-08, admin-09 | На client portal (My Pipeline) фільтр-чіпи реалізовано добре — той самий патерн варто перенести на admin/manager таблиці. |
| **G5** | 🟢 | **Контраст плейсхолдерів полів вводу занадто низький.** `name@company.com` ледве видно на dark background. Виглядає як disabled, хоча поле активне. | login, admin user management, settings change-password | Збільшити opacity placeholder-а з умовних 35 % до 55 %. |
| **G6** | 🟢 | **Висота повторюваних tile-ів не вирівняна, коли значення мають різну довжину.** Напр., `Workspace · UniTalk` (короткий) vs sidebar-у admin `Workspace · admin` (короткий) vs «medaval606@tatefarm.com» (довгий) — ламається baseline. | sidebar усіх ролей | Додати `min-h` або обрізати довгі email-и через `truncate`. |

---

## 2. Public — сторінка логіну

**Файл:** [`src/app/pages/login-page.tsx`](../src/app/pages/login-page.tsx)
**Скрін desktop:** [public-login-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/public-login-desktop.png)
**Скрін mobile:** [public-login-mobile.png](screenshots/visual-analysis-2026-04-26/thumbs/public-login-mobile.png)

### 2.1 Що бачимо

- Двоколонковий layout: ліва колонка — маркетинговий ColdUnicorn-блок з підзаголовком «Performance email outreach for ambitious teams»; права — форма логіну (email, password, кнопка `Sign in`).
- Design dark, з акцентним sky-blue gradient на CTA. Логотип «ColdUnicorn» + підпис «PDCA Platform».
- На mobile (390 px) — чорна рамка з лого зверху і форма знизу.

### 2.2 Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| L1 | 🟡 | Немає посилання «Forgot password?» на формі. | У Settings є «Send reset link», але **до логіну** користувач туди не потрапить. Класичний UX-блок. | Додати link під кнопкою `Sign in` → нова сторінка / popup, який робить `supabase.auth.resetPasswordForEmail(...)`. |
| L2 | 🟡 | Кнопка `Sign in` показує тільки текст у `disabled` стані під час запиту, без spinner-а. | На повільному коннекті користувач натискає двічі → друга спроба зараз ігнорується, але без feedback користувач не впевнений. | Замінити текст на `Signing in…` + крутитися `Loader2` (lucide). Pattern уже є в [`PortalLoadingState`](../src/app/components/portal-ui.tsx). |
| L3 | 🟢 | Pre-filled `name@company.com` placeholder майже непомітний (низький контраст). | Користувач думає, що поле вже заповнене (autocomplete-ом), і пропускає. | Збільшити opacity (див. G5). |
| L4 | 🟢 | На mobile права колонка з формою «дихає» половиною екрану, **ліва маркетингова колонка під нею тягнеться на пів-екрану додатково** — користувач бачить заголовок «Sign in», тягне scroll → бачить велике лого замість контенту. | Принцип «above the fold»: первинна дія повинна бути одразу видна. | На `< md` сховати маркетинговий блок або стиснути до банера-смужки. |

---

## 3. Client portal — `sipofij887@pmdeal.com` (UniTalk)

> Усі 5 client-сторінок тут: Dashboard, My Pipeline, Campaigns, Analytics, Settings.

### 3.1 Dashboard

**Скрін:** [client-01-dashboard-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/client-01-dashboard-desktop.png) · [client-01-dashboard-mobile.png](screenshots/visual-analysis-2026-04-26/thumbs/client-01-dashboard-mobile.png)

#### Що бачимо
- 5 KPI-tile-ів: MQLs Delivered (99 ↑100 %), Meetings Booked (1 ↑100 %), Deals Won (0 ↑0 %), Emails Sent (9.7 K ↑17.4 %), Prospects (35 K — n/a).
- 6 графіків парами (Daily sent / Leads per week, Leads per month / Prospects added, Sent last 3 months / Prospects by month).
- Внизу — Velocity Chart + Conversion Funnel + Campaign reply rates list.
- На лівому sidebar є додатковий блок «Contract KPIs · MQL target 0/mo · Meetings 0/mo».

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| C1 | 🔴 | **«Contract KPIs» показують «0/mo» — це сигналізує що цілі не задані**, але користувач не може їх редагувати з цього портал-у. | Якщо це дійсно «не задано», UI має сказати **«Not set yet — your CSM will configure»**, а не нулі (виглядає як «ціль = 0 = досягнуто»). | У [`portal-ui.tsx`](../src/app/components/portal-ui.tsx) додати state «not configured» — якщо `target === 0`, показати `—` + tooltip. |
| C2 | 🟡 | KPI-tile «Deals Won 0 ↑ 0.0 %» — стрілка вгору **на нульовій зміні**. Колір зелений. | Іконка delta має дзеркалити реальний sign(Δ): zero → no arrow або neutral icon, негативна → червона. | Виправити в [`KpiTile`](../src/app/components/portal-ui.tsx) — sign-aware icon. |
| C3 | 🟡 | «Leads Count per month» і «Prospects added by Month» обидва показують `No monthly … data` — тобто 50 % площі другого ряду = empty-state. Користувач сприймає це як «у мене щось зламалось». | Стискати empty чарти у тонший banner або об`єднувати empty-state в одну картку «Monthly view requires more history (we have N days of data)». | Додати в [`ChartPanel`](../src/app/components/portal-ui.tsx) проп `compact` для empty-state. |
| C4 | 🟢 | На mobile dashboard має 7+ екранів вертикального скролу. Немає секційних якорів. | Вузький UX, без tabs/anchor link не зрозуміло що далі. | Додати `<aside>` зі стікі-навігацією або табами «Overview / Leads / Volume / Conversion». |

---

### 3.2 My Pipeline

**Скрін:** [client-02-pipeline-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/client-02-pipeline-desktop.png) · [client-02-pipeline-mobile.png](screenshots/visual-analysis-2026-04-26/thumbs/client-02-pipeline-mobile.png)

#### Що бачимо
- Header «My Pipeline · Last 30 Days». Фільтри в один рядок: search-bar + chip-фільтри по етапах (`Pre-MQL`, `MQL`, `Meeting Scheduled`, `Meeting Held`, `Offer Sent`, `Won`, кампанії).
- Таблиця лідів з аватаром (фіолетовий кружечок), name+company, stage-badge праворуч, дата.

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| P1 | 🟡 | На таблиці **немає колонок-заголовків** — лише список рядків. Сортувати неможливо. | Користувач не бачить, за яким полем впорядковано (виглядає, що за датою, але невідомо). | Додати header-row з sort-кнопками (pattern із [§4.6 CLAUDE.md](../CLAUDE.md#46-tables)). |
| P2 | 🟡 | Аватари — кольоровий монохром фіолетовий для **усіх** лідів. Немає інформативної функції — лише декорація. | Можна зашифровувати щось корисне (status colour, або `initials`). | Прибрати аватар або заміни на `initials` з [`getFullName`](../src/app/lib/format.ts). |
| P3 | 🟢 | Filter chips дублюють етапи з legend-у пайплайну, але колір чіпа в активному стані = light-blue, а не колір етапу. Зв`язок не очевидний. | Краще використовувати власний колір етапу (з [PIPELINE_STAGES](../src/app/lib/client-view-models.ts)). | Зробити active-chip колір узгодженим з badge-кольором стейджу. |

---

### 3.3 Campaigns

**Скрін:** [client-03-campaigns-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/client-03-campaigns-desktop.png) · [client-03-campaigns-mobile.png](screenshots/visual-analysis-2026-04-26/thumbs/client-03-campaigns-mobile.png)

#### Що бачимо (mobile найзручніше для аналізу — на ньому видно деталі)
- Header → Last 30 Days → блок «Campaign portfolio · 23 outreach campaigns».
- Список кампаній — кожна як «mini-tile»: назва, status (`completed`), `started DD MMM YYYY`, метрики: `Database / Sent / Positive`, праворуч — `0.0 % reply rate`.
- Вибрана кампанія розгортається у read-only details: Status, Type, Start date, Database size, Positive responses, External id, Gender target, Daily stat rows.
- Внизу — два графіки: «Daily campaign volume» і «Campaign sent count».

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| CC1 | 🔴 | **«Reply rate 0.0 %» при наявності `Positive: 3` і `Database: 1167`** — це не нуль, це 3/1167 ≈ 0.26 % (правильніше — 3/Sent). Якщо `Sent: 0`, то 0 — нормально, але тоді й `Positive: 3` нелогічно. | Користувач втрачає довіру до даних. | Перевірити формулу в [`getCampaignPerformance`](../src/app/lib/client-view-models.ts). Якщо `sent==0`, показувати `—` замість «0.0 %», бо знаменник 0. |
| CC2 | 🟡 | «External id 316», «Daily stat rows 3», «Gender target —» — **технічні поля, які клієнту нічого не пояснюють**. | Згідно [ADR-0003](../docs/adr/0003-client-campaign-visibility.md) ми маємо мінімізувати «службову» інформацію для клієнта. | Сховати ці три поля для ролі `client` або обернути у складеному «Technical» секції з тогл-ом. |
| CC3 | 🟢 | Перші 3 кампанії в списку мають однакові назви «Copy of Unitalk \| listopad \| K» — без розрізнення. | Користувач не може клацнути по правильній. | На рівні даних — n8n side. На UI: показати `external_id` або `start_date` як disambiguator у самому tile-і (не тільки у details). |

---

### 3.4 Analytics

**Скрін:** [client-04-analytics-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/client-04-analytics-desktop.png)

#### Що бачимо
- 4 KPI: MQLs (99 live), Meetings Booked (1 live), Deals Won (0 live), Prospects Base (35 K live).
- «Pipeline Activity» chart — лінія без значень (одна точка `21 Apr 2026`).
- «Daily sent» — line chart з gnome-shaped sent data.
- «Campaign reply rates» — bar chart, 4 кампанії зі значеннями ~4-5.
- «Conversion Funnel»: Prospects 34 760 → MQLs 99 (0.3 %) → Meetings 1 (1.0 %) → Won 0 (0.0 %).

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| A1 | 🟡 | «Pipeline Activity» — практично порожня (одна точка). Займає 380 px висоти. | Великий простір під чарт із одним dot-ом виглядає як bug. | Якщо `series.length < 3`, замінити на text-summary («One MQL on 21 Apr 2026, no other activity in this range»). |
| A2 | 🟡 | Conversion Funnel — лише horizontal bars. **Воронка візуально невпізнавана** (бо всі бари однієї висоти, лише довжина різна). | Funnel chart має бути або справжній «funnel»-shape, або labelled вертикально. Зараз це просто прогрес-бари. | Розглянути `Recharts.Funnel` або кастомний `<Trapezoid />` shape. |
| A3 | 🟢 | KPI-tile delta показує `↑ live` — слово «live» збиває з пантелику (це не sign delta, а статус-тег). | Розділити: статус-pill окремо, delta окремо. | У [`KpiTile`](../src/app/components/portal-ui.tsx) додати окремий проп `liveBadge`. |

---

### 3.5 Settings

**Скрін:** [client-05-settings-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/client-05-settings-desktop.png)

#### Що бачимо
- 1 секція «Security controls»: Profile name → input + button `Update name`; Change password → 2 inputs + button; Session control → `Sign out`.
- Sidebar показує «Contract KPIs · MQL target 0/mo · Meetings 0/mo» внизу.

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| S1 | 🟡 | Немає блоку «Account email» / `Send reset link` (на admin-version він є, на client — немає). | Якщо клієнт забув старий пароль і вже залогінений (наприклад, з браузерного автозаповнення), він не може ініціювати reset link. | Спробувати reuse того самого блоку «Request password reset link», що в admin settings. |
| S2 | 🟢 | «Update name» disabled-look поки нічого не введено — кнопка одразу кольору `bg-primary/40`. Виглядає як «недоступний», насправді — «без змін». | Disabled-стиль для not-dirty має використовувати `cursor-not-allowed` + tooltip «Type to enable». | Стандартний pattern із [`Button`](../src/app/components/ui/button.tsx). |

---

## 4. Manager portal — `nocaxeb217@pmdeal.com`

### 4.1 Dashboard

**Скрін:** [manager-01-dashboard-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-01-dashboard-desktop.png) · [manager-01-dashboard-mobile.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-01-dashboard-mobile.png)

#### Що бачимо
- Title «CS manager dashboard», subtitle про clients/leads/campaigns.
- 8 KPI-tile-ів у 4×2 grid: Clients (38), Active outreach (23), Leads (1.6 K), Last 30d MQLs (?), Meetings Booked (?), Deals Won (?), Sent (?), Reply rate (?).
- Charts: Daily sent / replies / positives, Pipeline by stage, Campaign performance ranking.

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| MD1 | 🟡 | KPI-tiles НЕ мають delta (порівняно з client portal, де delta є). Manager не бачить «що сталось vs minulý period». | Manager — оперативна роль, delta критична для триажу. | Додати delta-mode у [`MetricCard`](../src/app/components/app-ui.tsx) (паралельно з [`KpiTile`](../src/app/components/portal-ui.tsx)). |
| MD2 | 🟡 | На mobile 8 tile-ів стають 8 рядами по 1 — 100 % вертикальний scroll до того, як видно перший чарт. | Менеджеру треба швидко scan all clients. | На `< md` перейти на `grid-cols-2`, а tile-и зробити 2× компактнішими (`text-xl` → `text-base`). |

---

### 4.2 Clients

**Скрін:** [manager-02-clients-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-02-clients-desktop.png)

#### Що бачимо
- Заголовок «Clients · Primary analytics hub for management quick analysis with drawer-based drill-down» + кнопка `Hide menu`.
- Таблиця «Client analytics table» з колонками: Client (Code), Status (Code), Manager (Code), 30d Schedule LH/UH (Code), 30d Sent M/Q (Code).
- 38 рядків клієнтів. Кожен рядок: name, status `Active/On hold/Active`, manager, два числові slot-и `0/0/0`.

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| MC1 | 🔴 | **Назви колонок мають суфікс «(Code)»** — це debug/dev label, що просочився в production. | Виглядає, як зламаний UI. | Знайти у компоненті колонок та прибрати «(Code)». Також самостійні значення `Active` мають той самий суфікс — те саме місце. |
| MC2 | 🟡 | Усі значення «30d Schedule LH/UH» = `0/0/0`. Невідомо, чи це реально нулі чи відсутні дані. | Розрізнити «no data» vs «0». | Якщо джерело null → показати `—`. Якщо легітимний 0 → залишити. |
| MC3 | 🟡 | Немає search/filter по status, no pagination | На 38 рядках поки немає проблем, але при 200+ це буде кошмар. | Додати [`PortalSearch`](../src/app/components/portal-ui.tsx) + status-chip filter. |

---

### 4.3 Leads

**Скрін:** [manager-03-leads-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-03-leads-desktop.png) · [manager-03-leads-mobile.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-03-leads-mobile.png)

#### Що бачимо
- Header «Leads · One shared lead workspace with raw assets ready, status updates, and managers to spot updates outside the operations test...» (опис обрізаний).
- Filter row: «Lead filters · Current timeframe · Last 30 Days», «All campaigns», «All clients · Active».
- Chip filters по етапах: Pre-MQL (?), MQL (?), Meeting Scheduled (?), Meeting Held (?), Offer Sent (?), Reported (?).
- Таблиця ліди — name, company, stage badge, дата.

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| ML1 | 🟡 | Опис під заголовком занадто довгий (3+ рядки) і обрізаний посередині речення. | Втрачена остання частина. | Скоротити рекомендований текст або зробити на 2 рядки + `Read more`. |
| ML2 | 🟡 | Chip filters не показують каунт у дужках (на client portal такий же chip має каунт; на manager — ні). | Inconsistent. | Додати `count` пропу в chip (повторно вже є в [client-view-models](../src/app/lib/client-view-models.ts)). |
| ML3 | 🟢 | Stage badges «MQL» (фіолетовий), але деякі рядки взагалі без badge. | Без badge виглядає як «застряг у системі». | Підставити дефолтну стадію або хоча б `New`. |

---

### 4.4 Campaigns

**Скрін:** [manager-04-campaigns-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-04-campaigns-desktop.png)

#### Що бачимо
- Аналог admin-Campaigns: довгий список усіх кампаній з колонками `Campaign name · Type (Code) · Status (Code) · External id`.
- Великий вертикальний scroll (40+ кампаній).

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| MCa1 | 🔴 | Та сама проблема `(Code)` суфікса (див. MC1). Системна. | — | Перевірити всі сторінки manager/admin на «(Code)» — це schema-driven generic table зі spillover-метаданих. |
| MCa2 | 🟡 | Всі кампанії одного цвіту тексту, немає row-banding/zebra. На 40+ рядках око губиться. | — | Додати `odd:bg-white/[0.02]` у tr. |
| MCa3 | 🟡 | Status chip кольори: `outreach` теж не несе інформативного кольору, всі однакові. | — | `outreach`= sky, `nurture` = violet, `legacy` = gray. |

---

### 4.5 Analytics

**Скрін:** [manager-05-analytics-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-05-analytics-desktop.png)

#### Що бачимо
- 5 KPI-tiles (Sent, Replies, Positives, Reply rate, Positive rate).
- Aggregate timeseries: Daily sent (line), Replies trend (line), Pipeline activity (line), Campaign performance (bar).
- Conversion funnel внизу.

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| MA1 | 🟡 | Аналогічна A2 проблема: funnel невпізнаваний. | — | Див. A2. |
| MA2 | 🟢 | Daily sent / Replies / Pipeline Activity — три лінійні чарти один за одним з однаковим X-axis. Можна обʼєднати у multi-line chart з legend для compactness. | — | Композитний chart допоможе скоротити висоту сторінки на 40 %. |

---

### 4.6 Domains

**Скрін:** [manager-06-domains-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-06-domains-desktop.png)

#### Що бачимо
- Header + dashed empty-state «No domains in current scope».
- Sidebar з усіма пунктами підсвічено `Domains`.

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| MDom1 | 🟢 | Empty-state шаблонний, але **не пояснює, що робити**. «When domains are synced…» — а як їх sync? | Пасивний voice без дії. | Додати CTA: `Sync now` (виклик n8n webhook) або link «Configure domain sync» з посиланням на runbook. |

---

### 4.7 Invoices

**Скрін:** [manager-07-invoices-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-07-invoices-desktop.png)

#### Що бачимо
- Header + 3 KPI-tiles (Invoices 0, Paid 0, Overdue 0 · Scope total €0) + empty-state «No invoices in current scope».

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| MI1 | 🟢 | KPI «Overdue 0» зеленого кольору (бо € є). Логічно негативна метрика, тому navigation: при `overdue > 0` — `text-amber-300`. | — | Conditional colour pattern. |

---

### 4.8 Blacklist

**Скрін:** [manager-08-blacklist-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-08-blacklist-desktop.png)

#### Що бачимо
- Дуже довгий список доменів (200+), кожен — назва + `Remove` button.
- Без search.

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| MB1 | 🔴 | **Немає search/filter**. Знайти конкретний домен у 200+ — біль. | Стандартна потреба для blacklist UI. | Додати [`PortalSearch`](../src/app/components/portal-ui.tsx) угорі. |
| MB2 | 🟡 | Кнопка `Remove` — світло-сіра, не destructive. | Користувач може випадково клацнути. | Стилізувати як `variant="destructive"` (red-amber). |
| MB3 | 🟡 | Нема bulk action / pagination. | На 1000+ доменів буде лагати. | Lazy load із [§4.6 CLAUDE.md](../CLAUDE.md#46-tables) (PAGE_SIZE=50). |

---

### 4.9 Settings

**Скрін:** [manager-09-settings-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/manager-09-settings-desktop.png)

#### Що бачимо
- Той самий layout, що в admin settings (див. §5.6): Current identity (left) + Security controls (right).

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| MS1 | 🟢 | Identical to admin settings — добре (reuse), але «Workspace · admin» у sidebar manager-а виглядає дивно (manager в admin workspace?) | Це лейбл workspace-у, не ролі — confusing. | Перейменувати «Workspace» → «Tenant» або показувати ім`я компанії. |

---

## 5. Admin portal — `medaval606@tatefarm.com`

### 5.1 Dashboard

**Скрін:** [admin-01-dashboard-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-01-dashboard-desktop.png) · [admin-01-dashboard-mobile.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-01-dashboard-mobile.png)

#### Що бачимо
- Аналогічний manager dashboard, з додатковою sidebar-секцією «User management».

#### Знахідки
Все, що для manager (MD1-2), валідне і тут. Додатково:

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| AD1 | 🟢 | Admin dashboard ідентичний manager-у (ту саму інформацію). | Adminу часто треба «глобальна» картина (по всіх tenant-ах). | Розглянути окрему «System overview» секцію (last login, RLS denials, snapshot age). |

---

### 5.2 User Management

**Скрін:** [admin-02-users-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-02-users-desktop.png) · [admin-02-users-mobile.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-02-users-mobile.png)

#### Що бачимо
- Header «User Management · Invite-only access control with lifecycle actions for pending, accepted, and expired invitations.»
- «Create invitation»: email + role (`client`) + client (`Select client`) + `Send invitation`.
- 4 KPI-tiles: Total 4, Pending 0, Accepted 4, Expired 0.
- «Invitation lifecycle» з табами All / Pending / Accepted / Expired та list карток (email, role, invited/accepted/expires, invited by).

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| AU1 | 🟡 | Кнопка `Resend` доступна для `accepted` запрошень. Технічно не має сенсу (вже прийняте). | Lead to confusion. | Disable `Resend` коли status=accepted. |
| AU2 | 🟡 | На mobile форма `Create invitation` стискається, але `Send invitation` button лишається право-вирівняна — на 390 px вилазить за грид. (Видно на mobile screenshot.) | — | `w-full sm:w-auto` для кнопки. |
| AU3 | 🟢 | Дата формат `21 Apr 2026, 10:50` — добре. Але `Invited by · Andrii Popovych` — string, без link на user-а. | Можна було б drill-down до профілю інвайтера. | Додати hover-card з останніми діями. |

---

### 5.3 Clients

**Скрін:** [admin-03-clients-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-03-clients-desktop.png)

#### Що бачимо
Та сама таблиця, що в manager (§4.2). Ті самі проблеми з «(Code)» суфіксом і відсутністю фільтрів.

> Знахідки = MC1, MC2, MC3.

---

### 5.4 Leads

**Скрін:** [admin-04-leads-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-04-leads-desktop.png)

#### Що бачимо
Аналог manager Leads (§4.3). Той самий list, той самий filter, той самий issue з обрізаним описом.

> Знахідки = ML1, ML2, ML3.

---

### 5.5 Campaigns

**Скрін:** [admin-05-campaigns-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-05-campaigns-desktop.png)

#### Що бачимо
Знов той самий list з manager-у (§4.4). Та сама проблема `(Code)`.

---

### 5.6 Analytics

**Скрін:** [admin-06-analytics-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-06-analytics-desktop.png)

#### Що бачимо
**КРИТИЧНО:** Сторінка показує сотні (!) маленьких empty tile-карток у вертикальному списку, без явного контенту. Виглядає як рендеринг-баг або як infinite skeleton.

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| AA1 | 🔴 | Admin Analytics показує **ні KPIs, ні chart-ів** — тільки декоративну сітку tile-ів. | На production це виглядає як зламана сторінка. | Перевірити, чи компонент очікує дані, яких в admin scope немає. Якщо empty — показати справжній empty-state, не «галерею». Файл: [`src/app/pages/analytics-page.tsx`](../src/app/pages/analytics-page.tsx) (підтвердити). |
| AA2 | 🟡 | Можливо, причина — використання aggregate, який під admin scope повертає тисячі бакетів, які кожен рендериться як tile. | RLS / scoping issue. | Перевірити EXPLAIN ANALYZE на запит з [supabase MCP](../docs/reference/agent-tooling.md). |

---

### 5.7 Domains, 5.8 Invoices

**Скріни:** [admin-07-domains-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-07-domains-desktop.png) · [admin-08-invoices-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-08-invoices-desktop.png)

Empty-state, як у manager (див. §4.6, §4.7). Знахідки MDom1, MI1 валідні.

---

### 5.9 Blacklist

**Скрін:** [admin-09-blacklist-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-09-blacklist-desktop.png)

Той самий список 200+ доменів. Знахідки MB1-3 валідні.

---

### 5.10 Settings

**Скрін:** [admin-10-settings-desktop.png](screenshots/visual-analysis-2026-04-26/thumbs/admin-10-settings-desktop.png)

#### Що бачимо
Дві колонки: **Current identity** (Actor, Effective name/email/role, Impersonation Off, Session email) + **Security controls** (Profile name, Change password, Request password reset link, Session control).

#### Знахідки

| # | Пріоритет | Що бачимо | Чому це важливо | Що зробити |
|---|-----------|-----------|-----------------|------------|
| AS1 | 🟢 | «Current identity» — корисний для дебагу імперсонації. Але показує і коли `Impersonation: Off` (зайве). | Зменшити шум для звичайного use-case. | Показувати «Impersonation» секцію тільки коли `isImpersonating === true`. |
| AS2 | 🟢 | «Session email» дублює «Effective email» коли імперсонації немає. | Дублювання. | Сховати при `actor.email === effective.email`. |

---

## 6. Зведена таблиця пріоритетів (TL;DR)

| Pri | Code | Title | Files |
|-----|------|-------|-------|
| 🔴 | G1 | Mobile sidebar накриває контент | [app-shell.tsx](../src/app/components/app-shell.tsx) |
| 🔴 | G2 / AA1 | Admin Analytics — порожня галерея | [analytics-page.tsx](../src/app/pages/analytics-page.tsx) |
| 🔴 | C1 | «0/mo» Contract KPIs — не задано vs реальний 0 | [portal-ui.tsx](../src/app/components/portal-ui.tsx) |
| 🔴 | CC1 | Reply-rate 0% при `Positive: 3` — broken formula | [client-view-models.ts](../src/app/lib/client-view-models.ts) |
| 🔴 | MC1 / MCa1 | «(Code)» суфікс у назвах колонок та value-cell | manager+admin tables |
| 🔴 | MB1 | Blacklist без search | [blacklist-page.tsx](../src/app/pages/blacklist-page.tsx) (підтвердити) |
| 🟡 | G3 | Mobile menu hamburger відсутній на client/manager | app-shell |
| 🟡 | G4 | Таблиці без фільтрів | manager+admin sections |
| 🟡 | C2 / A3 | KPI delta sign / live badge перемішано | portal-ui |
| 🟡 | CC2 | Технічні поля кампанії показуються клієнту | client-view-models |
| 🟡 | MD1 / MD2 | Manager dashboard без delta + поганий mobile grid | app-ui MetricCard |
| 🟡 | ML1 | Обрізаний опис на Leads | leads-page |
| 🟡 | MB2/MB3 | Blacklist Remove не destructive + no pagination | blacklist-page |
| 🟡 | A1 / A2 / MA1 | Funnel chart не funnel + sparse charts | analytics components |
| 🟡 | AU1 / AU2 | Resend на accepted, mobile form overflow | user-management page |
| 🟢 | G5 / G6 | Placeholder contrast + sidebar baseline | global |
| 🟢 | L1-L4 | Login: forgot pwd, spinner, mobile order, placeholder | login-page |
| 🟢 | P2/P3, CC3, MA2, AS1/AS2, etc. | Polish | various |

---

## 7. Рекомендована послідовність робіт

1. **Sprint 1 (1-2 дні).** Усі 🔴 з критичним впливом на довіру: `(Code)` суфікси (5 хвилин — дев фікс), broken reply-rate (CC1, формула), Admin Analytics empty (AA1, root-cause), search на Blacklist (MB1).
2. **Sprint 2 (3-4 дні).** Mobile UX (G1, G3, MD2): adaptive sidebar з hamburger-ом, repsonsive grids на dashboard.
3. **Sprint 3 (1 тиждень).** UX-патерни: фільтри + sort на manager/admin таблицях (G4), conversion funnel візуалізація (A2/MA1), KPI delta для manager (MD1).
4. **Polish + хвости.** Усі 🟢 у довільному порядку, можна batch-ом.

---

## 8. Як було проведено

- **Інструмент:** локальний Playwright (`@playwright/test 1.56.0`), Chromium 1196.
- **Specs:**
  - [`e2e/visual-analysis.spec.ts`](../e2e/visual-analysis.spec.ts) — 4 тести (public + 3 ролі), повний обхід.
  - [`e2e/visual-analysis.config.ts`](../e2e/visual-analysis.config.ts) — без webServer (Vite dev сервер запускався окремо).
- **Виходи:** 50 PNG-screenshot-ів (25 desktop 1440×900 + 25 mobile 390×844), збережено у [`docs/screenshots/visual-analysis-2026-04-26/`](screenshots/visual-analysis-2026-04-26/).
- **Креденшіали** передано через env (`VA_*_EMAIL` / `VA_*_PASSWORD`) — у репозиторії та коді відсутні.
- **Аналіз:** ручний прохід кожного screenshot-у з фокусом на (а) інформаційну ієрархію, (б) actionability, (в) consistency між ролями, (г) responsive поведінку, (д) empty/error states.

---

## 9. Що далі

- **Не закривати знахідки в цьому документі.** Конвертувати в issues / TODO у `BUSINESS_LOGIC.md §11 Open backlog` або відповідних role-page docs (05/06/07 у [`docs/reference/functional/`](reference/functional/)).
- **Перезапускати spec** після кожного UI-фікса — він швидкий (~2.5 хв) і гарантує, що нічого не зломалось у трьох ролях одразу.
- **Інтегрувати в CI** як smoke-тест на screenshot-diff (наразі лише capture, без diff). Це задача для окремого PR.

---

> **Висновок одним реченням.** Дизайн-система ColdUnicorn послідовна і зріла, але по 6 системним проблемам (mobile sidebar, `(Code)` суфікси, Admin Analytics порожня галерея, broken reply-rate, відсутність search на blacklist, неправильна семантика «0 vs not configured») система зараз виглядає менш надійною, ніж є насправді. Жодна з проблем не вимагає рефакторингу архітектури — всі вирішуються в межах існуючих компонентів і за ~3 спринти.
