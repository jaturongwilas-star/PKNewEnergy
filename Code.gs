// ╔══════════════════════════════════════════════════════════════╗
// ║  EV GARAGE MANAGEMENT SYSTEM — Google Apps Script Backend    ║
// ║  v3.3 — Bug Fixes (QC/Appt persistence, server-side OCR) +   ║
// ║         AI Intent Detection (Gemini) for LINE Bot           ║
// ╚══════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════
const SPREADSHEET_ID     = "1iGVAgzQbPSb62ra1syZVRhYqxdbJfGr1TJ8_FgB6VkY";
const LINE_CHANNEL_TOKEN = "DXEiJgGqaXuEto6xQ8VSYf1Ez40SzuGqWEXXIxH7DVZWitGmIL3EnbwXaOetEmVABI4POaJR+7hUb+SsrPTdnXQff1dj8aG0JlniSyFjCXTrXSwyt6rz/NW61yAckU23PMYiDv63jfCZUAR6fCkFVQdB04t89/1O/w1cDnyilFU=";
const LINE_NOTIFY_TOKEN  = "";   // ← ใส่ LINE Notify Token เพื่อรับแจ้งเตือน Admin
const VISION_API_KEY     = "AIzaSyDKoucAFd6CVQV8k0_vZPF6S4kvntw6YTM";

// ── Admin LINE User ID สำหรับ push message แจ้ง Admin โดยตรง ──
// ใส่ LINE userId ของ Admin (ดูได้จาก event.source.userId ที่ Admin แชท)
const ADMIN_LINE_USER_ID = "";   // ← เช่น "Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

// ── v3.3: Gemini AI Intent Detection (LINE Bot) ──────────────────
// ห้ามฮาร์ดโค้ด API key ในไฟล์นี้ — ไปตั้งค่าที่
//   Project Settings → Script Properties → "GEMINI_API_KEY"
// ถ้าไม่ตั้งค่า ระบบจะ fallback ไปใช้ regex parser เดิมทั้งหมด (ไม่กระทบของเดิม)
const GEMINI_MODEL = "gemini-2.0-flash";

// Sheet names
const SHEET_JOBS         = "งานซ่อม";
const SHEET_CUSTOMERS    = "ลูกค้า";
const SHEET_INVENTORY    = "คลังอะไหล่";
const SHEET_SLIPS        = "สลิปโอนเงิน";
const SHEET_REVENUE      = "รายได้รายวัน";
const SHEET_APPOINTMENTS = "นัดหมาย";
const SHEET_LEADS        = "ลูกค้าเป้าหมาย";  // v3.3: ใหม่ — เก็บ Lead จาก LINE Bot

// Reply templates
const REPLY_SLIP_SUCCESS   = "✅ รับสลิปแล้วครับ!\n━━━━━━━━━━━━━━━\n💰 ยอด: {amount} บาท\n🏦 ธนาคาร: {bank}\n📅 วันที่: {date} {time}\n👤 ผู้โอน: {sender}\n🔖 เลขอ้างอิง: {ref}\n━━━━━━━━━━━━━━━\nขอบคุณครับ 🙏";
const REPLY_SLIP_DUPLICATE = "⚠️ สลิปนี้เคยส่งมาแล้วครับ\nกรุณาตรวจสอบอีกครั้ง";
const REPLY_SLIP_FAILED    = "❌ ไม่สามารถอ่านสลิปได้ครับ\nกรุณาส่งรูปที่ชัดเจนขึ้น หรือตรวจสอบว่าเป็นสลิปโอนเงินจริง";
const REPLY_NOT_IMAGE      = "📷 กรุณาส่งรูปภาพสลิปการโอนเงินครับ";

// ═══════════════════════════════════════════════════════════════
//  DO GET
// ═══════════════════════════════════════════════════════════════
function doGet(e) {
  try { initSheets(); } catch (_) {}
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "";
  try {
    if (action === "ping")               return json({ status: "ok", message: "API ready", version: "3.3" });
    if (action === "getJobs")            return json({ status: "ok", jobs: getSheetData(SHEET_JOBS) });
    if (action === "getCustomers")       return json({ status: "ok", customers: getSheetData(SHEET_CUSTOMERS) });
    if (action === "getInventory")       return json({ status: "ok", inventory: getSheetData(SHEET_INVENTORY) });
    if (action === "getDashboard")       return json({ status: "ok", summary: getDashboardSummary() });
    if (action === "getSlips")           return json({ status: "ok", slips: getSheetData(SHEET_SLIPS) });
    if (action === "getRevenue")         return json({ status: "ok", revenue: getRevenueData() });
    if (action === "getAppointments")    return json({ status: "ok", appointments: getAppointments(e.parameter) });
    // ── v3.2: นับนัดที่รออนุมัติ (สำหรับ badge บน frontend) ──
    if (action === "getPendingCount")    return json({ status: "ok", count: getPendingLineCount() });
    // ── v3.3: Lead จาก AI Intent Detection ──
    if (action === "getLeads")           return json({ status: "ok", leads: getSheetData(SHEET_LEADS) });
    return json({ status: "error", message: "Unknown action: " + action });
  } catch (err) {
    return json({ status: "error", message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
//  DO POST
// ═══════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ status: "ok", message: "no body" });
    }
    var body;
    try { body = JSON.parse(e.postData.contents); }
    catch (_) { return json({ status: "ok", message: "invalid json" }); }

    // ── LINE Webhook ─────────────────────────────────────────
    if (body.destination !== undefined || Array.isArray(body.events)) {
      try { initSheets(); } catch (_) {}
      var events = Array.isArray(body.events) ? body.events : [];
      try { handleLineWebhook(events); } catch (lineErr) { Logger.log("LINE webhook error: " + lineErr.message); }
      return json({ status: "ok" });
    }

    // ── Dashboard API ─────────────────────────────────────────
    try { initSheets(); } catch (_) {}
    var action = body.action;

    // Bug fix v3.2.1: validate required fields before writing rows
    if (action === "createJob") {
      if (!body.customerName || !String(body.customerName).trim()) {
        return json({ status: "error", message: "customerName is required" });
      }
      var jobId = createJob(body);
      return json({ status: "ok", jobId: jobId });
    }
    // Bug fix v3.2.1: surface "jobId not found" instead of always {status:"ok"}
    if (action === "updateJobStatus") {
      var ujsOk = updateJobStatus(body);
      if (!ujsOk) return json({ status: "error", message: "ไม่พบใบงาน jobId=" + body.jobId });
      return json({ status: "ok" });
    }
    if (action === "updateInventory")    { updateInventory(body); return json({ status: "ok" }); }
    if (action === "deleteSlip")         { deleteSlip(body.refId); return json({ status: "ok" }); }
    // Bug fix v3.2.1: validate required fields before writing rows
    if (action === "createAppointment") {
      if (!body.name || !String(body.name).trim()) {
        return json({ status: "error", message: "name is required" });
      }
      var apptId = createAppointment(body);
      return json({ status: "ok", id: apptId });
    }
    if (action === "updateAppointment")  { updateAppointment(body); return json({ status: "ok" }); }
    if (action === "deleteAppointment")  { deleteAppointment(body.id); return json({ status: "ok" }); }
    if (action === "updateJob")          { updateJobFields(body); return json({ status: "ok" }); }

    // ── v3.2.2: OCR Slip via Claude — server-side so API key stays secret ──
    if (action === "ocrSlip")            { return json(ocrSlipWithClaude(body.image, body.mediaType)); }

    // ── v3.2: สร้างใบงานจากนัดหมาย (Bug #4 fix) ──────────────
    if (action === "createJobFromAppt")  {
      var result = createJobFromAppointment(body);
      return json({ status: "ok", jobId: result.jobId, apptUpdated: result.apptUpdated });
    }

    return json({ status: "error", message: "Unknown action: " + action });
  } catch (err) {
    Logger.log("doPost top-level error: " + err.message);
    return json({ status: "error", message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
//  v3.2: createJobFromAppointment — Bug #4 Fix
//  สร้าง Job โดยตรงจาก Appointment ID พร้อม update status นัด
// ═══════════════════════════════════════════════════════════════
function createJobFromAppointment(data) {
  var apptId = data.apptId;
  if (!apptId) throw new Error("apptId required");

  // ดึงข้อมูลนัดหมาย
  var appts = getAppointments({});
  var appt  = null;
  for (var i = 0; i < appts.length; i++) {
    if (appts[i].id === apptId) { appt = appts[i]; break; }
  }
  if (!appt) throw new Error("ไม่พบนัดหมาย id=" + apptId);

  // แปลง car → carBrand + carModel (fuzzy split)
  var carStr   = String(appt.car || "").trim();
  var carBrand = data.carBrand || "";
  var carModel = data.carModel || "";
  if (!carBrand && carStr) {
    var knownBrands = ["BYD","MG","Tesla","Neta","ORA","Great Wall","GWM","Changan","Chery","Aion","Zeekr","GAC","Volvo","BMW","Mercedes","Hyundai","Kia","Nissan","Toyota","Honda","Ford","Chevrolet","อื่นๆ"];
    for (var b = 0; b < knownBrands.length; b++) {
      if (carStr.toLowerCase().indexOf(knownBrands[b].toLowerCase()) === 0) {
        carBrand = knownBrands[b];
        carModel = carStr.slice(knownBrands[b].length).trim() || carStr;
        break;
      }
    }
    if (!carBrand) { carBrand = "อื่นๆ"; carModel = carStr; }
  }

  // สร้าง Job
  var jobData = {
    customerName:   appt.name  || "",
    customerPhone:  appt.phone || "",
    carBrand:       carBrand,
    carModel:       carModel || carStr,
    carPlate:       appt.plate || data.carPlate || "",
    repairType:     appt.type  || "ตรวจเช็คทั่วไป",
    repairNotes:    (appt.notes ? appt.notes + "\n" : "") + "สร้างจากนัดหมาย: " + apptId + (appt.source === "line" ? " (LINE)" : ""),
    appointmentDate: appt.date || "",
    estimatedPrice: data.estimatedPrice || 0,
    createdBy:      data.createdBy || "system",
    userId:         appt.createdBy || ""
  };
  var jobId = createJob(jobData);

  // Update appointment status → เสร็จสิ้น + link jobId
  updateAppointment({
    id:     apptId,
    status: "เสร็จสิ้น",
    notes:  (appt.notes || "") + " | สร้างใบงาน: " + jobId
  });

  Logger.log("createJobFromAppointment: appt=" + apptId + " → job=" + jobId);
  return { jobId: jobId, apptUpdated: true };
}

// ═══════════════════════════════════════════════════════════════
//  v3.2: getPendingLineCount — นับนัด LINE ที่รออนุมัติ
// ═══════════════════════════════════════════════════════════════
function getPendingLineCount() {
  try {
    var appts = getAppointments({ source: "line", status: "รอยืนยัน" });
    return appts.length;
  } catch(_) { return 0; }
}

// ═══════════════════════════════════════════════════════════════
//  INIT SHEETS
// ═══════════════════════════════════════════════════════════════
function initSheets() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  if (!ss.getSheetByName(SHEET_JOBS)) {
    var s = ss.insertSheet(SHEET_JOBS);
    s.appendRow(["Job ID","วันที่สร้าง","userId","ชื่อลูกค้า","เบอร์โทร","ยี่ห้อรถ","รุ่นรถ","ทะเบียน","รายการซ่อม / ปัญหา","ราคาประเมิน (฿)","ชั่วโมงประเมิน","หมายเหตุ","วันนัดหมาย","สถานะ","ราคาจริง (฿)","วันเสร็จ"]);
    s.getRange(1,1,1,16).setFontWeight("bold").setBackground("#1D9E75").setFontColor("#FFFFFF");
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEET_CUSTOMERS)) {
    var s2 = ss.insertSheet(SHEET_CUSTOMERS);
    s2.appendRow(["ชื่อลูกค้า","เบอร์โทร","ยี่ห้อรถ","รุ่นรถ","ทะเบียน","จำนวนครั้งที่ใช้บริการ","ครั้งล่าสุด"]);
    s2.getRange(1,1,1,7).setFontWeight("bold").setBackground("#378ADD").setFontColor("#FFFFFF");
    s2.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEET_INVENTORY)) {
    var s3 = ss.insertSheet(SHEET_INVENTORY);
    s3.appendRow(["รหัสอะไหล่","ชื่ออะไหล่","หมวดหมู่","จำนวนคงเหลือ","จำนวนขั้นต่ำ","ราคาต่อชิ้น (฿)","อัปเดตล่าสุด"]);
    s3.getRange(1,1,1,7).setFontWeight("bold").setBackground("#F5A623").setFontColor("#FFFFFF");
    s3.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEET_SLIPS)) {
    var s4 = ss.insertSheet(SHEET_SLIPS);
    s4.appendRow(["Timestamp","วันที่สลิป","เวลา","เลขอ้างอิง","จำนวนเงิน (บาท)","ธนาคาร","ผู้โอน","ผู้รับ","LINE User ID","Message ID","URL รูปสลิป","OCR Raw Text"]);
    s4.getRange(1,1,1,12).setFontWeight("bold").setBackground("#6C5CE7").setFontColor("#FFFFFF");
    s4.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEET_REVENUE)) {
    var s5 = ss.insertSheet(SHEET_REVENUE);
    s5.appendRow(["วันที่","จำนวนสลิป","รายได้จากสลิป (฿)","รายได้จากงานซ่อม (฿)","รายได้รวม (฿)","อัปเดตล่าสุด"]);
    s5.getRange(1,1,1,6).setFontWeight("bold").setBackground("#00B894").setFontColor("#FFFFFF");
    s5.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEET_APPOINTMENTS)) {
    var s6 = ss.insertSheet(SHEET_APPOINTMENTS);
    s6.appendRow(["id","name","phone","date","time","car","plate","type","notes","status","source","createdAt","createdBy","updatedAt"]);
    s6.getRange(1,1,1,14).setFontWeight("bold").setBackground("#E84393").setFontColor("#FFFFFF");
    s6.setFrozenRows(1);
    s6.setColumnWidth(1, 140);
    s6.setColumnWidth(2, 140);
    s6.setColumnWidth(4, 100);
  }
  // v3.3: Lead sheet สำหรับ AI Intent "create_lead" (เช่น "อยากเปลี่ยนแบตเตอรี่")
  if (!ss.getSheetByName(SHEET_LEADS)) {
    var s7 = ss.insertSheet(SHEET_LEADS);
    s7.appendRow(["id","name","phone","interest","notes","source","status","createdAt"]);
    s7.getRange(1,1,1,8).setFontWeight("bold").setBackground("#9B59B6").setFontColor("#FFFFFF");
    s7.setFrozenRows(1);
  }
}

