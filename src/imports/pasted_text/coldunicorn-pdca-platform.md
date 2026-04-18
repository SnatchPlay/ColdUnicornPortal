Статут Проекту: ColdUnicorn PDCA Platform
1. Резюме проекту (Executive Summary)
Мета: Повна трансформація існуючої операційної моделі управління B2B лідогенерацією. Поточна система, що базується на десятках пов'язаних таблиць Google Sheets (зокрема, критичний файл "CS PDCA" з понад 120 колонками, які генеруються вручну, та десятки ізольованих файлів клієнтських звітів), досягла абсолютної межі свого масштабування. Проблеми з паралельним доступом, лімітами API Google, крихкістю складних формул VLOOKUP/QUERY та відсутністю аудиту змін роблять поточний процес управління нестабільним.
Нова мета — створити високопродуктивну, масштабовану, відмовостійку та безпечну SaaS-платформу. Ця екосистема усуне ручне введення даних, мінімізує людські помилки (human error), забезпечить кристальну прозорість для клієнтів у режимі реального часу та вивільнить сотні годин роботи команди Customer Success (CS) для стратегічного консалтингу замість копіпастингу.
Стек технологій: * Frontend: React (збірка через Vite для максимальної швидкості розробки та миттєвого Hot Module Replacement), TypeScript (для суворої типізації, контрактування даних з бекендом та уникнення runtime-помилок у браузері), Shadcn/ui + Tailwind CSS (для створення консистентної, легкої в підтримці та сучасної дизайн-системи без роздуття CSS-бандлу), TanStack Table (для обробки великих масивів даних у таблицях з віртуалізацією рядків без втрати продуктивності DOM), TanStack Query (для інтелектуального кешування, фонової синхронізації та оптимістичного оновлення UI), Recharts (для візуалізації часових рядів та аналітичних воронок).
Backend / База даних / Авторизація: Supabase. Використовується PostgreSQL як надійне реляційне сховище промислового рівня. Edge Functions (Deno) застосовуються для обробки серверної логіки без холодних стартів (наприклад, безпечні інтеграції зі сторонніми API клієнтських CRM). Supabase Auth у комбінації з Row Level Security (RLS) гарантує ізоляцію даних між різними тенантами безпосередньо на рівні ядра бази даних, що унеможливлює витоки інформації через помилки на фронтенді.
Ключова цінність та інновації: * Усунення "Горизонтального розростання": Автоматизація збору статистики шляхом переходу від додавання нових колонок для кожного тижня/місяця до класичної архітектури часових рядів (Time-Series). Це робить запити стабільними (O(1) або O(log n)), незалежно від того, аналізується 1 тиждень чи 5 років історії.
Розділення аналітики та CRM (Separation of Concerns): Абсолютні показники розсилок (Total Sent, Total Replies, Bounces) скрапляться безпосередньо з секвенсерів (Bison, Smartlead) в окремі агреговані таблиці. Натомість операційний CRM-модуль зберігає виключно "теплих" та цільових лідів (MQL/preMQL). Це кардинально оптимізує розмір бази даних та вартість інфраструктури.
Безпека та Ізоляція за принципом Zero Trust: Завдяки політикам RLS кожен клієнт гарантовано бачить лише свої власні дані. Навіть якщо API-ендпоінт буде скомпрометовано, БД просто не віддасть чужі рядки. Внутрішні угоди агенції (Agency CRM) повністю ізольовані від клієнтських просторів.
Подієво-орієнтована архітектура (Event-driven): Перехід від ручного (batch) оновлення статусів до реактивних автоматичних тригерів, де зміна стану однієї сутності каскадно ініціює необхідні бізнес-процеси (наприклад, відправку вебхука в клієнтський Pipedrive).
Очікувані бізнес-результати (ROI):
Скорочення часу на підготовку тижневої звітності (Weekly Reports) з ~15 годин/тиждень до 0.
Збільшення пропускної здатності одного CS-менеджера з умовних 10 до 25-30 активних клієнтів завдяки автоматизації та інструментам масової дії.
Підвищення задоволеності клієнтів (NPS) завдяки прозорому порталу 24/7 та миттєвій передачі MQL-лідів.
2. Бізнес-логіка та Машини станів (State Machines)
2.1. Життєвий цикл Ліда (Lead State Machine)
Кожен лід (відповідь на холодний email) є ключовим активом системи і проходить через суворий, багаторівневий процес кваліфікації. У базу даних фізично імпортуються лише ліди, що потребують уваги людини або подальшої автоматизації (MQL, preMQL, OOO, Info Requested). Відверте технічне сміття (Hard Bounces, Auto-Unsubscribe) ігнорується на рівні оркестратора (Make.com).
AI Classification (Автоматизація ARM - Automated Replies Management): * Webhook передає сирий текст відповіді, метадані кампанії та історію листування до OpenAI.
Промпт аналізує інтент та контекст. Відбувається не просто пошук ключових слів, а семантичний аналіз. Системі присвоюються теги: Positive (явний інтерес), OOO (відпустка/звільнення), Negative (явна відмова), Info_Requested (запит прайсу чи кейсів без згоди на дзвінок).
Збагачення даних (Data Enrichment): ШІ визначає sequence_step (номер кроку в ланцюжку, на який зреагував лід, що критично для аналізу Copy Health), витягує контактні номери з підпису, та визначає gender (стать ліда на основі імені та мови для правильної OOO-кампанії).
Крайовий випадок (Edge Case): Якщо лід відповідає "Видаліть мене з бази" (Hard Negative), він автоматично додається до email_exclude_list, блокуючи будь-які майбутні розсилки на цей домен або email.
OOO Processing (Інтелектуальна обробка автовідповідачів): * Якщо ШІ визначає статус OOO, він парсить текст для пошуку Expected Return Date (дати повернення). Наприклад, "I am out on maternity leave until March 2026".
Автоматичний скрипт (Cron) щоденно моніторить таблицю leads. Якщо поточна дата  expected_return_date, система на основі статі (gender) знаходить правильний ID відновлювальної кампанії через таблицю client_ooo_routing та відправляє API-запит до секвенсера для ре-енгейджменту.
Human Review (Валідація CS-менеджером - "Human in the Loop"):
Хоча ШІ виконує 80% роботи, остаточне рішення для складних або неоднозначних відповідей залишається за людиною (впевненість ШІ < 85%).
Менеджер читає контекст і приймає рішення: змінити статус на preMQL (потребує додаткового "утеплення" або перевірки на відповідність ICP) або одразу на MQL. Тільки після отримання статусу MQL лід стає видимим у Клієнтському Порталі.
Client Pipeline (Керується клієнтом - The Closing Funnel):
Клієнт отримує MQL і рухає його лінійно або зі стрибками: MQL -> meeting_scheduled -> meeting_held -> offer_sent -> won.
Зворотній зв'язок (Feedback Loop): Якщо клієнт відхиляє ліда, система примусово вимагає вибрати причину відмови (Not ICP, No Budget, Bad Timing). Ця інформація агрегується для CS-менеджера, щоб він міг скоригувати таргетинг бази або текст листа.
2.2. Життєвий цикл Клієнта (Client Lifecycle)
Onboarding: Створення профілю клієнта, фіксація фінансових умов та KPI (kpi_leads). Налаштування API-інтеграцій (Bison/Smartlead), закупівля та прив'язка пулу доменів, створення правил OOO-маршрутизації.
Active: Запущені бойові кампанії. Відбувається щоденний моніторинг відхилень обсягів розсилки від KPI (min_sent_daily). Якщо індикатори падають, CS отримує тривожне сповіщення.
Paused: Тимчасова зупинка операцій. Причини фіксуються: критичні проблеми з інфраструктурою (потрапляння IP/доменів у глобальні Blacklists), перевантаження відділу продажу клієнта або необхідність повного переписування текстів розсилки.
Churned / Lost: Співпраця повністю припинена. Запис переміщується у таблицю abm_lost_clients. Обов'язково фіксується детальна причина відтоку, архівуються лінки на робочі документи та прогнозується ймовірність повернення (Win-back window, наприклад, через 6 місяців, коли у клієнта з'явиться бюджет).
3. Схема Бази Даних (Data Architecture & SQL Schema)
Схема реалізує жорстку архітектуру 3-ї нормальної форми (3NF), розділяє кількісну аналітику від операційної CRM та використовує RLS для безкомпромісної безпеки. Для оптимізації читання впроваджено кешування лічильників.
3.1. Глобальні Типи Даних (ENUMs)
Використання ENUM гарантує цілісність даних (Data Integrity) на рівні рушія БД, не дозволяючи бекенду чи автоматизаціям записати невалідні текстові статуси (наприклад, "wonn" замість "won").
CREATE TYPE user_role AS ENUM ('super_admin', 'admin', 'cs_manager', 'client');
CREATE TYPE client_status AS ENUM ('onboarding', 'active', 'paused', 'churned', 'lost');
CREATE TYPE reply_intent AS ENUM ('positive', 'negative', 'ooo', 'info_requested', 'unclassified');
CREATE TYPE lead_gender AS ENUM ('male', 'female', 'general');
CREATE TYPE health_status AS ENUM ('green', 'yellow', 'red', 'unknown');

