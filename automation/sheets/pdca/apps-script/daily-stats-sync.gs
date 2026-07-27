/**
 * GHEADS | PDCA — Apps Script bound to the master workbook.
 *
 * Reads `CS PDCA` (one row per client, column F = that client's Bison API key), calls Bison per
 * client, and writes one row per (client, date, "Bizon") into `🤖Daily stats`.
 *
 * This is the *sheet-side twin* of the n8n worker
 * `automation/n8n/workflows/ingestion/bison-daily-stats-process`. Both call the same Bison
 * endpoints on the same schedule and neither reads the other (ADR-0017 phase A). Committed here
 * as the canonical copy of what actually runs — see ../FORMULAS.md for the column map and the
 * defect table.
 *
 * VERBATIM. Do not "improve" this file: it documents production as it is, not as it should be.
 * A fix belongs in the Apps Script editor first, then re-pasted here.
 */

// ==================== КОНФІГУРАЦІЯ ====================
const TZ = Session.getScriptTimeZone();
const COL = {
  A: 0,  // clientId
  B: 1,  // Sent
  F: 5,  // Replied
  G: 6,  // Bounced
  I: 8,  // Date
  J: 9,  // Sender Emails count
  K: 10, // Leads count
  S: 18, // Sequencer
  U: 20, // Automated replies count
  V: 21, // Daily difference (NEW)
  W: 22,  // Human replies count
  X: 23, // Out of Office
  Y: 24,  // Schedule volume for Today
  Z: 25,   // Schedule volume for ToMORROW
  AA: 26 // Schedule volume for day after tomorrow
};

// ==================== РУЧНИЙ ЗАПУСК ====================

/**
 * ЗАПУСТИ ЦЮ ФУНКЦІЮ ДЛЯ КОНКРЕТНОЇ ДАТИ
 * Формат: "yyyy-MM-dd"
 */
function runForSpecificDate() {
  const TARGET_DATE = "2026-07-09"; // <--- ЗМІНИ ДАТУ ТУТ
  console.log(`Manual run initiated for: ${TARGET_DATE}`);
  processBisonRowsAndFetchStats(TARGET_DATE);
}

// ==================== ДОПОМІЖНІ ФУНКЦІЇ ====================
function normalizeDateCell_(val) {
  if (val instanceof Date) return Utilities.formatDate(val, TZ, "yyyy-MM-dd");
  return String(val || "").trim();
}

// ==================== API ФУНКЦІЇ ====================
function fetchSenderEmailCount(apiKey) {
  const url = "https://go.gheads.com/api/sender-emails";
  const options = {
    method: "get",
    headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
    muteHttpExceptions: true
  };
  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200) return null;
    return JSON.parse(response.getContentText()).meta?.total || 0;
  } catch (e) {
    Logger.log(`fetchSenderEmailCount failed: ${e.message}`);
    return null;
  }
}

function fetchAutomatedRepliesCount(apiKey) {
  const url = "https://go.gheads.com/api/replies?status=automated_reply&folder=inbox";
  const options = {
    method: "get",
    headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
    muteHttpExceptions: true
  };
  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200) return null;
    return JSON.parse(response.getContentText()).meta?.total || 0;
  } catch (e) {
    Logger.log(`fetchAutomatedRepliesCount failed: ${e.message}`);
    return null;
  }
}

function fetchScheduleVolumeByDay(apiKey, day) {
  // day: "today" | "tomorrow" | "day_after_tomorrow"
  // WARNING: API returns data relative to execution time, not target date
  const url = `https://go.gheads.com/api/campaigns/sending-schedules?day=${encodeURIComponent(day)}`;
  const options = {
    method: "get",
    headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
    muteHttpExceptions: true
  };
  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200) return 0;
    const data = JSON.parse(response.getContentText());
    return (Array.isArray(data.data) ? data.data : []).reduce((sum, item) => sum + (Number(item.emails_being_sent) || 0), 0);
  } catch (e) {
    return 0;
  }
}