// ═══════════════════════════════════════════════════════════════
//  APPOINTMENTS CRUD
// ═══════════════════════════════════════════════════════════════
function getAppointments(params) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_APPOINTMENTS);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var rows = data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i] instanceof Date ? row[i].toISOString() : row[i]; });
    return obj;
  });
  if (params && params.date)   rows = rows.filter(function(r){ return String(r.date).substring(0,10) === params.date; });
  if (params && params.month)  rows = rows.filter(function(r){ return String(r.date).substring(0,7) === params.month; });
  if (params && params.status) rows = rows.filter(function(r){ return r.status === params.status; });
  if (params && params.source) rows = rows.filter(function(r){ return r.source === params.source; });
  rows.sort(function(a,b){ return (String(a.date)+String(a.time)).localeCompare(String(b.date)+String(b.time)); });
  return rows;
}

function createAppointment(data) {
  // Bug fix v3.2.1: serialize ID generation + appendRow to avoid duplicate
  // "APT-<timestamp>" IDs when two requests land in the same millisecond.
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var id;
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_APPOINTMENTS);
    if (!sheet) { initSheets(); sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_APPOINTMENTS); }
    id  = "APT-" + new Date().getTime();
    var now = new Date();
    sheet.appendRow([id, data.name||"", data.phone||"", data.date||"", data.time||"", data.car||"", data.plate||"", data.type||"ตรวจเช็คทั่วไป", data.notes||"", data.status||"รอยืนยัน", data.source||"manual", now, data.createdBy||"system", now]);
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 12).setNumberFormat("yyyy-MM-dd HH:mm:ss");
    sheet.getRange(lastRow, 14).setNumberFormat("yyyy-MM-dd HH:mm:ss");
  } finally {
    lock.releaseLock();
  }

  // ── v3.2: Push แจ้ง Admin ทันทีเมื่อมีนัดจาก LINE ──────────
  if (data.source === "line") {
    var msg = "📅 นัดหมายใหม่จาก LINE!\n" +
              "👤 " + (data.name  || "-") + "\n" +
              "📞 " + (data.phone || "-") + "\n" +
              "🗓 " + (data.date  || "-") + " " + (data.time || "") + "\n" +
              "🚗 " + (data.car   || "-") + "\n" +
              "🔧 " + (data.type  || "-") + "\n" +
              "━━━━━━━━━━━━━━━\n" +
              "⏳ รอการอนุมัติในระบบ\n" +
              "🔖 " + id;
    if (LINE_NOTIFY_TOKEN) { try { notifyLine(msg); } catch(_) {} }
    // Push ไปหา Admin โดยตรง (ถ้ามี ADMIN_LINE_USER_ID)
    if (ADMIN_LINE_USER_ID) { try { pushLine(ADMIN_LINE_USER_ID, msg); } catch(_) {} }
  }
  Logger.log("Appointment created: " + id + " | " + data.name + " | " + data.date);
  return id;
}

function updateAppointment(data) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_APPOINTMENTS);
  if (!sheet) return;
  var rows    = sheet.getDataRange().getValues();
  var headers = rows[0];
  var colIdx  = {};
  headers.forEach(function(h, i) { colIdx[h] = i + 1; });
  function getOrAddCol(name) {
    if (colIdx[name]) return colIdx[name];
    var newIdx = headers.length + 1;
    sheet.getRange(1, newIdx).setValue(name).setFontWeight("bold").setBackground("#E84393").setFontColor("#FFFFFF");
    headers.push(name);
    colIdx[name] = newIdx;
    return newIdx;
  }
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.id) {
      var rowNum = i + 1;
      var fields = ["name","phone","date","time","car","plate","type","notes","status","source"];
      fields.forEach(function(f) {
        if (data[f] !== undefined && colIdx[f]) sheet.getRange(rowNum, colIdx[f]).setValue(data[f]);
      });
      // Bug fix v3.2.2: confirmLA()/rejectLA() send confirmedAt/confirmedBy
      // (and any other extra fields) which previously had no column and were
      // silently discarded — dynamically add columns like updateJobFields().
      ["confirmedAt","confirmedBy"].forEach(function(f) {
        if (data[f] !== undefined && data[f] !== null) sheet.getRange(rowNum, getOrAddCol(f)).setValue(data[f]);
      });
      if (colIdx["updatedAt"]) sheet.getRange(rowNum, colIdx["updatedAt"]).setValue(new Date());
      if (data.status === "ยืนยันแล้ว" && rows[i][10] === "line") {
        var confirmMsg = "✅ อนุมัตินัดหมายแล้ว!\n👤 " + rows[i][1] + "\n📅 " + rows[i][3] + " " + rows[i][4];
        if (LINE_NOTIFY_TOKEN) { try { notifyLine(confirmMsg); } catch(_) {} }
        // แจ้งลูกค้ากลับผ่าน LINE (ถ้าเก็บ userId ไว้ใน createdBy)
        var custUserId = rows[i][12]; // createdBy = userId
        if (custUserId && custUserId.indexOf("U") === 0) {
          try { pushLine(custUserId, "✅ ทีมงาน P&K New Energy ยืนยันนัดหมายของคุณแล้วครับ!\n📅 " + rows[i][3] + " เวลา " + rows[i][4] + "\nขอบคุณครับ 🙏"); } catch(_) {}
        }
      }
      Logger.log("Appointment updated: " + data.id + " | status=" + (data.status || "unchanged"));
      return;
    }
  }
  throw new Error("ไม่พบนัดหมาย id=" + data.id);
}