-- Статуси внутрішніх продажів послуг агенції
CREATE TYPE crm_pipeline_stage AS ENUM ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost');

-- Автомат станів клієнтського ліда. (Використовуються переважно від preMQL і вище)
CREATE TYPE lead_qualification AS ENUM (
  'unprocessed', 'unqualified', 'preMQL', 'MQL', 
  'meeting_scheduled', 'meeting_held', 'offer_sent', 'won', 'rejected'
);

-- Типізація кампаній для правильної фільтрації в інтерфейсах
CREATE TYPE campaign_type AS ENUM ('outreach', 'ooo', 'nurture');


3.2. Ядро та Доступ (Core & Access Control)
Усі первинні ключі використовують UUID v4 (через gen_random_uuid()) для уникнення проблем з передбачуваністю ID (IDOR вразливості) та полегшення можливого шардингу в майбутньому.
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Розширення стандартної таблиці auth.users від Supabase
CREATE TABLE users (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id),
  email           TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  role            user_role NOT NULL DEFAULT 'client',
  avatar_url      TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Матриця доступу (Хто з клієнтів має доступ до якого профілю компанії)
CREATE TABLE client_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(client_id, user_id)
);


3.3. Клієнтська Інфраструктура (Client Infrastructure Profile)
Цей блок декомпозовано на три таблиці для зменшення "ширини" основного профілю та зручності адміністрування.
CREATE TABLE clients (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID REFERENCES organizations(id),
  name                    TEXT NOT NULL,
  status                  client_status DEFAULT 'onboarding',
  cs_manager_id           UUID REFERENCES users(id) ON DELETE SET NULL, -- Збереження історії при звільненні CS
  
  -- Фінансові та контрактні умови
  kpi_leads               INTEGER, 
  kpi_meetings            INTEGER, 
  contracted_amount       NUMERIC(10,2), 
  contract_due_date       DATE,
  
  -- Зовнішні ідентифікатори
  bison_workspace_id      TEXT,
  smartlead_client_id     TEXT,
  
  -- Soft delete для захисту від випадкового каскадного видалення сотень тисяч записів
  deleted_at              TIMESTAMPTZ, 
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE client_setup (
  client_id               UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  auto_ooo_enabled        BOOLEAN DEFAULT true,
  min_sent_daily          INTEGER DEFAULT 0, -- Тригер для підсвітки "червоним" у DoD матриці
  crm_platform            TEXT CHECK (crm_platform IN ('livespace', 'pipedrive', 'zoho', 'salesforce', 'none')),
  
  -- JSONB використовується для гнучкості: різні CRM вимагають різні набори ключів/токенів (OAuth, API Key + Workspace)
  crm_credentials         JSONB, 
  inboxes_count           INTEGER DEFAULT 0,
  prospects_in_base       INTEGER DEFAULT 0,
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE domains (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain_name             TEXT NOT NULL,
  setup_email             TEXT, 
  purchase_date           DATE,
  exchange_date           DATE, 
  warmup_reputation       INTEGER CHECK (warmup_reputation BETWEEN 0 AND 100), -- Прогрес прогріву (0-100%)
  is_active               BOOLEAN DEFAULT true,
  is_blacklisted          BOOLEAN DEFAULT false,
  created_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_domains_client ON domains(client_id);


3.4. Модуль Комунікацій (Selective CRM)
Тут зберігається виключно "золотий актив" — кваліфіковані ліди (MQL/preMQL) та правила обробки нестандартних ситуацій (OOO).
CREATE TABLE campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id         TEXT UNIQUE, -- ID безпосередньо з секвенсера (Bison/Smartlead)
  type                campaign_type DEFAULT 'outreach', 
  name                TEXT NOT NULL,
  status              TEXT, 
  database_size       INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Рушій правил (Rule Engine) для маршрутизації OOO-відповідей на основі статі
CREATE TABLE client_ooo_routing (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  gender                  lead_gender NOT NULL, 
  campaign_id             UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  is_active               BOOLEAN DEFAULT true,
  UNIQUE(client_id, gender) -- Захист від створення конфліктуючих правил
);

CREATE TABLE leads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id           UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  
  email                 TEXT NOT NULL,
  full_name             TEXT,
  job_title             TEXT,
  company_name          TEXT,
  linkedin_url          TEXT,
  gender                lead_gender DEFAULT 'general',
  
  qualification         lead_qualification DEFAULT 'preMQL',
  is_ooo                BOOLEAN DEFAULT false,
  expected_return_date  DATE,
  
  -- Кешування для миттєвого відображення в UI таблицях (без важких COUNT / JOIN запитів)
  latest_reply_at       TIMESTAMPTZ, 
  replied_at_step       INTEGER, -- Колишня колонка "Message #". Вказує, чи відповів лід на 1-й лист чи на фоловап
  total_replies_count   INTEGER DEFAULT 0,
  
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, email)
);
-- Комбінований індекс для блискавичного фільтрування лідів по клієнту та їх статусу
CREATE INDEX idx_leads_client_qualification ON leads(client_id, qualification);

CREATE TABLE lead_replies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id               UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  external_reply_id     TEXT UNIQUE NOT NULL, -- Запобіжник від дублювання даних при повторних webhook-викликах
  
  direction             TEXT DEFAULT 'inbound',
  sequence_step         INTEGER, -- Оригінальний step_number з секвенсера
  message_subject       TEXT,
  message_text          TEXT NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL,
  
  ai_classification     reply_intent DEFAULT 'unclassified',
  ai_reasoning          TEXT, -- Пояснення моделі (Chain of Thought), чому було прийнято таке рішення
  ai_confidence         NUMERIC(3,2),
  extracted_date        DATE, 
  
  created_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_replies_lead_id ON lead_replies(lead_id, received_at DESC);


3.5. Часові ряди (Масштабована Аналітика - Time-Series)
Це незалежне джерело істини для макростатистики. Таблиці заповнюються виключно через API-скрапінг, зберігаючи всі абсолютні показники (навіть якщо ліди-відмовники не були імпортовані в CRM).
CREATE TABLE campaign_daily_stats (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  report_date           DATE NOT NULL,
  
  sent_count            INTEGER DEFAULT 0,
  reply_count           INTEGER DEFAULT 0, -- Включає ВСІ відповіді (включаючи Bounces, Unsubscribe)
  bounce_count          INTEGER DEFAULT 0,
  unique_open_count     INTEGER DEFAULT 0,
  UNIQUE(campaign_id, report_date)
);

-- Ця таблиця є серцем PDCA матриці (замінює вкладку "🤖Daily stats.csv").
-- Вона фіксує щоденні зліпки та приріст (дельти) для розрахунку DoD, WoW та MoM графіків.
CREATE TABLE client_daily_snapshots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  snapshot_date           DATE NOT NULL,
  
  inboxes_active          INTEGER DEFAULT 0,
  prospects_count         INTEGER DEFAULT 0,
  emails_sent_total       INTEGER DEFAULT 0,
  bounce_count            INTEGER DEFAULT 0,
  
  -- Денні дельти (приріст метрик САМЕ ЗА ЦЕЙ ДЕНЬ)
  mql_diff                INTEGER DEFAULT 0, 
  me_diff                 INTEGER DEFAULT 0, -- Meetings Scheduled
  won_diff                INTEGER DEFAULT 0, -- Closed Won Deals
  
  ooo_accumulated         INTEGER DEFAULT 0,
  negative_total          INTEGER DEFAULT 0,
  human_replies_total     INTEGER DEFAULT 0,
  
  created_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, snapshot_date) 
);
CREATE INDEX idx_client_snapshots_date ON client_daily_snapshots(client_id, snapshot_date DESC);