function fetchScheduleVolumes(apiKey) {
  return {
    today: fetchScheduleVolumeByDay(apiKey, "today"),
    tomorrow: fetchScheduleVolumeByDay(apiKey, "tomorrow"),
    dayAfterTomorrow: fetchScheduleVolumeByDay(apiKey, "day_after_tomorrow")
  };
}

// UPDATED: Accepts referenceDate to calculate first day of month correctly
function fetchLeadCount(apiKey, referenceDate) {
  const firstDayOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const firstDayOfMonthStr = Utilities.formatDate(firstDayOfMonth, TZ, "yyyy-MM-dd");
  const criteria = encodeURIComponent(">=");
  const url = `https://go.gheads.com/api/leads?filters[created_at][criteria]=${criteria}&filters[created_at][value]=${firstDayOfMonthStr}`;

  const options = {
    method: "get",
    headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200) return null;
    return JSON.parse(response.getContentText()).meta?.total || 0;
  } catch (e) {
    return null;
  }
}

// UPDATED: Accepts targetDateStr to fetch stats for specific day
function fetchTodayStats(apiKey, targetDateStr) {
  const baseUrl = "https://go.gheads.com/api/workspaces/v1.1/line-area-chart-stats";
  const bounceBaseUrl = "https://go.gheads.com/api/workspaces/v1.1/stats";

  const url = `${baseUrl}?start_date=${targetDateStr}&end_date=${targetDateStr}`;
  const bounceUrl = `${bounceBaseUrl}?start_date=${targetDateStr}&end_date=${targetDateStr}`;

  const options = {
    method: "get",
    headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const bounceResponse = UrlFetchApp.fetch(bounceUrl, options);

    if (response.getResponseCode() !== 200 || bounceResponse.getResponseCode() !== 200) return null;

    const data = JSON.parse(response.getContentText());
    const bounceData = JSON.parse(bounceResponse.getContentText());
    const result = {};

    for (const item of data.data) {
      const label = item.label;
      // API usually returns dates in YYYY-MM-DD
      const valueForToday = item.dates.find(datePair => datePair[0] === targetDateStr);
      result[label] = valueForToday ? valueForToday[1] : 0;
    }
    result['Bounced'] = bounceData.data.bounced;
    return result;
  } catch (e) {
    return null;
  }
}

function fetchHumanRepliesCount(apiKey) {
  const url = "https://go.gheads.com/api/replies?status=not_automated_reply&folder=inbox";
  const options = {
    method: "get",
    headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
    muteHttpExceptions: true
  };
  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200) return null;
    return JSON.parse(response.getContentText()).meta?.total || 0;
  } catch (e) {
    return null;
  }
}