function deleteAppointment(id) {
  if (!id) return;
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_APPOINTMENTS);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === id) { sheet.deleteRow(i + 1); Logger.log("Appointment deleted: " + id); return; }
  }
}

// ═══════════════════════════════════════════════════════════════
//  LINE WEBHOOK — v3.2: Flexible parser + plate field
// ═══════════════════════════════════════════════════════════════
function handleLineWebhook(events) {
  events.forEach(function(event) {
    try {
      if (event.type !== "message") return;
      if (!event.message || !event.replyToken) return;
      var userId = event.source ? (event.source.userId || "") : "";

      if (event.message.type === "image") { processSlipImage(event, userId); return; }
      if (event.message.type !== "text") return;
      var text = event.message.text.trim();

      // ── v3.3: AI Intent Detection (Gemini Function Calling) ──────────
      // เปิดใช้งานก็ต่อเมื่อมีการตั้งค่า GEMINI_API_KEY ใน Script Properties
      // หาก AI ตอบไม่ได้/ไม่มี key/error → fallback ไป regex parser เดิมด้านล่างทั้งหมด
      if (PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY")) {
        try {
          if (handleLineMessageAI(event, userId, text)) return;
        } catch (aiErr) {
          Logger.log("handleLineMessageAI error (fallback to regex): " + aiErr.message);
        }
      }

      // สร้างงานใหม่
      if (text.indexOf("ชื่อ:") !== -1 && text.indexOf("นัด:") === -1) {
        var jobData    = parseLineText(text);
        jobData.userId = userId;
        var jobId      = createJob(jobData);
        replyLine(event.replyToken,
          "✅ รับงานแล้วครับ!\n━━━━━━━━━━━━━━━\n" +
          "🔖 Job ID: " + jobId + "\n" +
          "👤 ลูกค้า: " + (jobData.customerName || "-") + "\n" +
          "🚗 รถ: " + (jobData.carModel || "-") + "\n" +
          "🔧 อาการ: " + (jobData.repairType || "-") + "\n" +
          "━━━━━━━━━━━━━━━\nส่ง 'ดูงาน' เพื่อตรวจสอบสถานะ"
        );
        return;
      }

      // ── v3.2: นัดหมายจาก LINE — flexible parser ──────────────
      if (text.indexOf("นัด") !== -1 || text.indexOf("จองคิว") !== -1 || text.indexOf("จอง") !== -1) {
        var apptData = parseLineAppointmentText(text);
        // validate ต้องมีชื่ออย่างน้อย
        if (!apptData.name) {
          replyLine(event.replyToken,
            "⚠️ ไม่พบชื่อในข้อความครับ\n\n" +
            "📌 กรุณาพิมพ์ตามรูปแบบนี้:\n" +
            "นัด: ชื่อ: สมชาย | วัน: 15/06/2568 | เวลา: 10:00 | รถ: BYD Atto 3 | โทร: 0812345678 | ทะเบียน: กข 1234\n\n" +
            "หรือแบบสั้น:\nนัด ชื่อสมชาย วัน15/6 เวลา10:00 รถBYD โทร0812345678"
          );
          return;
        }
        apptData.source    = "line";
        apptData.createdBy = userId;
        var apptId = createAppointment(apptData);
        replyLine(event.replyToken,
          "📅 รับนัดหมายแล้วครับ!\n━━━━━━━━━━━━━━━\n" +
          "🔖 ID: " + apptId + "\n" +
          "👤 " + (apptData.name  || "-") + "\n" +
          "📞 " + (apptData.phone || "-") + "\n" +
          "🗓 " + (apptData.date  || "-") + " เวลา " + (apptData.time || "-") + "\n" +
          "🚗 " + (apptData.car   || "-") + "\n" +
          (apptData.plate ? "🔖 ทะเบียน: " + apptData.plate + "\n" : "") +
          "━━━━━━━━━━━━━━━\n⏳ รอทีมงานยืนยันนัดครับ 🙏"
        );
        return;
      }

      // ดูนัดวันนี้
      if (text === "นัดวันนี้" || text === "ดูนัด") {
        var today     = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
        var todayApts = getAppointments({ date: today });
        if (!todayApts.length) { replyLine(event.replyToken, "📅 วันนี้ไม่มีนัดหมายครับ"); return; }
        var msg = "📅 นัดหมายวันนี้ (" + todayApts.length + " รายการ)\n━━━━━━━━━━━━━━━\n";
        todayApts.forEach(function(a) { msg += "⏰ " + a.time + " — " + a.name + "\n   🚗 " + (a.car||"-") + " | " + a.type + "\n   📊 " + a.status + "\n\n"; });
        replyLine(event.replyToken, msg.trim());
        return;
      }

      // ดูงาน
      if (text === "ดูงาน" || text === "งาน") {
        var jobs  = getSheetData(SHEET_JOBS);
        if (!jobs.length) { replyLine(event.replyToken, "ยังไม่มีงานในระบบครับ"); return; }
        var latest = jobs.slice(0, 5);
        var msg2   = "📋 งาน 5 รายการล่าสุด\n━━━━━━━━━━━━━━━\n";
        latest.forEach(function(j) { msg2 += "🔖 " + j["Job ID"] + "\n   👤 " + (j["ชื่อลูกค้า"]||"-") + " | " + (j["สถานะ"]||"-") + "\n\n"; });
        replyLine(event.replyToken, msg2.trim());
        return;
      }

      // รายได้
      if (text === "รายได้" || text === "รายได้วันนี้") {
        var rev = getTodayRevenueFromSlips();
        replyLine(event.replyToken,
          "💰 รายได้วันนี้\n━━━━━━━━━━━━━━━\n" +
          "📨 สลิปที่รับ: " + rev.count + " รายการ\n" +
          "💵 ยอดรวมจากสลิป: ฿" + rev.total.toLocaleString() + "\n" +
          "━━━━━━━━━━━━━━━\n" +
          "📅 " + Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy")
        );
        return;
      }

      // ค้นหา Job ID
      if (text.indexOf("JOB-") !== -1) {
        var match = text.match(/JOB-\d+/);
        if (match) {
          var allJobs = getSheetData(SHEET_JOBS);
          var found   = allJobs.find(function(j) { return j["Job ID"] === match[0]; });
          if (found) {
            replyLine(event.replyToken,
              "🔍 ข้อมูลงาน\n━━━━━━━━━━━━━━━\n" +
              "🔖 " + found["Job ID"] + "\n👤 " + (found["ชื่อลูกค้า"]||"-") + "\n" +
              "🚗 " + (found["ยี่ห้อรถ"]||"") + " " + (found["รุ่นรถ"]||"") + "\n" +
              "🔧 " + (found["รายการซ่อม / ปัญหา"]||"-") + "\n" +
              "📊 สถานะ: " + (found["สถานะ"]||"-") + "\n" +
              "💰 ราคา: ฿" + (found["ราคาจริง (฿)"] || found["ราคาประเมิน (฿)"] || "-")
            );
          } else { replyLine(event.replyToken, "❌ ไม่พบงาน " + match[0]); }
          return;
        }
      }

      // Help
      replyLine(event.replyToken,
        "⚡ P&K New Energy EV Garage\n━━━━━━━━━━━━━━━\n" +
        "📸 ส่งรูปสลิป → บันทึกรายได้อัตโนมัติ\n\n" +
        "📌 จองนัดหมาย:\nนัด: ชื่อ: xxx | วัน: 15/05/2568 | เวลา: 10:00 | รถ: BYD Atto 3 | โทร: 08x | ทะเบียน: กข1234\n\n" +
        "📌 สร้างงานซ่อม:\nชื่อ: xxx | รถ: xxx | ปัญหา: xxx | โทร: xxx\n\n" +
        "📌 คำสั่ง:\nดูงาน | รายได้ | นัดวันนี้ | JOB-XXXXX"
      );

    } catch (eventErr) { Logger.log("Event error: " + eventErr.message); }
  });
}