3.6. Внутрішні Операції (Agency Management)
Дані таблиці доступні виключно внутрішній команді ColdUnicorn і забезпечують контроль якості та фінансів.
-- Журнал аудитів здоров'я проекту (2Wo2W Health)
CREATE TABLE client_health_assessments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  assessed_by       UUID REFERENCES users(id),
  assessed_at       TIMESTAMPTZ DEFAULT now(),
  ip_health         health_status DEFAULT 'unknown',
  domains_health    health_status DEFAULT 'unknown',
  warmup_health     health_status DEFAULT 'unknown',
  copy_health       health_status DEFAULT 'unknown',
  funnel_health     health_status DEFAULT 'unknown',
  insights          TEXT -- Текстове пояснення для жовтих та червоних статусів
);

-- Ізольована воронка внутрішніх продажів ColdUnicorn (Agency CRM)
CREATE TABLE agency_crm_deals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name      TEXT NOT NULL,
  contact_name      TEXT,
  email             TEXT,
  phone             TEXT,
  source            TEXT, -- Канал залучення: Inbound, Outbound, Referral, Event
  salesperson_id    UUID REFERENCES users(id),
  stage             crm_pipeline_stage DEFAULT 'new',
  stage_updated_at  TIMESTAMPTZ DEFAULT now(),
  estimated_value   NUMERIC(10,2), 
  win_chance        INTEGER CHECK (win_chance BETWEEN 0 AND 100),
  lesson_learned    TEXT, -- Ретроспектива у разі програшу (Lost reason)
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Фінансове прогнозування та бюджет (Cash Flow)
CREATE TABLE cash_flow_projections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month         DATE NOT NULL, 
  category      TEXT NOT NULL, 
  is_revenue    BOOLEAN DEFAULT false, 
  amount        NUMERIC(10,2) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(month, category) 
);