// ==================== ГОЛОВНА ФУНКЦІЯ ОБРОБКИ ====================
// UPDATED: Accepts optional targetDateInput
function processBisonRowsAndFetchStats(targetDateInput) {
  const sourceSheetName = "CS PDCA";
  const targetSheetName = "🤖Daily stats";

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName(sourceSheetName);
  const targetSheet = ss.getSheetByName(targetSheetName);

  if (!sourceSheet || !targetSheet) {
    Logger.log(`Sheet "${sourceSheetName}" or "${targetSheetName}" doesnt exist.`);
    return;
  }

  // DATE LOGIC SETUP
  let today;
  if (targetDateInput) {
    // If input is "2026-01-13", we construct date. Time set to noon to avoid TZ shift issues
    today = new Date(targetDateInput + "T12:00:00");
  } else {
    today = new Date();
  }

  const todayStr = Utilities.formatDate(today, TZ, "yyyy-MM-dd");

  // Розрахунок дати попереднього дня
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = Utilities.formatDate(yesterday, TZ, "yyyy-MM-dd");

  Logger.log(`Running Script for Date: ${todayStr} (Previous Day: ${yesterdayStr})`);

  const data = sourceSheet.getDataRange().getValues();
  const targetValues = targetSheet.getDataRange().getValues();
  const headerOffset = 1;

  // Cache existing rows for lookup
  const existingKeyToRowIndex = {};
  for (let i = 1; i < targetValues.length; i++) {
    const r = targetValues[i];
    const a = String(r[COL.A] || "").trim();
    const dateStr = normalizeDateCell_(r[COL.I]);
    const seq = String(r[COL.S] || "").trim();
    if (!a || !dateStr || !seq) continue;
    const key = `${a}__${dateStr}__${seq}`;
    existingKeyToRowIndex[key] = i + 1;
  }

  // Обробляємо активні рядки
  for (let i = headerOffset; i < data.length; i++) {
    const row = data[i];
    const colE = row[4];  // Client ID
    const colF = row[5];  // API Key
    const colG = row[6];  // Status

    if (colG === "Active" && colF !== "") {
      const apiKey = colF;
      Logger.log(`\n--- Processing client: ${colE} ---`);

      // UPDATED: Passing today object/string where necessary
      const senderCount = fetchSenderEmailCount(apiKey); // Snapshot (current total)
      const leadCount = fetchLeadCount(apiKey, today); // Calculated relative to 'today'
      const todayStats = fetchTodayStats(apiKey, todayStr); // Fetched for specific date

      const humanRepliesCount = fetchHumanRepliesCount(apiKey) || 0; // Snapshot (current total)
      const automatedRepliesCount = fetchAutomatedRepliesCount(apiKey) || 0; // Snapshot (current total)

      const schedules = fetchScheduleVolumes(apiKey); // Snapshot (current schedule)
      const scheduleToday = schedules.today || 0;
      const scheduleTomorrow = schedules.tomorrow || 0;
      const scheduleDayAfterTomorrow = schedules.dayAfterTomorrow || 0;

      const sentValue = todayStats?.Sent ?? 0;
      const repliedValue = todayStats?.Replied ?? 0;
      const bouncedValue = todayStats?.Bounced ?? 0;

      // Logic for calculating difference from PREVIOUS day
      const yesterdayKey = `${colE}__${yesterdayStr}__Bizon`;
      const previousDayRowIndex = existingKeyToRowIndex[yesterdayKey];

      let dailyUDifference = "";
      let dailyWDifference = "";

      if (previousDayRowIndex) {
        const previousDayWValue = targetSheet.getRange(previousDayRowIndex, COL.W + 1).getValue();
        const previousDayUValue = targetSheet.getRange(previousDayRowIndex, COL.U + 1).getValue();

        if (previousDayWValue !== null && previousDayWValue !== "") {
          dailyWDifference = humanRepliesCount - Number(previousDayWValue);
        } else {
          dailyWDifference = humanRepliesCount;
        }

        if (previousDayUValue !== null && previousDayUValue !== "") {
          dailyUDifference = automatedRepliesCount - Number(previousDayUValue);
        } else {
          dailyUDifference = automatedRepliesCount;
        }
      } else {
        // Fallback if no yesterday data
        dailyUDifference = automatedRepliesCount;
        dailyWDifference = humanRepliesCount;
      }

      // Construct New Row
      const newRow = new Array(27).fill("");
      newRow[COL.A] = colE;
      newRow[COL.B] = sentValue;
      newRow[COL.F] = repliedValue;
      newRow[COL.G] = bouncedValue;
      newRow[COL.I] = todayStr;
      newRow[COL.J] = senderCount;
      newRow[COL.K] = leadCount;
      newRow[COL.S] = "Bizon";
      newRow[COL.U] = automatedRepliesCount;
      newRow[COL.V] = dailyWDifference < 0 ? 0 : dailyWDifference;
      newRow[COL.W] = humanRepliesCount;
      newRow[COL.X] = dailyUDifference < 0 ? 0 : dailyUDifference;
      newRow[COL.Y] = scheduleToday;
      newRow[COL.Z] = scheduleTomorrow;
      newRow[COL.AA]= scheduleDayAfterTomorrow;

      const lookupKey = `${colE}__${todayStr}__Bizon`;

      if (existingKeyToRowIndex[lookupKey]) {
        const rowToOverwrite = existingKeyToRowIndex[lookupKey];
        targetSheet.getRange(rowToOverwrite, 1, 1, newRow.length).setValues([newRow]);
      } else {
        targetSheet.appendRow(newRow);
      }
    }
  }
  Logger.log("\n=== Processing completed ===");
}