// ═══════════════════════════════════════════════════════════════
//  v3.2: FLEXIBLE LINE APPOINTMENT PARSER — Bug #1 + Bug #2 Fix
//  รองรับ: | หรือ , หรือ newline เป็น separator
//  รองรับ: ทะเบียน field ที่ขาดหายไปใน v3.1
//  รองรับ: รูปแบบสั้น เช่น "นัด ชื่อสมชาย วัน15/6 เวลา10:00 รถBYD โทร0812345678"
// ═══════════════════════════════════════════════════════════════
function parseLineAppointmentText(text) {
  var obj = { type: "ตรวจเช็คทั่วไป" };

  // ลบ prefix (Bug fix v3.2.1: รองรับ "นัด " ที่ไม่มี ":" ตามหลังด้วย)
  text = text.replace(/^(?:นัดหมาย:?|นัด:?|จองคิว:|จอง:?)\s*/i, "").trim();

  // ── Bug fix v3.2.1: เติม separator หน้าคีย์เวิร์ดที่ตามด้วย ":"
  //    เพื่อรองรับรูปแบบสั้นที่ไม่มี | หรือ , คั่น เช่น
  //    "ชื่อ:มานะ วัน:20/6/2568 เวลา:09:30 รถ:MG4 โทร:0898765432"
  //    (เดิม indexOf(":") แรกจะกินทุกอย่างหลังจากนั้นไปเป็น value เดียว)
  var FIELD_KEYS = "ชื่อ|โทร|tel|phone|รถ|car|ยี่ห้อ|ทะเบียน|เลขทะเบียน|plate|วัน|date|เวลา|time|งาน|บริการ|อาการ|type|หมาย|note|remark";
  text = text.replace(new RegExp("\\s+(?=(?:" + FIELD_KEYS + ")\\s*:)", "gi"), "|");

  // ── รองรับ separator หลายแบบ: | , \n ──
  var parts = text.split(/[|\n,]+/);

  parts.forEach(function(p) {
    p = p.trim();
    if (!p) return;

    // หา key:value โดย key คือก่อน colon แรก
    var colonIdx = p.indexOf(":");
    var k, v;
    if (colonIdx !== -1) {
      k = p.substring(0, colonIdx).trim();
      v = p.substring(colonIdx + 1).trim();
    } else {
      // ── รูปแบบไม่มี colon เช่น "ชื่อสมชาย" หรือ "รถBYD" ──
      var noColonMatch = p.match(/^(ชื่อ|โทร|รถ|ยี่ห้อ|ทะเบียน|วัน|เวลา|time|งาน|บริการ|อาการ|หมาย)(.*)/i);
      if (noColonMatch) { k = noColonMatch[1]; v = noColonMatch[2].trim(); }
      else return;
    }
    if (!k || !v) return;

    var kl = k.toLowerCase();
    if (kl.indexOf("ชื่อ")    !== -1) obj.name  = v;
    if (kl.indexOf("โทร")     !== -1 || kl.indexOf("tel") !== -1 || kl.indexOf("phone") !== -1) obj.phone = v.replace(/[-\s]/g,"");
    if (kl.indexOf("รถ")      !== -1 || kl.indexOf("car")  !== -1 || kl.indexOf("ยี่ห้อ") !== -1) obj.car = v;
    // ── Bug #2 Fix: เพิ่ม plate field ──
    if (kl.indexOf("ทะเบียน") !== -1 || kl.indexOf("เลขทะเบียน") !== -1 || kl.indexOf("plate") !== -1) obj.plate = v;
    if (kl.indexOf("งาน")     !== -1 || kl.indexOf("บริการ") !== -1 || kl.indexOf("อาการ") !== -1 || kl.indexOf("type") !== -1) obj.type  = v;
    if (kl.indexOf("หมาย")    !== -1 || kl.indexOf("note")   !== -1 || kl.indexOf("remark") !== -1) obj.notes = v;

    // วัน — แปลง พ.ศ. → ค.ศ. รองรับหลาย format
    if (kl.indexOf("วัน") !== -1 || kl.indexOf("date") !== -1) {
      var dm = v.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
      if (dm) {
        var yr = parseInt(dm[3]);
        if (yr > 2500) yr -= 543;
        else if (yr < 100) yr += 2000;
        obj.date = yr + "-" + ("0"+dm[2]).slice(-2) + "-" + ("0"+dm[1]).slice(-2);
      } else {
        // รูปแบบ เช่น "15/6" ไม่มีปี — ใช้ปีปัจจุบัน
        var dm2 = v.match(/(\d{1,2})[\/\-\.](\d{1,2})/);
        if (dm2) {
          var yr2 = new Date().getFullYear();
          obj.date = yr2 + "-" + ("0"+dm2[2]).slice(-2) + "-" + ("0"+dm2[1]).slice(-2);
        } else { obj.date = v; }
      }
    }

    // เวลา
    if (kl.indexOf("เวลา") !== -1 || kl.indexOf("time") !== -1) {
      var tm = v.match(/\d{1,2}:\d{2}/);
      obj.time = tm ? tm[0] : v;
    }
  });

  // ── Fallback: ดึงเบอร์โทรออกจาก text ถ้ายังไม่มี ──
  if (!obj.phone) {
    var phoneMatch = text.match(/0[689]\d{8}/);
    if (phoneMatch) obj.phone = phoneMatch[0];
  }

  // ── Fallback: ดึงวันที่จาก text ถ้ายังไม่มี ──
  if (!obj.date) {
    var anyDate = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (anyDate) {
      var yr3 = anyDate[3] ? parseInt(anyDate[3]) : new Date().getFullYear();
      if (yr3 > 2500) yr3 -= 543;
      else if (yr3 < 100) yr3 += 2000;
      obj.date = yr3 + "-" + ("0"+anyDate[2]).slice(-2) + "-" + ("0"+anyDate[1]).slice(-2);
    }
  }

  return obj;
}

// ═══════════════════════════════════════════════════════════════
//  SLIP PROCESSING PIPELINE
// ═══════════════════════════════════════════════════════════════
function processSlipImage(event, userId) {
  var replyToken = event.replyToken;
  var messageId  = event.message.id;
  try {
    var imageBlob = downloadLineImage(messageId);
    if (!imageBlob) { replyLine(replyToken, REPLY_SLIP_FAILED); return; }
    var imageUrl  = saveImageToDrive(imageBlob, messageId);
    var ocrText   = extractTextFromImage(imageBlob);
    if (!ocrText) { replyLine(replyToken, REPLY_SLIP_FAILED); return; }
    var slip          = parseSlipData(ocrText);
    slip.imageUrl     = imageUrl;
    slip.userId       = userId;
    slip.messageId    = messageId;
    slip.rawText      = ocrText;
    if (!slip.isSuccess) { replyLine(replyToken, REPLY_SLIP_FAILED); return; }
    if (isDuplicateSlip(slip.refId)) { replyLine(replyToken, REPLY_SLIP_DUPLICATE); return; }
    saveSlipToSheet(slip);
    updateDailyRevenue(slip);
    var replyMsg = REPLY_SLIP_SUCCESS
      .replace("{amount}", slip.amount ? Number(slip.amount).toLocaleString() : "?")
      .replace("{bank}",   slip.bank   || "?")
      .replace("{date}",   slip.date   || "?")
      .replace("{time}",   slip.time   || "")
      .replace("{sender}", slip.sender || "-")
      .replace("{ref}",    slip.refId  || "?");
    replyLine(replyToken, replyMsg);
    if (LINE_NOTIFY_TOKEN) { try { notifyLine("💳 รับสลิปใหม่!\n💰 ฿" + (slip.amount||0).toLocaleString() + "\n🏦 " + (slip.bank||"-") + "\n👤 จาก: " + (slip.sender||"-")); } catch(_) {} }
  } catch (err) {
    Logger.log("processSlipImage error: " + err.message);
    try { replyLine(replyToken, REPLY_SLIP_FAILED); } catch(_) {}
  }
}

function downloadLineImage(messageId) {
  try {
    var url      = "https://api-data.line.me/v2/bot/message/" + messageId + "/content";
    var response = UrlFetchApp.fetch(url, { method: "get", headers: { "Authorization": "Bearer " + LINE_CHANNEL_TOKEN }, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return null;
    return response.getBlob();
  } catch (err) { Logger.log("downloadLineImage error: " + err.message); return null; }
}

function saveImageToDrive(blob, messageId) {
  try {
    var folder   = getOrCreateFolder("EV_Garage_Slips");
    var today    = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyyMMdd");
    blob.setName("slip_" + today + "_" + messageId + ".jpg");
    var file     = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return "https://drive.google.com/uc?id=" + file.getId();
  } catch (err) { Logger.log("saveImageToDrive error: " + err.message); return ""; }
}

function getOrCreateFolder(name) {
  var folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

// ═══════════════════════════════════════════════════════════════
//  v3.2.2: OCR Slip via Claude — server-side proxy
//  Bug fix: frontend payOCRSlip() called api.anthropic.com directly
//  with no x-api-key header (always 401) and would have exposed the
//  key to every browser if one were added client-side. Now the key
//  lives only in Script Properties (Project Settings → Script Properties
//  → ANTHROPIC_API_KEY) and the call is proxied through doPost.
// ═══════════════════════════════════════════════════════════════
function ocrSlipWithClaude(base64Data, mediaType) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey)    return { status: "error", message: "ANTHROPIC_API_KEY not configured in Script Properties" };
  if (!base64Data) return { status: "error", message: "image data required" };
  try {
    var payload = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 600,
      system: "คุณคือระบบ OCR สำหรับสลิปโอนเงินธนาคารไทย\nตอบเฉพาะ JSON เท่านั้น ไม่ต้องอธิบาย ไม่ต้องมีข้อความอื่น\nJSON format:\n{\n  \"amount\": 1500.00,\n  \"ref\": \"เลขอ้างอิง/เลขรายการ\",\n  \"datetime\": \"YYYY-MM-DDTHH:MM\",\n  \"bank\": \"ชื่อธนาคาร\",\n  \"sender\": \"ชื่อผู้โอน\",\n  \"receiver\": \"ชื่อผู้รับ\",\n  \"confidence\": \"high|medium|low\"\n}\nถ้าอ่านค่าไม่ได้ให้ใส่ null",
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64Data } },
          { type: "text", text: "อ่านข้อมูลจากสลิปโอนเงินนี้ ตอบเฉพาะ JSON" }
        ]
      }]
    };
    var resp = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var data = JSON.parse(resp.getContentText());
    if (resp.getResponseCode() !== 200) {
      return { status: "error", message: (data.error && data.error.message) || ("API error " + resp.getResponseCode()) };
    }
    var text  = (data.content && data.content[0] && data.content[0].text) || "";
    var clean = text.replace(/```json|```/g, "").trim();
    var parsed = JSON.parse(clean);
    return { status: "ok", data: parsed };
  } catch (err) {
    Logger.log("ocrSlipWithClaude error: " + err.message);
    return { status: "error", message: err.message };
  }
}

function extractTextFromImage(blob) {
  try {
    var base64Image = Utilities.base64Encode(blob.getBytes());
    var url         = "https://vision.googleapis.com/v1/images:annotate?key=" + VISION_API_KEY;
    var payload     = { requests: [{ image: { content: base64Image }, features: [{ type: "TEXT_DETECTION", maxResults: 1 }], imageContext: { languageHints: ["th","en"] } }] };
    var response    = UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true });
    var result      = JSON.parse(response.getContentText());
    if (result.responses && result.responses[0] && result.responses[0].fullTextAnnotation) return result.responses[0].fullTextAnnotation.text;
    if (result.responses && result.responses[0] && result.responses[0].textAnnotations) return result.responses[0].textAnnotations[0].description;
    return null;
  } catch (err) { Logger.log("extractTextFromImage error: " + err.message); return null; }
}