-- Реєстр рахунків-фактур
CREATE TABLE invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  issue_date        DATE NOT NULL,
  amount            NUMERIC(10,2) NOT NULL,
  status            TEXT CHECK (status IN ('draft', 'sent', 'paid', 'overdue')),
  vindication_stage TEXT, -- Стадія стягнення боргу, якщо статус 'overdue'
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Глобальний Blacklist для блокування розсилок на специфічні домени (напр., конкуренти, юристи)
CREATE TABLE email_exclude_list (
  domain      TEXT PRIMARY KEY, 
  added_by    UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Архів клієнтів, що припинили співпрацю
CREATE TABLE abm_lost_clients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID REFERENCES clients(id) ON DELETE SET NULL, 
  client_name         TEXT NOT NULL,
  documents_link      TEXT,
  reason_for_loss     TEXT,
  return_probability  TEXT, 
  created_at          TIMESTAMPTZ DEFAULT now()
);


3.7. Політики доступу (Row Level Security - RLS)
Ці політики інтегруються безпосередньо в план виконання (execution plan) бази даних. Обійти їх на рівні API неможливо.
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_replies ENABLE ROW LEVEL SECURITY;

-- 1. CS-менеджери та Адміни бачать повну картину по своїх (або всіх) клієнтах
CREATE POLICY "cs_managers_see_all_leads" ON leads
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM users 
    WHERE users.id = auth.uid() 
    AND (users.role IN ('admin', 'super_admin') OR leads.client_id IN (SELECT client_id FROM clients WHERE cs_manager_id = auth.uid()))
  )
);