function parseSlipData(text) {
  var data = { amount: null, bank: null, date: null, time: null, sender: null, receiver: null, refId: null, isSuccess: false, timestamp: new Date() };
  var failKeywords = ["ไม่สำเร็จ","ล้มเหลว","failed","declined","error","ยกเลิก"];
  var hasFailWord  = failKeywords.some(function(kw) { return text.toLowerCase().includes(kw.toLowerCase()); });
  var amountPats = [/จำนวนเงิน[:\s]*([0-9,]+\.?[0-9]*)/,/ยอดโอน[:\s]*([0-9,]+\.?[0-9]*)/,/ยอดเงิน[:\s]*([0-9,]+\.?[0-9]*)/,/Amount[:\s]*([0-9,]+\.?[0-9]*)/i,/([0-9,]+\.[0-9]{2})\s*(?:บาท|THB|baht)/i,/฿\s*([0-9,]+\.?[0-9]*)/,/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/,/([0-9,]{4,}\.00)/];
  for (var i = 0; i < amountPats.length; i++) { var m = text.match(amountPats[i]); if (m) { data.amount = parseFloat(m[1].replace(/,/g,"")); break; } }
  data.isSuccess = !hasFailWord && data.amount > 0;
  var bankMap = { "กสิกรไทย":["KBANK","กสิกร","KASIKORN","K PLUS"],"กรุงไทย":["KTB","กรุงไทย","KRUNGTHAI","NEXT"],"ไทยพาณิชย์":["SCB","ไทยพาณิชย์","SIAM COMMERCIAL","SCBEASY"],"กรุงเทพ":["BBL","กรุงเทพ","BANGKOK BANK","BUALUANG"],"ออมสิน":["GSB","ออมสิน"],"ทหารไทยธนชาต":["TTB","ทหารไทย","TMB","THANACHART"],"อาคารสงเคราะห์":["GHB"],"ธกส":["BAAC","ธกส"],"ยูโอบี":["UOB"],"ซีไอเอ็มบี":["CIMB"],"พร้อมเพย์":["PROMPTPAY","พร้อมเพย์","PROMPT PAY"] };
  var textUpper = text.toUpperCase();
  for (var bank in bankMap) { var kws = bankMap[bank]; var found = false; for (var k=0;k<kws.length;k++) { if (textUpper.indexOf(kws[k].toUpperCase())!==-1){found=true;break;} } if (found){data.bank=bank;break;} }
  var datePats = [/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,/(\d{1,2}\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*\d{2,4})/,/(\d{4}-\d{2}-\d{2})/,/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2,4})/i];
  for (var d=0;d<datePats.length;d++){var dm=text.match(datePats[d]);if(dm){data.date=dm[1];break;}}
  var timeM = text.match(/(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)/i);
  if (timeM) data.time = timeM[1];
  var refPats = [/เลขอ้างอิง[:\s]*([A-Z0-9]{8,})/i,/รหัสอ้างอิง[:\s]*([A-Z0-9]{8,})/i,/Ref\.?\s*No\.?[:\s]*([A-Z0-9]{8,})/i,/Ref[:\s#]*([A-Z0-9]{8,})/i,/Transaction\s*(?:ID|No)?[:\s#]*([A-Z0-9]{8,})/i,/Txn[:\s#]*([A-Z0-9]{8,})/i,/\b([0-9]{15,20})\b/,/\b([A-Z]{2,4}[0-9]{10,})\b/];
  for (var r=0;r<refPats.length;r++){var rm=text.match(refPats[r]);if(rm){data.refId=rm[1];break;}}
  if (!data.refId) { var fp=[data.amount,data.date,data.time,data.bank].join("_"); data.refId=Utilities.base64Encode(fp).substring(0,20).replace(/[\/+=]/g,"X"); }
  var senderM   = text.match(/(?:จาก|From|ผู้โอน)[:\s]*(.+?)(?:\n|บัญชี|$)/i);
  var receiverM = text.match(/(?:ไปยัง|ถึง|To|ผู้รับ)[:\s]*(.+?)(?:\n|บัญชี|$)/i);
  if (senderM)   data.sender   = senderM[1].trim().substring(0,50);
  if (receiverM) data.receiver = receiverM[1].trim().substring(0,50);
  return data;
}

function isDuplicateSlip(refId) {
  if (!refId) return false;
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_SLIPS);
    if (!sheet) return false;
    var data = sheet.getDataRange().getValues();
    for (var i=1;i<data.length;i++) { if (data[i][3]===refId) return true; }
    return false;
  } catch (err) { Logger.log("isDuplicateSlip error: " + err.message); return false; }
}

function saveSlipToSheet(slip) {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_SLIPS);
    if (!sheet) return;
    sheet.appendRow([slip.timestamp,slip.date||"",slip.time||"",slip.refId||"",slip.amount||0,slip.bank||"",slip.sender||"",slip.receiver||"",slip.userId||"",slip.messageId||"",slip.imageUrl||"",slip.rawText?slip.rawText.substring(0,500):""]);
    sheet.getRange(sheet.getLastRow(),5).setNumberFormat("#,##0.00");
  } catch (err) { Logger.log("saveSlipToSheet error: " + err.message); }
}

function updateDailyRevenue(slip) {
  if (!slip.amount) return;
  try {
    var sheet    = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_REVENUE);
    if (!sheet) return;
    var today    = Utilities.formatDate(new Date(),"Asia/Bangkok","yyyy-MM-dd");
    var data     = sheet.getDataRange().getValues();
    var foundRow = -1;
    for (var i=1;i<data.length;i++) { try { var rd=Utilities.formatDate(new Date(data[i][0]),"Asia/Bangkok","yyyy-MM-dd"); if(rd===today){foundRow=i+1;break;} } catch(_){} }
    if (foundRow>0) {
      var cc=Number(sheet.getRange(foundRow,2).getValue())||0;
      var cs=Number(sheet.getRange(foundRow,3).getValue())||0;
      var cj=Number(sheet.getRange(foundRow,4).getValue())||0;
      var ns=cs+slip.amount;
      sheet.getRange(foundRow,2).setValue(cc+1);
      sheet.getRange(foundRow,3).setValue(ns);
      sheet.getRange(foundRow,5).setValue(ns+cj);
      sheet.getRange(foundRow,6).setValue(new Date());
    } else { sheet.appendRow([new Date(),1,slip.amount,0,slip.amount,new Date()]); }
  } catch (err) { Logger.log("updateDailyRevenue error: " + err.message); }
}

function getRevenueData() {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_REVENUE);
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();
    if (data.length<2) return [];
    var headers=data.shift();
    return data.map(function(row){var obj={};headers.forEach(function(h,i){obj[h]=row[i];});return obj;}).reverse();
  } catch(err){return [];}
}

function getTodayRevenueFromSlips() {
  var result={count:0,total:0};
  try {
    var sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_SLIPS);
    if(!sheet)return result;
    var data=sheet.getDataRange().getValues();
    var today=Utilities.formatDate(new Date(),"Asia/Bangkok","yyyy-MM-dd");
    for(var i=1;i<data.length;i++){try{var rd=Utilities.formatDate(new Date(data[i][0]),"Asia/Bangkok","yyyy-MM-dd");if(rd===today){result.count++;result.total+=Number(data[i][4])||0;}}catch(_){}}
  } catch(err){}
  return result;
}

function deleteSlip(refId) {
  if (!refId) return;
  try {
    var sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_SLIPS);
    if(!sheet)return;
    var data=sheet.getDataRange().getValues();
    for(var i=data.length-1;i>=1;i--){if(data[i][3]===refId){sheet.deleteRow(i+1);break;}}
  } catch(err){ Logger.log("deleteSlip error: "+err.message); }
}

// ═══════════════════════════════════════════════════════════════
//  UPDATE JOB FIELDS
// ═══════════════════════════════════════════════════════════════
function updateJobFields(data) {
  if (!data.jobId || !data.fields) return;
  var sheet   = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_JOBS);
  if (!sheet) return;
  var rows    = sheet.getDataRange().getValues();
  var headers = rows[0];
  var colIdx  = {};
  headers.forEach(function(h, i) { colIdx[h] = i + 1; });
  function getOrAddCol(name) {
    if (colIdx[name]) return colIdx[name];
    var newIdx = headers.length + 1;
    sheet.getRange(1, newIdx).setValue(name).setFontWeight("bold").setBackground("#D0E4FF").setFontColor("#0F172A");
    headers.push(name);
    colIdx[name] = newIdx;
    return newIdx;
  }
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.jobId) {
      var rowNum = i + 1;
      // Bug fix v3.2.1: capture old "ราคาจริง (฿)" before overwrite so we can
      // credit only the *delta* to รายได้รายวัน. Previously this column was
      // only synced to the Revenue sheet via updateJobStatus(actualPrice),
      // which the dashboard never calls — job revenue stayed 0 in reports.
      var priceCol = colIdx["ราคาจริง (฿)"];
      var oldPrice = priceCol ? (Number(rows[i][priceCol - 1]) || 0) : 0;
      Object.keys(data.fields).forEach(function(key) {
        var val = data.fields[key];
        if (val === undefined || val === null) return;
        sheet.getRange(rowNum, getOrAddCol(key)).setValue(val);
      });
      sheet.getRange(rowNum, getOrAddCol("อัปเดตล่าสุด")).setValue(new Date());
      if (Object.prototype.hasOwnProperty.call(data.fields, "ราคาจริง (฿)")) {
        var newPrice = Number(data.fields["ราคาจริง (฿)"]) || 0;
        var delta = newPrice - oldPrice;
        if (delta > 0) { try { updateJobRevenue(delta); } catch(_) {} }
      }
      Logger.log("updateJobFields OK: " + data.jobId + " | keys=" + Object.keys(data.fields).join(","));
      return;
    }
  }
  Logger.log("updateJobFields: jobId not found: " + data.jobId);
}

function getSheetData(name) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length<2) return [];
  var headers = data.shift();
  return data.map(function(row){var obj={};headers.forEach(function(h,i){obj[h]=row[i];});return obj;}).reverse();
}