-- 2. Клієнти бачать ЛИШЕ своїх лідів, і ЛИШЕ тих, які пройшли первинний відсів (Подвійний захист)
CREATE POLICY "clients_see_only_qualified_leads" ON leads
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM client_users 
    WHERE client_users.user_id = auth.uid() 
    AND client_users.client_id = leads.client_id
  )
  AND leads.qualification IN ('preMQL', 'MQL', 'meeting_scheduled', 'meeting_held', 'offer_sent', 'won')
);

-- 3. Клієнти бачать історію листування тільки для тих лідів, до яких у них є доступ
CREATE POLICY "clients_see_replies_of_qualified_leads" ON lead_replies
FOR SELECT USING (
  EXISTS (SELECT 1 FROM leads WHERE leads.id = lead_replies.lead_id)
);


4. Функціональні тригери та взаємодії (Event-Driven Flow)
Сучасна платформа мінімізує втручання людини в технічні процеси. Нижче описана архітектура потоків даних (Data Pipelines) з акцентом на відмовостійкість.
Вхідні Webhooks (Bison/Smartlead -> Make.com -> Supabase): * Секвенсер надсилає webhook про нову відповідь.
Make.com викликає OpenAI для аналізу інтенту. Якщо OpenAI повертає помилку 500 або таймаут, скрипт має вбудований механізм повторів (Exponential Backoff Retry). Якщо всі спроби провалено, запис зберігається з тегом unclassified, щоб CS-менеджер опрацював його вручну.
Виконується транзакційний INSERT у lead_replies. БД-тригер (PostgreSQL Trigger) миттєво оновлює кешовані поля replied_at_step та total_replies_count у батьківській таблиці leads.
Щоденний Скрапінг (Nightly Cron Job о 00:01): * Edge Function ініціює збір макростатистики. Щоб уникнути обмежень частоти запитів (Rate Limiting) зі сторони API секвенсерів, скрипт розбиває запити на батчі (batch processing) з паузами між викликами.
Отримані абсолютні показники (Sent, Replies, Bounces) записуються в client_daily_snapshots та campaign_daily_stats з використанням логіки UPSERT (щоб уникнути дублювання при випадковому подвійному запуску скрипта).
Обробка автовідповідачів OOO (Morning Cron Job): * Щоранку система перевіряє таблицю leads, де is_ooo = true та дата expected_return_date <= CURRENT_DATE.
Знаходить відповідну campaign_id через client_ooo_routing (враховуючи gender ліда).
Відправляє POST-запит до Bison/Smartlead для додавання контакту в кампанію. У разі успіху знімає прапорець is_ooo.
CRM Синхронізація (Real-time DB Trigger): * Коли клієнт або CS-менеджер змінює qualification на MQL, база даних генерує подію NOTIFY.
Edge Function перехоплює подію, розшифровує crm_credentials клієнта (наприклад, токени Pipedrive) і створює нову Deal (Угоду), прив'язуючи історію листування у вигляді нотатки до угоди.
5. UI/UX Blueprint: Глибока деталізація інтерфейсів
Дизайн-система базується на бібліотеці shadcn/ui, яка забезпечує повну сумісність з Web Accessibility Guidelines (WCAG 2.1) — керування з клавіатури, підтримка скрінрідерів та правильний контраст кольорів.
Використовується два кардинально різних патерни подачі інформації: High-Density UI (максимальна щільність даних на піксель, дрібні шрифти, мінімум відступів) для внутрішньої команди та Low-Cognitive Load (великі відступи, візуальні акценти, прості графіки) для клієнтів. Підтримується нативна темна/світла тема (Dark/Light mode).
5.1. Client Portal (Портал Клієнта)
Адаптивний дизайн: портал повноцінно працює як на Desktop, так і на Mobile-пристроях (важливо для CEO, які перевіряють лідів з телефону).
Dashboard (Аналітична Панель): * 4 макропоказники (MQLs, Meetings, Won, Sent Volume) у верхній секції. Кожен містить "Дельта-бедж" (порівняння % з попереднім періодом) та міні-графік тренду (Sparkline).
Воронка конверсії (Funnel Chart), що ілюструє проходження ліда через всі стадії.
Комбінований графік "Velocity Chart" з двома осями Y (Dual Y-axis): стовпці показують обсяг відправлених листів, лінія показує кількість згенерованих MQL.
Leads Workspace (Робочий простір Data Grid): * Таблиця TanStack Table з серверною віртуалізацією.
Інтерактивні фільтри: вибір діапазону дат, мульти-селект по кампаніях та беджах кваліфікації.
Inline-перемикачі етапів воронки (Meeting, Offer, Won) з використанням "оптимістичного оновлення" (UI змінюється миттєво, не чекаючи відповіді від сервера).
Detail Drawer (Панель деталей ліда): * Бічна панель, що плавно виїжджає при кліку на рядок (Slide-over).
Містить: повну хронологію комунікації в стилі чату, індикатор sequence_step (візуалізація: "Відповів на Follow-up #2"), висновок AI (ARM Reasoning) та інтерактивні лінки на LinkedIn.
5.2. Admin & CS Portal (Внутрішній Портал)
Десктоп-орієнтований інтерфейс з підтримкою глобальних комбінацій клавіш (наприклад, Ctrl+K для швидкого переходу між клієнтами).
PDCA Matrix (Центр управління польотами): * Складна таблиця високої щільності з замороженими першими колонками (Frozen Columns).
Розділена на вкладки (DoD, WoW, MoM, Health).
Використовує алгоритм Smart Heatmap для управління увагою: комірки підсвічуються яскраво-червоним фоном ТІЛЬКИ у разі критичних відхилень (наприклад, якщо Bounce Rate > 3%, або кількість відправок впала нижче KPI). Відсутність кольору означає, що все йде за планом.
Client 360 (Панорама Клієнта): * Робочий простір конкретного клієнта. Включає вкладку Leads Processing, що дозволяє CS-менеджеру виділяти десятки лідів чекбоксами (Bulk Actions) і масово переводити їх у статус "Відмова" чи "OOO".
Вкладка 2Wo2W Health містить візуальний таймлайн аудитів з індикаторами-"світлофорами" для стану доменів, IP, та текстів.
Agency CRM: * Внутрішня Kanban-дошка продажів агенції з підтримкою drag-and-drop карток між стадіями (New, Contacted, Negotiation, Won).
6. Користувацькі історії (User Stories & Acceptance Criteria)
6.1. Клієнт (Client)
US-C1: Фільтрація релевантності
Story: Як Клієнт, я хочу бачити на головному екрані лише релевантних лідів (MQL/preMQL), щоб не марнувати час на читання автовідповідачів (OOO) або негативних відмов.
AC: RLS політика clients_see_only_qualified_leads жорстко блокує інше технічне "сміття" на рівні бази даних. У UI відсутня навіть можливість переглянути статус "unqualified".
US-C2: Блискавичне оновлення статусу воронки
Story: Як Клієнт, я хочу мати можливість в один клік оновити статус ліда (наприклад, "зустріч проведена"), щоб агенція бачила мою воронку продажів у реальному часі.
AC: Наявність Inline-кнопок статусів у таблиці. Використання оптимістичного оновлення (Optimistic UI) для миттєвої реакції інтерфейсу. Зміна статусу ліда автоматично перераховує загальну конверсію на Dashboard.
US-C3: Експорт даних
Story: Як Клієнт, я хочу завантажувати історію своїх закритих угод у форматі CSV для подальшого аналізу у внутрішньому BI-інструменті.
AC: Кнопка "Export", яка генерує CSV файл, що враховує поточні активні фільтри на таблиці та застосоване сортування колонок.
6.2. CS Manager (Customer Success)
US-CS1: Аналіз ефективності текстів (Copy Health)
Story: Як CS-менеджер, я хочу швидко визначати проблемні кампанії, де ліди довго не реагують або реагують лише на фінальні дотиснення (break-up emails).
AC: У колонці "Message #" таблиці Leads Processing чітко відображається поле replied_at_step (наприклад, "Крок 3"). Існує можливість відфільтрувати лідів за цим параметром.
US-CS2: Виявлення щоденних аномалій інфраструктури
Story: Як CS-менеджер, я хочу вранці бачити кольорову теплову карту відхилень обсягів (DoD) по всіх моїх клієнтах на єдиному екрані.
AC: PDCA DoD матриця динамічно підсвічує комірки червоним кольором, якщо поле emails_sent_total за вчорашній день є меншим за поріг min_sent_daily.
US-CS3: Прозорість логіки ШІ
Story: Як CS-менеджер, я хочу розуміти, чому штучний інтелект класифікував конкретну відповідь як MQL, щоб переконатися в адекватності його роботи.
AC: У панелі деталей ліда (Drawer) відображається блок ai_reasoning (текстове логічне пояснення від моделі) та відсоток впевненості ai_confidence.
US-CS4: Масові дії (Bulk Operations)
Story: Як CS-менеджер, я хочу опрацювати 50 листів-відмов за 2 кліки, щоб не відкривати профіль кожного ліда окремо.
AC: Можливість мульти-виділення рядків у таблиці (через Shift+Click) та наявність масової кнопки "Mark as Rejected" над таблицею.
6.3. Admin / Super Admin
US-A1: Глобальний фінансовий контроль
Story: Як Адміністратор, я хочу мати загальну таблицю Cash Flow, яка виглядає та працює як Excel-спредшит, для швидкого фінансового планування бюджету.
AC: Реалізація Editable Data Grid (сітки з можливістю редагування), яка зберігає дані безпосередньо у таблицю cash_flow_projections при втраті фокусу (onBlur) на комірці.
US-A2: Предиктивний аналіз відтоку (Churn Risk)
Story: Як Адміністратор, я хочу відстежувати "Клієнтів у зоні ризику", щоб своєчасно втрутитися та запобігти скасуванню контракту.
AC: Віджет на головному Dashboard автоматично виводить список клієнтів, у яких 2 останні Health Assessments мають статус "Red", або показник mql_diff відстає від місячного kpi_leads більше ніж на 40%.
US-A3: Режим імітації клієнта (Impersonation Mode)
Story: Як Адміністратор, при отриманні тікета в саппорт, я хочу увійти в систему від імені конкретного клієнта, щоб побачити інтерфейс його очима.
AC: У профілі клієнта доступна кнопка "Impersonate", яка тимчасово підміняє JWT токен сесії (без знання пароля клієнта), застосовуючи відповідні політики RLS.