function createJob(data) {
  // Bug fix v3.2.1: serialize ID generation + appendRow to avoid duplicate
  // "JOB-<timestamp>" IDs when two requests land in the same millisecond.
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_JOBS);
    var jobId = "JOB-" + new Date().getTime();
    sheet.appendRow([jobId,new Date(),data.userId||"",data.customerName||"",data.customerPhone||"",data.carBrand||"",data.carModel||"",data.carPlate||"",data.repairType||"",data.estimatedPrice||"",data.estimatedHours||"",data.repairNotes||"",data.appointmentDate||"","รอตรวจสอบ","",""]);
    try { updateCustomer(data); } catch(_) {}
    if (LINE_NOTIFY_TOKEN) { try { notifyLine("🔧 งานใหม่: "+jobId+"\nลูกค้า: "+(data.customerName||"-")+"\nรถ: "+(data.carModel||"-")); } catch(_) {} }
    return jobId;
  } finally {
    lock.releaseLock();
  }
}

function updateJobStatus(data) {
  var sheet   = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_JOBS);
  var rows    = sheet.getDataRange().getValues();
  var headers = rows[0];
  var colIdx  = {};
  headers.forEach(function(h, i) { colIdx[h] = i + 1; });
  function getOrAddCol(name) {
    if (colIdx[name]) return colIdx[name];
    var newIdx = headers.length + 1;
    sheet.getRange(1, newIdx).setValue(name).setFontWeight("bold").setBackground("#CCCCCC");
    headers.push(name);
    colIdx[name] = newIdx;
    return newIdx;
  }
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.jobId) {
      var row = i + 1;
      sheet.getRange(row, getOrAddCol("สถานะ")).setValue(data.status);
      if (data.actualPrice) { sheet.getRange(row, getOrAddCol("ราคาจริง (฿)")).setValue(data.actualPrice); updateJobRevenue(Number(data.actualPrice)); }
      if (data.status === "ปิดงาน") { sheet.getRange(row, getOrAddCol("วันเสร็จ")).setValue(new Date()); }
      if (data.qcResult) {
        sheet.getRange(row, getOrAddCol("ผล QC")).setValue(data.qcResult);
        sheet.getRange(row, getOrAddCol("QC โดย")).setValue(data.qcBy || "");
        sheet.getRange(row, getOrAddCol("หมายเหตุ QC")).setValue(data.qcNotes || "");
        sheet.getRange(row, getOrAddCol("วันที่ QC")).setValue(new Date());
        if (data.qcChecklist) { sheet.getRange(row, getOrAddCol("QC Checklist")).setValue(data.qcChecklist); }
        // Bug fix v3.2.2: qcMeta/qcReport sent by frontend submitQC() were
        // previously dropped silently — persist them for audit/QC compliance.
        if (data.qcMeta)   { sheet.getRange(row, getOrAddCol("QC Meta")).setValue(data.qcMeta); }
        if (data.qcReport) { sheet.getRange(row, getOrAddCol("QC Report")).setValue(data.qcReport); }
      }
      // Bug fix v3.2.2: closeJob() sends extraFields (e.g. {"วันเสร็จ":closedAt})
      // which was previously ignored — persist any caller-supplied extra columns.
      if (data.extraFields && typeof data.extraFields === "object") {
        Object.keys(data.extraFields).forEach(function(key) {
          var val = data.extraFields[key];
          if (val === undefined || val === null) return;
          sheet.getRange(row, getOrAddCol(key)).setValue(val);
        });
      }
      if (data.updatedBy) {
        sheet.getRange(row, getOrAddCol("อัปเดตโดย")).setValue(data.updatedBy);
        sheet.getRange(row, getOrAddCol("อัปเดตล่าสุด")).setValue(new Date());
      }
      Logger.log("updateJobStatus: " + data.jobId + " → " + data.status);
      return true;
    }
  }
  // Bug fix v3.2.1: jobId not found — let caller report a real error
  // instead of silently responding {status:"ok"}.
  Logger.log("updateJobStatus: jobId not found: " + data.jobId);
  return false;
}

function updateJobRevenue(amount) {
  if(!amount)return;
  try {
    var sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_REVENUE);
    if(!sheet)return;
    var today=Utilities.formatDate(new Date(),"Asia/Bangkok","yyyy-MM-dd");
    var data=sheet.getDataRange().getValues();
    var foundRow=-1;
    for(var i=1;i<data.length;i++){try{var rd=Utilities.formatDate(new Date(data[i][0]),"Asia/Bangkok","yyyy-MM-dd");if(rd===today){foundRow=i+1;break;}}catch(_){}}
    if(foundRow>0){var cj=Number(sheet.getRange(foundRow,4).getValue())||0;var cs=Number(sheet.getRange(foundRow,3).getValue())||0;var nj=cj+amount;sheet.getRange(foundRow,4).setValue(nj);sheet.getRange(foundRow,5).setValue(nj+cs);sheet.getRange(foundRow,6).setValue(new Date());}
    else{sheet.appendRow([new Date(),0,0,amount,amount,new Date()]);}
  } catch(err){}
}

function updateInventory(data) {
  var sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_INVENTORY);
  var rows=sheet.getDataRange().getValues();
  var headers=rows[0];
  var colIdx={};
  headers.forEach(function(h,i){colIdx[h]=i+1;});
  function getOrAddCol(name){
    if(colIdx[name])return colIdx[name];
    var newIdx=headers.length+1;
    sheet.getRange(1,newIdx).setValue(name).setFontWeight("bold").setBackground("#F5A623").setFontColor("#FFFFFF");
    headers.push(name);
    colIdx[name]=newIdx;
    return newIdx;
  }
  for(var i=1;i<rows.length;i++){
    if(rows[i][0]===data.partCode){
      var rowNum=i+1;
      // Bug fix v3.2.1: operator precedence — was (a || (0+b)), now ((a||0) + b)
      var newQty=(Number(rows[i][3])||0)+Number(data.qtyChange||0);
      sheet.getRange(rowNum,4).setValue(newQty);
      sheet.getRange(rowNum,7).setValue(new Date());
      // Bug fix v3.2.1: persist pricing/meta fields sent from Settings → Inventory pricing modal
      if(data.fields&&typeof data.fields==="object"){
        Object.keys(data.fields).forEach(function(key){
          var val=data.fields[key];
          if(val===undefined||val===null)return;
          sheet.getRange(rowNum,getOrAddCol(key)).setValue(val);
        });
      }
      if(newQty<=(Number(rows[i][4])||0)&&LINE_NOTIFY_TOKEN){try{notifyLine("⚠️ สต็อกต่ำ: "+rows[i][1]+" เหลือ "+newQty+" ชิ้น");}catch(_){}}
      Logger.log("updateInventory: "+data.partCode+" qty="+newQty+(data.fields?" fields="+Object.keys(data.fields).join(","):""));
      return;
    }
  }
  Logger.log("updateInventory: partCode not found: "+data.partCode);
}

function updateCustomer(data) {
  var sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_CUSTOMERS);
  var rows=sheet.getDataRange().getValues();
  var found=false;
  for(var i=1;i<rows.length;i++){
    if(rows[i][0]===data.customerName&&rows[i][1]===data.customerPhone){sheet.getRange(i+1,6).setValue((Number(rows[i][5])||1)+1);sheet.getRange(i+1,7).setValue(new Date());found=true;break;}
  }
  if(!found){sheet.appendRow([data.customerName||"",data.customerPhone||"",data.carBrand||"",data.carModel||"",data.carPlate||"",1,new Date()]);}
}

function getDashboardSummary() {
  var jobs=getSheetData(SHEET_JOBS);
  var today=new Date().toDateString();
  var summary={today:0,inProgress:0,done:0,revenue:0,slipRevenue:0,slipCount:0};
  var IN_PROGRESS_STATUSES = ["กำลังตรวจสอบ","รออนุมัติราคา","รอซ่อม","รออะไหล่","กำลังซ่อม","รอ QC","ผ่าน QC","รอชำระเงิน"];
  jobs.forEach(function(j){
    if(new Date(j["วันที่สร้าง"]).toDateString()===today)summary.today++;
    if(IN_PROGRESS_STATUSES.indexOf(j["สถานะ"])!==-1)summary.inProgress++;
    if(j["สถานะ"]==="ปิดงาน"){summary.done++;summary.revenue+=Number(j["ราคาจริง (฿)"]||0);}
  });
  var slipRev=getTodayRevenueFromSlips();
  summary.slipRevenue=slipRev.total;
  summary.slipCount=slipRev.count;
  summary.totalRevenue=summary.revenue+summary.slipRevenue;
  try {
    var todayStr = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
    summary.appointmentsToday = getAppointments({ date: todayStr }).length;
    summary.linePending = getPendingLineCount();
  } catch(_) { summary.appointmentsToday = 0; summary.linePending = 0; }
  return summary;
}

// ═══════════════════════════════════════════════════════════════
//  v3.3: AI INTENT DETECTION (Gemini Function Calling) — NEW FEATURE
//
//  Architecture:
//    LINE → Webhook → Intent Detection (Gemini) → Function Calling
//          → Business Logic (createAppointment/createJob/...)
//          → Google Sheets → Reply Message
//
//  ตั้งค่า: Project Settings → Script Properties → "GEMINI_API_KEY"
//  ถ้าไม่ตั้งค่า handleLineWebhook() จะข้ามส่วนนี้ทั้งหมดและใช้ regex parser
//  เดิมตามปกติ (ดู Bug fix v3.3 ใน handleLineWebhook ด้านบน) — ของเดิมไม่เปลี่ยน
// ═══════════════════════════════════════════════════════════════

// ── Conversation State (multi-turn) — เก็บต่อ userId, TTL 30 นาที ──
var CONV_CACHE_TTL = 1800;
function getConversationState(userId) {
  try {
    var raw = CacheService.getScriptCache().get("line_conv_" + userId);
    return raw ? JSON.parse(raw) : { history: [] };
  } catch (_) { return { history: [] }; }
}
function saveConversationState(userId, state) {
  try {
    if (state.history && state.history.length > 12) state.history = state.history.slice(-12);
    CacheService.getScriptCache().put("line_conv_" + userId, JSON.stringify(state), CONV_CACHE_TTL);
  } catch (_) {}
}
function clearConversationState(userId) {
  try { CacheService.getScriptCache().remove("line_conv_" + userId); } catch (_) {}
}

// ── Function Calling Tool Declarations ──
function getAIToolDeclarations() {
  return [{
    functionDeclarations: [
      {
        name: "create_appointment",
        description: "สร้างนัดหมายเข้าซ่อม/ตรวจเช็ครถ EV เมื่อผู้ใช้ระบุวัน/เวลา/รถ/อาการที่ต้องการนัด",
        parameters: {
          type: "OBJECT",
          properties: {
            name:  { type: "STRING", description: "ชื่อลูกค้า" },
            phone: { type: "STRING", description: "เบอร์โทรศัพท์ลูกค้า" },
            date:  { type: "STRING", description: "วันที่นัด รูปแบบ YYYY-MM-DD (ค.ศ.)" },
            time:  { type: "STRING", description: "เวลานัด รูปแบบ HH:MM" },
            car:   { type: "STRING", description: "ยี่ห้อ/รุ่นรถ เช่น MG4, BYD Seal" },
            plate: { type: "STRING", description: "ทะเบียนรถ ถ้ามี" },
            type:  { type: "STRING", description: "ประเภทงาน เช่น เช็คเบรก, ตรวจเช็คทั่วไป, เปลี่ยนแบตเตอรี่" },
            notes: { type: "STRING", description: "รายละเอียดเพิ่มเติม/อาการ" }
          },
          required: ["name","date"]
        }
      },
      {
        name: "create_job",
        description: "สร้างใบงานซ่อมทันที (ใช้เมื่อรถอยู่ที่อู่แล้ว หรือผู้ใช้ต้องการแจ้งซ่อมทันที ไม่ใช่นัดล่วงหน้า)",
        parameters: {
          type: "OBJECT",
          properties: {
            customerName:  { type: "STRING", description: "ชื่อลูกค้า" },
            customerPhone: { type: "STRING", description: "เบอร์โทรศัพท์" },
            carBrand:      { type: "STRING", description: "ยี่ห้อรถ" },
            carModel:      { type: "STRING", description: "รุ่นรถ" },
            carPlate:      { type: "STRING", description: "ทะเบียนรถ" },
            repairType:    { type: "STRING", description: "ประเภทงาน/อาการที่ต้องการซ่อม" },
            repairNotes:   { type: "STRING", description: "รายละเอียดอาการเพิ่มเติม" }
          },
          required: ["customerName","repairType"]
        }
      },
      {
        name: "check_job_status",
        description: "ตรวจสอบสถานะใบงานซ่อมจากเลข Job ID เช่น JOB-123456",
        parameters: {
          type: "OBJECT",
          properties: { jobId: { type: "STRING", description: "เลข Job ID เช่น JOB-1718000000000" } },
          required: ["jobId"]
        }
      },
      {
        name: "create_lead",
        description: "บันทึกความสนใจของลูกค้าที่ยังไม่พร้อมนัดหมายตอนนี้ (เช่น สอบถามบริการ/ราคา) เพื่อให้ทีมขายติดต่อกลับ",
        parameters: {
          type: "OBJECT",
          properties: {
            name:     { type: "STRING", description: "ชื่อลูกค้า (ถ้าทราบ)" },
            phone:    { type: "STRING", description: "เบอร์โทร (ถ้าทราบ)" },
            interest: { type: "STRING", description: "สิ่งที่ลูกค้าสนใจ เช่น เปลี่ยนแบตเตอรี่, เช็คระยะ" },
            notes:    { type: "STRING", description: "รายละเอียดเพิ่มเติม" }
          },
          required: ["interest"]
        }
      }
    ]
  }];
}

// ── System Prompt + Knowledge Base (FAQ พื้นฐานสำหรับตอบลูกค้า) ──
function getAISystemPrompt() {
  var today = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd (EEEE)");
  return "คุณคือ AI Service Advisor ของ \"P&K New Energy\" ผู้เชี่ยวชาญด้านรถยนต์ไฟฟ้า (EV) และงานบริการหลังการขาย\n" +
    "หน้าที่ของคุณคือช่วยลูกค้า จองคิว ตรวจสอบสถานะงานซ่อม ตอบคำถามเกี่ยวกับรถ EV รับข้อมูลเบื้องต้นของลูกค้า และสร้าง Lead ให้ทีมงาน\n" +
    "วันนี้คือวันที่ " + today + " (เขตเวลา Asia/Bangkok) — ใช้คำนวณวันที่จากคำพูดเช่น \"พรุ่งนี้\" \"วันเสาร์นี้\"\n\n" +
    "กฎการทำงาน:\n" +
    "1. ตอบเป็นภาษาไทย สุภาพ กระชับ และเข้าใจง่าย\n" +
    "2. หากลูกค้าต้องการนัดหมาย:\n" +
    "   - ตรวจจับวัน เวลา รุ่นรถ และปัญหาจากข้อความ\n" +
    "   - หากข้อมูลไม่ครบ (เช่น ยังไม่มีชื่อ/เบอร์โทร/วันที่) ให้ถามเฉพาะข้อมูลที่ขาดทีละรายการ\n" +
    "   - เมื่อข้อมูลครบ (อย่างน้อยต้องมีชื่อและวันที่) ให้เรียก Function create_appointment\n" +
    "   - ห้ามเดาข้อมูลแทนลูกค้า\n" +
    "3. หากลูกค้าต้องการนำรถเข้าซ่อมทันที (รถอยู่ที่อู่แล้ว):\n" +
    "   - เก็บข้อมูล ชื่อ เบอร์โทร รุ่นรถ ปัญหา\n" +
    "   - เมื่อข้อมูลครบ ให้เรียก Function create_job\n" +
    "4. หากลูกค้าถามสถานะงาน:\n" +
    "   - ตรวจหา JOB ID ในข้อความ (รูปแบบ JOB-XXXXXXXXXXXXX)\n" +
    "   - เรียก Function check_job_status\n" +
    "   - สรุปสถานะล่าสุดให้เข้าใจง่าย\n" +
    "5. หากลูกค้าสนใจบริการหรือยังไม่พร้อมเข้าซ่อม (เช่น ถามถึงบริการ/ราคา โดยไม่ระบุวันนัด):\n" +
    "   - เก็บข้อมูลเป็น Lead — ถ้ายังไม่มีเบอร์โทรติดต่อกลับ ให้ถามก่อน\n" +
    "   - เมื่อได้ข้อมูลพอแล้ว ให้เรียก Function create_lead\n" +
    "6. หากเป็นคำถามทั่วไปเกี่ยวกับรถ EV ให้ตอบจากฐานความรู้ด้านล่าง หากไม่มั่นใจ ให้แนะนำให้นำรถเข้าตรวจที่ศูนย์บริการ\n" +
    "7. ห้ามสร้างข้อมูลเท็จ — ห้ามเดาราคา ห้ามเดาสถานะงาน ห้ามเดาวันนัด\n" +
    "8. หากลูกค้าพูดไม่ชัดเจน ให้ถามกลับอย่างสุภาพ เช่น \"รบกวนแจ้งรุ่นรถเพิ่มเติมครับ\" / \"สะดวกเข้ารับบริการวันไหนครับ\" / \"ขอชื่อและเบอร์โทรสำหรับจองคิวครับ\"\n\n" +
    "ตัวอย่างการตอบสนอง:\n" +
    "- ลูกค้า: \"พรุ่งนี้เอา MG4 เข้าเช็คเบรกครับ\" → ถาม \"รบกวนแจ้งชื่อและเบอร์โทรสำหรับจองคิวครับ\"\n" +
    "- ลูกค้า: \"BYD Atto3 ชาร์จไม่เข้า\" → \"เบื้องต้นอาจเกิดจากระบบชาร์จ แบตเตอรี่ หรือชุดควบคุมการชาร์จครับ ต้องการนัดตรวจเช็กหรือไม่ครับ\"\n" +
    "- ลูกค้า: \"เช็คสถานะ JOB-123456\" → เรียก check_job_status\n" +
    "- ลูกค้า: \"อยากเปลี่ยนแบต MG4\" → \"รบกวนแจ้งเบอร์โทรติดต่อกลับครับ ทางทีมงานจะจัดทำข้อมูลและติดต่อกลับโดยเร็วที่สุด\" แล้วเรียก create_lead เมื่อได้เบอร์โทร\n\n" +
    "ความรู้พื้นฐาน (Knowledge Base):\n" +
    "- รถชาร์จไม่เข้า: อาจเกิดจากระบบชาร์จ แบตเตอรี่ หรือชุดควบคุมการชาร์จ — แนะนำตรวจสอบสายชาร์จ/ตู้ชาร์จก่อน ลองสลับสายหรือจุดชาร์จอื่น ถ้ายังไม่เข้าให้นำรถเข้าตรวจเช็คระบบชาร์จที่อู่\n" +
    "- แบตเตอรี่เสื่อมเร็ว/วิ่งได้ระยะสั้นลง: แนะนำตรวจเช็คสุขภาพแบตเตอรี่ (State of Health) ที่อู่\n" +
    "- ไฟเตือนระบบ EV ขึ้นที่หน้าปัด: แนะนำนำรถเข้าตรวจเช็ค Error Code โดยเร็วที่สุด\n\n" +
    "เป้าหมายสูงสุด: ตอบลูกค้าให้เร็วที่สุด เก็บข้อมูลให้ครบที่สุด เปลี่ยนผู้สนใจให้เป็นลูกค้า ลดภาระแอดมิน และสร้างประสบการณ์ที่ดีให้ลูกค้า";
}

// ── เรียก Gemini API พร้อม Function Calling ──
function callGeminiAPI(text, history) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + apiKey;
  var contents = (history || []).map(function(h) {
    return { role: h.role, parts: [{ text: h.text }] };
  });
  contents.push({ role: "user", parts: [{ text: text }] });
  var payload = {
    system_instruction: { parts: [{ text: getAISystemPrompt() }] },
    contents: contents,
    tools: getAIToolDeclarations()
  };
  var resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var data = JSON.parse(resp.getContentText());
  if (resp.getResponseCode() !== 200) throw new Error((data.error && data.error.message) || ("Gemini API error " + resp.getResponseCode()));
  return data;
}

// ── จุดเริ่มต้น: ประมวลผลข้อความด้วย AI Intent Detection ──
// คืนค่า true ถ้าตอบกลับ LINE สำเร็จแล้ว (ไม่ต้องประมวลผลด้วย regex parser ต่อ)
function handleLineMessageAI(event, userId, text) {
  var state = getConversationState(userId);
  var data  = callGeminiAPI(text, state.history);
  var candidate = data.candidates && data.candidates[0];
  if (!candidate || !candidate.content || !candidate.content.parts) return false;

  var parts = candidate.content.parts;
  var fnCallPart = parts.filter(function(p) { return p.functionCall; })[0];

  state.history = state.history || [];
  state.history.push({ role: "user", text: text });

  if (fnCallPart) {
    var fnName = fnCallPart.functionCall.name;
    var fnArgs = fnCallPart.functionCall.args || {};
    var replyText = executeAIFunction(fnName, fnArgs, userId);
    replyLine(event.replyToken, replyText);
    // เคลียร์ context หลังทำรายการสำเร็จ — เริ่มบทสนทนาใหม่ในรอบถัดไป
    clearConversationState(userId);
    return true;
  }

  // ไม่มี function call → ตอบข้อความปกติ (ถามข้อมูลเพิ่ม / ตอบ FAQ)
  var textPart = parts.filter(function(p) { return p.text; })[0];
  if (!textPart || !textPart.text) return false;
  state.history.push({ role: "model", text: textPart.text });
  saveConversationState(userId, state);
  replyLine(event.replyToken, textPart.text.trim());
  return true;
}

// ── Function Calling → Business Logic → Google Sheets ──
function executeAIFunction(name, args, userId) {
  if (name === "create_appointment") {
    var apptId = createAppointment({
      name:   args.name  || "",
      phone:  args.phone || "",
      date:   args.date  || "",
      time:   args.time  || "",
      car:    args.car   || "",
      plate:  args.plate || "",
      type:   args.type  || "ตรวจเช็คทั่วไป",
      notes:  args.notes || "",
      source: "line",
      createdBy: userId
    });
    return "📅 รับนัดหมายแล้วครับ!\n━━━━━━━━━━━━━━━\n" +
      "🔖 ID: " + apptId + "\n" +
      "👤 " + (args.name || "-") + "\n" +
      "🗓 " + (args.date || "-") + " เวลา " + (args.time || "-") + "\n" +
      "🚗 " + (args.car || "-") + "\n" +
      "🔧 " + (args.type || "ตรวจเช็คทั่วไป") + "\n" +
      "━━━━━━━━━━━━━━━\n⏳ รอทีมงานยืนยันนัดครับ 🙏";
  }
  if (name === "create_job") {
    var jobId = createJob({
      customerName:  args.customerName  || "",
      customerPhone: args.customerPhone || "",
      carBrand:      args.carBrand      || "",
      carModel:      args.carModel      || "",
      carPlate:      args.carPlate      || "",
      repairType:    args.repairType    || "",
      repairNotes:   args.repairNotes   || "",
      userId:        userId
    });
    return "✅ รับงานแล้วครับ!\n━━━━━━━━━━━━━━━\n" +
      "🔖 Job ID: " + jobId + "\n" +
      "👤 ลูกค้า: " + (args.customerName || "-") + "\n" +
      "🔧 อาการ: " + (args.repairType || "-") + "\n" +
      "━━━━━━━━━━━━━━━\nส่ง 'เช็คสถานะ " + jobId + "' เพื่อตรวจสอบสถานะ";
  }
  if (name === "check_job_status") {
    var jobIdMatch = String(args.jobId || "").match(/JOB-\d+/);
    if (!jobIdMatch) return "❌ รูปแบบเลข Job ID ไม่ถูกต้อง กรุณาระบุเช่น JOB-1718000000000";
    var found = getSheetData(SHEET_JOBS).filter(function(j) { return j["Job ID"] === jobIdMatch[0]; })[0];
    if (!found) return "❌ ไม่พบงาน " + jobIdMatch[0];
    return "🔍 ข้อมูลงาน\n━━━━━━━━━━━━━━━\n" +
      "🔖 " + found["Job ID"] + "\n👤 " + (found["ชื่อลูกค้า"]||"-") + "\n" +
      "🚗 " + (found["ยี่ห้อรถ"]||"") + " " + (found["รุ่นรถ"]||"") + "\n" +
      "🔧 " + (found["รายการซ่อม / ปัญหา"]||"-") + "\n" +
      "📊 สถานะ: " + (found["สถานะ"]||"-") + "\n" +
      "💰 ราคา: ฿" + (found["ราคาจริง (฿)"] || found["ราคาประเมิน (฿)"] || "-");
  }
  if (name === "create_lead") {
    var leadId = createLead({ name: args.name||"", phone: args.phone||"", interest: args.interest||"", notes: args.notes||"", source: "line", createdBy: userId });
    return "🙏 ขอบคุณที่สนใจบริการ \"" + (args.interest || "-") + "\" ครับ\nทีมงานจะติดต่อกลับเพื่อให้ข้อมูลเพิ่มเติมเร็วๆ นี้\n🔖 " + leadId;
  }
  return "ขออภัยครับ ยังไม่รองรับคำขอนี้ กรุณาติดต่อทีมงานโดยตรงครับ 🙏";
}

// ── สร้าง Lead ใหม่ ──
function createLead(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_LEADS);
    if (!sheet) { initSheets(); sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_LEADS); }
    var id = "LEAD-" + new Date().getTime();
    sheet.appendRow([id, data.name||"", data.phone||"", data.interest||"", data.notes||"", data.source||"manual", "ใหม่", new Date()]);
    return id;
  } finally {
    lock.releaseLock();
  }
}

function parseLineText(text) {
  var obj={};
  text.split(/[|,\n]+/).forEach(function(p){
    var ci=p.indexOf(":");if(ci===-1)return;
    var k=p.substring(0,ci).trim();var v=p.substring(ci+1).trim();
    if(!k||!v)return;
    if(k.indexOf("ชื่อ")!==-1)obj.customerName=v;
    if(k.indexOf("รถ")!==-1)obj.carModel=v;
    if(k.indexOf("ปัญหา")!==-1||k.indexOf("อาการ")!==-1)obj.repairType=v;
    if(k.indexOf("โทร")!==-1)obj.customerPhone=v;
    if(k.indexOf("ยี่ห้อ")!==-1)obj.carBrand=v;
    if(k.indexOf("ทะเบียน")!==-1)obj.carPlate=v;
  });
  return obj;
}

// ═══════════════════════════════════════════════════════════════
//  LINE MESSAGING UTILS
// ═══════════════════════════════════════════════════════════════
function replyLine(token, message) {
  if (!token || !LINE_CHANNEL_TOKEN) return;
  try {
    UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
      method:"post",
      headers:{"Authorization":"Bearer "+LINE_CHANNEL_TOKEN,"Content-Type":"application/json"},
      payload:JSON.stringify({replyToken:token,messages:[{type:"text",text:String(message).substring(0,5000)}]}),
      muteHttpExceptions:true
    });
  } catch(e){ Logger.log("replyLine error: "+e.message); }
}

// v3.2: Push message ไปหา user โดยตรง (ไม่ต้องมี replyToken)
function pushLine(userId, message) {
  if (!userId || !LINE_CHANNEL_TOKEN) return;
  try {
    UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
      method:"post",
      headers:{"Authorization":"Bearer "+LINE_CHANNEL_TOKEN,"Content-Type":"application/json"},
      payload:JSON.stringify({to: userId, messages:[{type:"text",text:String(message).substring(0,5000)}]}),
      muteHttpExceptions:true
    });
  } catch(e){ Logger.log("pushLine error: "+e.message); }
}

function notifyLine(message) {
  if (!LINE_NOTIFY_TOKEN) return;
  UrlFetchApp.fetch("https://notify-api.line.me/api/notify",{method:"post",headers:{"Authorization":"Bearer "+LINE_NOTIFY_TOKEN},payload:"message="+encodeURIComponent(message),muteHttpExceptions:true});
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════
//  TEST FUNCTIONS
// ═══════════════════════════════════════════════════════════════
function testSheetConnection() {
  try {
    var ss=SpreadsheetApp.openById(SPREADSHEET_ID);
    Logger.log("✅ เชื่อมต่อ Sheets สำเร็จ: "+ss.getName());
    initSheets();
    Logger.log("✅ initSheets() สำเร็จ");
  } catch(e){ Logger.log("❌ Error: "+e.message); }
}

function testParseLineAppointment() {
  var tests = [
    "นัด: ชื่อ: สมชาย ใจดี | วัน: 15/06/2568 | เวลา: 10:00 | รถ: BYD Atto 3 | โทร: 0812345678 | ทะเบียน: กข 1234",
    "นัด ชื่อ:มานะ วัน:20/6/2568 เวลา:09:30 รถ:MG4 โทร:0898765432",
    "จอง ชื่อ: สุดา | วัน: 5/7 | เวลา: 14:00 | รถ: Neta V | โทร: 0812341234",
    "นัด: ชื่อ: วิชัย, วัน: 10/07/2568, เวลา: 11:00, รถ: Tesla Model 3, โทร: 0876543210"
  ];
  tests.forEach(function(t,i) {
    var r = parseLineAppointmentText(t);
    Logger.log("Test " + (i+1) + ": " + JSON.stringify(r));
  });
}

function testCreateJobFromAppt() {
  // เปลี่ยน apptId เป็น ID จริงก่อนรัน
  var result = createJobFromAppointment({ apptId: "APT-TEST", createdBy: "test" });
  Logger.log("createJobFromAppointment: " + JSON.stringify(result));
}

function testDashboard() {
  var summary=getDashboardSummary();
  Logger.log("Dashboard: "+JSON.stringify(summary,null,2));
}

