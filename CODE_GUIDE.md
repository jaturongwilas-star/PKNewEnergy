# Code Guide — EV Garage Management System

> Technical Reference for Developers  
> P&K New Energy | Version 3.0 | Google Apps Script + HTML/JavaScript

---

## สารบัญ

1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure](#2-project-structure)
3. [Backend — Code.gs](#3-backend--codegs)
4. [Frontend — index.html](#4-frontend--indexhtml)
5. [Database Schema (Google Sheets)](#5-database-schema)
6. [API Reference](#6-api-reference)
7. [LINE Bot Integration](#7-line-bot-integration)
8. [OCR Pipeline](#8-ocr-pipeline)
9. [Configuration & Secrets](#9-configuration--secrets)
10. [Role & Auth System](#10-role--auth-system)
11. [Testing & Debugging](#11-testing--debugging)
12. [Deployment Guide](#12-deployment-guide)
13. [Known Limitations](#13-known-limitations)
14. [Development Conventions](#14-development-conventions)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENTS                               │
│  Browser (HTML Dashboard)  │  LINE App (Customer/Admin)      │
└──────────┬─────────────────┴─────────────┬───────────────────┘
           │ HTTP GET/POST                 │ Webhook POST
           ▼                               ▼
┌──────────────────────────────────────────────────────────────┐
│              Google Apps Script — Code.gs                    │
│  doGet()  ─── routes by ?action=xxx                          │
│  doPost() ─── routes by body.action or LINE events[]         │
└────┬─────────────────┬────────────────────┬──────────────────┘
     │                 │                    │
     ▼                 ▼                    ▼
┌──────────┐  ┌──────────────┐   ┌──────────────────────┐
│ Google   │  │ Google Drive │   │ Google Cloud Vision  │
│ Sheets   │  │ (Slip imgs)  │   │ API (OCR)            │
│ 5 tabs   │  └──────────────┘   └──────────────────────┘
└──────────┘
     │
     ▼
┌──────────────────┐     ┌──────────────────┐
│ LINE Messaging   │     │ LINE Notify API  │
│ API (reply)      │     │ (push alerts)    │
└──────────────────┘     └──────────────────┘
```

### Data Flow Summary

| Operation | Path |
|-----------|------|
| View jobs | Browser → GAS doGet(?action=getJobs) → Sheets |
| Create job | Browser → GAS doPost(createJob) → Sheets → LINE Notify |
| Update status | Browser → GAS doPost(updateJobStatus) → Sheets |
| LINE booking | LINE → GAS doPost() → handleLineWebhook → Sheets |
| Payment slip | LINE image → GAS → Drive → Vision API → Sheets → Reply |
| Low stock alert | GAS (on edit) → LINE Notify |

---

## 2. Project Structure

```
EV Garage/
├── Code.gs                         # GAS backend (926 lines, v3.0)
├── PKNewEnergy/
│   ├── index.html                  # Production dashboard (~53KB)
│   └── .git/                       # Git history
├── ev_service_system_v2.html       # Legacy dashboard (simplified)
├── index.html                      # Legacy dashboard (copy)
├── README.md                       # Project overview
├── USER_MANUAL.md                  # End-user guide (Thai)
├── CODE_GUIDE.md                   # This file
├── Back-up/
│   ├── ev_service_system_v2.html
│   ├── ev_service_system_v5 (1).html
│   └── EV_service_system_v6.html
└── New ver/
    ├── Code.gs
    ├── index.html
    └── ev_service_system_v5 (1).html
```

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `Code.gs` | GAS backend, all server logic | ~926 |
| `PKNewEnergy/index.html` | Current production dashboard | ~1500+ |
| `ev_service_system_v2.html` | Legacy dashboard | ~800 |

---

## 3. Backend — Code.gs

### 3.1 Top-level Configuration (Lines 1–20)

```javascript
// ── Required Configuration ──────────────────────────────────
const SPREADSHEET_ID     = "1iGVAgzQbPSb62ra1syZVRhYqxdbJfGr1TJ8_FgB6VkY";
const LINE_CHANNEL_TOKEN = "YOUR_LINE_CHANNEL_ACCESS_TOKEN";
const LINE_NOTIFY_TOKEN  = "YOUR_LINE_NOTIFY_TOKEN";   // optional
const VISION_API_KEY     = "AIzaSyDKoucAFd6CVQV8k0_vZPF6S4kvntw6YTM";

// ── Sheet Names ─────────────────────────────────────────────
const SHEET_JOBS      = "งานซ่อม";
const SHEET_CUSTOMERS = "ลูกค้า";
const SHEET_INVENTORY = "คลังอะไหล่";
const SHEET_SLIPS     = "สลิปโอนเงิน";
const SHEET_REVENUE   = "รายได้รายวัน";
```

### 3.2 Entry Points

#### `doGet(e)` — HTTP GET handler

```javascript
function doGet(e) {
  const action = e.parameter.action;
  // Routes:
  // ping         → health check
  // getJobs      → all jobs array
  // getCustomers → all customers
  // getInventory → all parts
  // getDashboard → today's summary metrics
  // getSlips     → all payment slips
  // getRevenue   → revenue history
}
```

Returns: `ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON)`

#### `doPost(e)` — HTTP POST handler

```javascript
function doPost(e) {
  const body = JSON.parse(e.postData.contents);

  // Branch 1: LINE Webhook
  if (body.destination || body.events) {
    return handleLineWebhook(body);
  }

  // Branch 2: Dashboard API call
  switch (body.action) {
    case "createJob":       return createJob(body);
    case "updateJobStatus": return updateJobStatus(body);
    case "updateInventory": return updateInventory(body);
    case "deleteSlip":      return deleteSlip(body);
  }
}
```

### 3.3 Core Functions

#### `initSheets()`
สร้าง 5 sheets พร้อม headers หากยังไม่มี — เรียกครั้งแรกเมื่อ deploy

#### `createJob(data)`
```
Input:  { customerName, customerPhone, carBrand, carModel,
          carPlate, repairType, estimatedPrice, estimatedHours,
          appointmentDate, notes, userId }
Process:
  1. Generate jobId = "JOB-" + Date.now()
  2. Append row to งานซ่อม sheet
  3. Upsert customer in ลูกค้า sheet
  4. Send LINE Notify to manager
Output: { success: true, jobId }
```

#### `updateJobStatus(data)`
```
Input:  { jobId, status, actualPrice }
Process:
  1. Find row in งานซ่อม by jobId (column A)
  2. Update column N (สถานะ)
  3. If status === "ปิดงาน":
       - Update column O (ราคาจริง)
       - Update column P (วันเสร็จ)
       - Update รายได้รายวัน sheet
  4. Send LINE Notify
Output: { success: true }
```

#### `getDashboard()`
```
Reads:  งานซ่อม (all rows), สลิปโอนเงิน (today), รายได้รายวัน (today)
Returns:
  {
    jobsToday: number,
    inProgress: number,
    waitingQC: number,
    completedToday: number,
    revenueToday: number,
    slipsToday: { count, total }
  }
```

#### `checkAndAlertLowStock()`
```
Reads:  คลังอะไหล่ (all rows)
For each part where qty ≤ minQty:
  → Send LINE Notify with part name + qty
```

### 3.4 Function Map

| Function | Lines (approx) | Purpose |
|----------|---------------|---------|
| `doGet` | 25-80 | HTTP GET router |
| `doPost` | 83-120 | HTTP POST router |
| `initSheets` | 123-180 | DB initialization |
| `createJob` | 183-240 | Create repair job |
| `updateJobStatus` | 243-310 | Update job state |
| `getJobs` | 313-360 | Read all jobs |
| `getCustomers` | 363-390 | Read all customers |
| `getInventory` | 393-420 | Read all parts |
| `updateInventory` | 423-450 | Adjust stock |
| `getDashboard` | 453-520 | Today's summary |
| `handleLineWebhook` | 523-590 | LINE webhook router |
| `processSlipImage` | 593-700 | OCR + save slip |
| `handleTextMessage` | 703-770 | Parse LINE commands |
| `parseSlipData` | 773-860 | Extract slip fields |
| `updateDailyRevenue` | 863-895 | Update revenue sheet |
| `sendLineReply` | 898-910 | Reply via LINE API |
| `sendLineNotify` | 913-926 | Push notification |

---

## 4. Frontend — index.html

### 4.1 Single-File Architecture

ทุกอย่างอยู่ใน `PKNewEnergy/index.html` ไฟล์เดียว ประกอบด้วย:
- `<style>` — CSS ทั้งหมด
- `<body>` — HTML structure, แท็บ navigation, forms
- `<script>` — JavaScript ทั้งหมด (ไม่มี framework)

### 4.2 Global State

```javascript
// URL ของ GAS Web App (บันทึกใน localStorage)
const GAS_URL = localStorage.getItem("ev_gas_url");

// ข้อมูล user ที่ login อยู่
const currentUser = JSON.parse(localStorage.getItem("ev_user"));
// { username: "admin", role: "admin" }

// Cache ข้อมูล
let jobsCache = [];
let customersCache = [];
let inventoryCache = [];
```

### 4.3 localStorage Keys

| Key | Value | Purpose |
|-----|-------|---------|
| `ev_gas_url` | string (URL) | GAS endpoint |
| `ev_user` | JSON object | Logged-in user session |
| `ev_shop` | JSON object | Shop info (name, phone, addr) |
| `ev_line_config` | JSON object | LINE OA ID, booking link |
| `ev_gsheets_url` | string (URL) | Secondary Sheets for inventory sync |

### 4.4 Tab System

```javascript
function showTab(tabName) {
  // Hide all .tab-content divs
  // Show only the one matching tabName
  // Check role permissions before showing
}
```

แท็บหลัก: `dashboard`, `jobs`, `newjob`, `qc`, `customers`, `inventory`, `appointments`, `slips`, `revenue`, `settings`

### 4.5 API Communication Pattern

```javascript
// GET request
async function fetchJobs() {
  const res = await fetch(`${GAS_URL}?action=getJobs`);
  const data = await res.json();
  jobsCache = data.jobs;
  renderJobsTable(jobsCache);
}

// POST request
async function createJob(formData) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    body: JSON.stringify({ action: "createJob", ...formData })
  });
  const result = await res.json();
  if (result.success) showSuccess(`สร้างใบงาน ${result.jobId}`);
}
```

### 4.6 Print Functions

```javascript
function printJobOrder(jobId) {
  // Opens printable window with job details
  // Uses @media print CSS rules
}

function printReceipt(jobId) {
  // Similar but receipt format
}
```

### 4.7 Chart.js Integration

```javascript
// Revenue bar chart (in แท็บรายงาน)
const revenueChart = new Chart(ctx, {
  type: "bar",
  data: {
    labels: [...dates],      // Last 30 days
    datasets: [{
      label: "รายได้ (฿)",
      data: [...revenues]
    }]
  }
});
```

---

## 5. Database Schema

### Sheet 1: งานซ่อม (Jobs)

| Col | Header | Type | Example |
|-----|--------|------|---------|
| A | Job ID | string | `JOB-1715000000000` |
| B | วันที่สร้าง | date | `2026-05-07` |
| C | userId | string | `Uxxx...` (LINE User ID) |
| D | ชื่อลูกค้า | string | `สมชาย ใจดี` |
| E | เบอร์โทร | string | `081-234-5678` |
| F | ยี่ห้อรถ | string | `Tesla` |
| G | รุ่นรถ | string | `Model 3` |
| H | ทะเบียน | string | `กข-1234` |
| I | รายการซ่อม/ปัญหา | string | `แบตเตอรี่เสื่อม` |
| J | ราคาประเมิน (฿) | number | `15000` |
| K | ชั่วโมงประเมิน | number | `8` |
| L | หมายเหตุ | string | `ลูกค้าฝากรถ` |
| M | วันนัดหมาย | date | `2026-05-10` |
| N | สถานะ | string | `กำลังซ่อม` |
| O | ราคาจริง (฿) | number | `18000` |
| P | วันเสร็จ | date | `2026-05-15` |

**สถานะที่ใช้ได้:**
```
รอตรวจสอบ | กำลังตรวจสอบ | รออนุมัติราคา | รอซ่อม
รออะไหล่ | กำลังซ่อม | รอ QC | ผ่าน QC | รอชำระเงิน
ปิดงาน | ยกเลิก
```

### Sheet 2: ลูกค้า (Customers)

| Col | Header | Type |
|-----|--------|------|
| A | ชื่อลูกค้า | string |
| B | เบอร์โทร | string |
| C | ยี่ห้อรถ | string |
| D | รุ่นรถ | string |
| E | ทะเบียน | string |
| F | จำนวนครั้งที่ใช้บริการ | number |
| G | ครั้งล่าสุด | date |

**Dedup logic:** ตรวจสอบ Column A (ชื่อ) + Column B (เบอร์) ก่อนสร้างใหม่

### Sheet 3: คลังอะไหล่ (Inventory)

| Col | Header | Type |
|-----|--------|------|
| A | รหัสอะไหล่ | string |
| B | ชื่ออะไหล่ | string |
| C | หมวดหมู่ | string |
| D | จำนวนคงเหลือ | number |
| E | จำนวนขั้นต่ำ | number |
| F | ราคาต่อชิ้น (฿) | number |
| G | อัปเดตล่าสุด | datetime |

**Alert condition:** `D[row] <= E[row]` → trigger LINE Notify

### Sheet 4: สลิปโอนเงิน (Payment Slips)

| Col | Header | Type |
|-----|--------|------|
| A | Timestamp | datetime |
| B | วันที่สลิป | date |
| C | เวลา | time |
| D | เลขอ้างอิง | string (unique key) |
| E | จำนวนเงิน (บาท) | number |
| F | ธนาคาร | string |
| G | ผู้โอน | string |
| H | ผู้รับ | string |
| I | LINE User ID | string |
| J | Message ID | string |
| K | URL รูปสลิป | string |
| L | OCR Raw Text | string |

**Duplicate detection:** Column D (เลขอ้างอิง) ต้องไม่ซ้ำ

### Sheet 5: รายได้รายวัน (Daily Revenue)

| Col | Header | Type |
|-----|--------|------|
| A | วันที่ | date (unique key) |
| B | จำนวนสลิป | number |
| C | รายได้จากสลิป (฿) | number |
| D | รายได้จากงานซ่อม (฿) | number |
| E | รายได้รวม (฿) | number |
| F | อัปเดตล่าสุด | datetime |

**Update logic:** `upsert by date` — ถ้ามีแถววันนั้นแล้ว → อัปเดต, ไม่มี → สร้างใหม่

---

## 6. API Reference

### GET Endpoints

```
GET {GAS_URL}?action={action}
```

| Action | Response Shape | Notes |
|--------|--------------|-------|
| `ping` | `{ status, message, version }` | Health check |
| `getJobs` | `{ jobs: Job[] }` | All rows from งานซ่อม |
| `getCustomers` | `{ customers: Customer[] }` | All rows from ลูกค้า |
| `getInventory` | `{ inventory: Part[] }` | All rows from คลังอะไหล่ |
| `getDashboard` | `{ summary: DashboardData }` | Computed today's metrics |
| `getSlips` | `{ slips: Slip[] }` | All rows from สลิปโอนเงิน |
| `getRevenue` | `{ revenue: Revenue[] }` | All rows from รายได้รายวัน |

**Job Object:**
```json
{
  "jobId": "JOB-1715000000000",
  "date": "2026-05-07",
  "userId": "Uxxx",
  "customerName": "สมชาย",
  "customerPhone": "081-234-5678",
  "carBrand": "Tesla",
  "carModel": "Model 3",
  "carPlate": "กข-1234",
  "repairType": "แบตเตอรี่เสื่อม",
  "estimatedPrice": 15000,
  "estimatedHours": 8,
  "notes": "",
  "appointmentDate": "2026-05-10",
  "status": "กำลังซ่อม",
  "actualPrice": 0,
  "completedDate": ""
}
```

### POST Endpoints

```
POST {GAS_URL}
Content-Type: application/json
Body: { "action": "...", ...payload }
```

#### createJob

```json
{
  "action": "createJob",
  "customerName": "สมชาย ใจดี",
  "customerPhone": "081-234-5678",
  "carBrand": "Tesla",
  "carModel": "Model 3",
  "carPlate": "กข-1234",
  "repairType": "แบตเตอรี่เสื่อม",
  "estimatedPrice": 15000,
  "estimatedHours": 8,
  "appointmentDate": "2026-05-10",
  "notes": "",
  "userId": "Uxxx"
}
```
Response: `{ "success": true, "jobId": "JOB-1715000000000" }`

#### updateJobStatus

```json
{
  "action": "updateJobStatus",
  "jobId": "JOB-1715000000000",
  "status": "ปิดงาน",
  "actualPrice": 18000
}
```
Response: `{ "success": true }`

#### updateInventory

```json
{
  "action": "updateInventory",
  "partCode": "BAT-001",
  "qtyChange": -2
}
```
Response: `{ "success": true, "newQty": 8 }`

#### deleteSlip

```json
{
  "action": "deleteSlip",
  "refId": "REF20260507001"
}
```
Response: `{ "success": true }`

---

## 7. LINE Bot Integration

### 7.1 Webhook Setup

1. GAS deploy URL = LINE Webhook URL
2. `doPost(e)` รับ `e.postData.contents` เป็น JSON string
3. ตรวจจาก `body.events[0].type`

### 7.2 Text Message Routing (handleTextMessage)

```javascript
// ใน handleTextMessage(event)
const text = event.message.text.trim();

if (text.includes("ชื่อ:") && text.includes("รถ:")) {
  // Create job from formatted text
  parseAndCreateJobFromLine(text, userId);
}
else if (text === "ดูงาน") {
  // Reply last 5 jobs
}
else if (text === "รายได้") {
  // Reply today's revenue
}
else if (/^JOB-\d+$/.test(text)) {
  // Lookup specific job
}
else {
  // Default help message
}
```

### 7.3 Image Message Routing (processSlipImage)

```javascript
// event.message.type === "image"
async function processSlipImage(event) {
  const imageUrl = `https://api-data.line.me/v2/bot/message/${event.message.id}/content`;
  // 1. Download image from LINE
  const blob = downloadImage(imageUrl, LINE_CHANNEL_TOKEN);
  // 2. Save to Google Drive
  const driveUrl = saveToDrive(blob);
  // 3. OCR via Vision API
  const ocrText = callVisionAPI(blob);
  // 4. Parse slip data
  const slipData = parseSlipData(ocrText);
  // 5. Check duplicate
  if (isDuplicateSlip(slipData.refId)) { replyDuplicate(); return; }
  // 6. Save to Sheets
  saveSlipToSheet(slipData, driveUrl, event.source.userId);
  // 7. Update daily revenue
  updateDailyRevenue(slipData.amount, "slip");
  // 8. Reply confirmation
  replySlipConfirmation(event.replyToken, slipData);
  // 9. LINE Notify manager
  notifyManager(slipData);
}
```

### 7.4 Reply Format

```javascript
function sendLineReply(replyToken, messages) {
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post",
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_TOKEN}`,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: messages }]
    })
  });
}
```

### 7.5 LINE Notify

```javascript
function sendLineNotify(message) {
  UrlFetchApp.fetch("https://notify-api.line.me/api/notify", {
    method: "post",
    headers: { "Authorization": `Bearer ${LINE_NOTIFY_TOKEN}` },
    payload: `message=${encodeURIComponent(message)}`
  });
}
```

---

## 8. OCR Pipeline

### 8.1 Vision API Call

```javascript
function callVisionAPI(imageBlob) {
  const base64 = Utilities.base64Encode(imageBlob.getBytes());
  const response = UrlFetchApp.fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [{ type: "TEXT_DETECTION" }]
        }]
      })
    }
  );
  return JSON.parse(response.getContentText())
    .responses[0].fullTextAnnotation.text;
}
```

### 8.2 Slip Validation Keywords

สลิปต้องมีคำเหล่านี้อย่างน้อย 1 คำ:
```javascript
const successKeywords = [
  "โอนเงินสำเร็จ", "สำเร็จ", "success",
  "ทำรายการสำเร็จ", "ชำระเงินสำเร็จ"
];
```

### 8.3 Amount Extraction Patterns

```javascript
// Pattern priority (ลองตามลำดับ)
const amountPatterns = [
  /จำนวนเงิน[:\s]*([0-9,]+\.?[0-9]*)/,
  /จำนวน[:\s]*([0-9,]+\.?[0-9]*)/,
  /฿\s*([0-9,]+\.?[0-9]*)/,
  /([0-9,]+\.[0-9]{2})\s*บาท/,
];
// Parse: "1,234.56" → 1234.56
```

### 8.4 Bank Detection Map

```javascript
const bankMap = {
  "กสิกร": "KBANK", "KBANK": "KBANK", "KBank": "KBANK",
  "กรุงไทย": "KTB", "KTB": "KTB",
  "กรุงเทพ": "BBL", "BBL": "BBL",
  "ไทยพาณิชย์": "SCB", "SCB": "SCB",
  "ออมสิน": "GSB",
  "กรุงศรี": "BAY", "BAY": "BAY",
  "ทหารไทย": "TTB", "TMB": "TTB",
  "ธนชาต": "TTB",
  "ซิตี้แบงก์": "Citibank",
  "UOB": "UOB", "ยูโอบี": "UOB",
  "พร้อมเพย์": "PromptPay", "PROMPTPAY": "PromptPay",
};
```

### 8.5 Reference ID Extraction

```javascript
// Primary: ดึงจาก OCR text
const refPatterns = [
  /(?:Ref|Reference|เลขที่อ้างอิง|รายการที่)[.:\s]*([A-Z0-9]{8,})/i,
  /Transaction\s*ID[:\s]*([A-Z0-9]{8,})/i,
];

// Fallback: สร้าง fingerprint
if (!refId) {
  refId = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    `${amount}${date}${time}${bank}`
  ).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('').substring(0, 16);
}
```

---

## 9. Configuration & Secrets

### 9.1 Required Variables (Code.gs lines 9–12)

```javascript
const SPREADSHEET_ID     = "YOUR_GOOGLE_SHEET_ID";
const LINE_CHANNEL_TOKEN = "YOUR_LINE_CHANNEL_ACCESS_TOKEN";
const LINE_NOTIFY_TOKEN  = "YOUR_LINE_NOTIFY_TOKEN";
const VISION_API_KEY     = "YOUR_GOOGLE_CLOUD_VISION_API_KEY";
```

> **Security Note:** ตัวแปรเหล่านี้เก็บเป็น plaintext ใน Code.gs  
> ควรย้ายไปใช้ `PropertiesService.getScriptProperties()` ใน production:

```javascript
// แนะนำ: ใช้ Script Properties แทน
const props = PropertiesService.getScriptProperties();
const LINE_CHANNEL_TOKEN = props.getProperty("LINE_CHANNEL_TOKEN");
```

### 9.2 Getting Each Key

| Key | วิธีได้มา |
|-----|---------|
| SPREADSHEET_ID | URL ของ Google Sheet: `.../spreadsheets/d/{ID}/edit` |
| LINE_CHANNEL_TOKEN | LINE Developers → Messaging API → Channel access token |
| LINE_NOTIFY_TOKEN | [notify-bot.line.me/en_US/authorize](https://notify-bot.line.me/en_US/authorize) |
| VISION_API_KEY | Google Cloud Console → APIs → Cloud Vision API → Credentials |

### 9.3 Google Cloud Vision API Setup

1. ไปที่ [console.cloud.google.com](https://console.cloud.google.com)
2. สร้างหรือเลือก Project
3. ค้นหา "Cloud Vision API" → Enable
4. Credentials → Create Credentials → API Key
5. (Optional) Restrict key to Vision API + GAS IP

---

## 10. Role & Auth System

### 10.1 Authentication (Frontend Only)

```javascript
// Login
function login(username, password) {
  // ตรวจสอบกับ hardcoded user list หรือ localStorage
  if (isValidCredential(username, password)) {
    localStorage.setItem("ev_user", JSON.stringify({ username, role }));
    showDashboard();
  }
}

// Check on page load
window.onload = function() {
  const user = JSON.parse(localStorage.getItem("ev_user"));
  if (!user) showLoginScreen();
  else initDashboard(user);
};
```

> **Note:** Auth เป็นแบบ client-side เท่านั้น GAS ไม่มี authentication — ใครที่รู้ URL สามารถเรียก API ได้โดยตรง

### 10.2 Role-based Tab Visibility

```javascript
const tabPermissions = {
  "dashboard":    ["admin", "manager", "technician"],
  "jobs":         ["admin", "manager", "technician"],
  "newjob":       ["admin", "manager", "technician"],
  "qc":           ["admin", "manager", "qc"],
  "customers":    ["admin", "manager"],
  "inventory":    ["admin", "manager"],
  "appointments": ["admin", "manager", "technician"],
  "slips":        ["admin", "manager"],
  "revenue":      ["admin", "manager"],
  "settings":     ["admin"],
};

function canAccess(tabName, role) {
  return tabPermissions[tabName]?.includes(role) ?? false;
}
```

---

## 11. Testing & Debugging

### 11.1 Built-in Test Functions (Code.gs lines 898–926)

```javascript
// Run from GAS Editor → Run → testSheetConnection
function testSheetConnection() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log("Connected: " + ss.getName());
}

// Test OCR with sample image
function testOCR() {
  // Uses hardcoded test image URL
  const text = callVisionAPI(/* test blob */);
  Logger.log("OCR result: " + text);
}

// Test getDashboard response
function testDashboard() {
  const result = getDashboard();
  Logger.log(JSON.stringify(result, null, 2));
}
```

**วิธีรัน:**
1. เปิด GAS Editor
2. เลือก function จาก dropdown ด้านบน
3. กดปุ่ม ▶ Run
4. ดูผลใน **View → Logs** (Ctrl+Enter)

### 11.2 Ping Endpoint

```
GET {GAS_URL}?action=ping
```
Response: `{ "status": "ok", "message": "EV Garage API v3.0", "version": "3.0" }`

ถ้าตอบ 200 = GAS ทำงานปกติ

### 11.3 Debug Mode ใน Browser

เปิด DevTools (F12) → Console จะแสดง:
- Request/response logs
- Error messages
- Cache state

### 11.4 GAS Execution Log

```
GAS Editor → View → Executions
```
ดู:
- เวลา execution
- Function ที่รัน
- Error stack trace

### 11.5 Common Error Patterns

| Error | สาเหตุ | วิธีแก้ |
|-------|--------|--------|
| `{"error": "No action specified"}` | ไม่ได้ส่ง action ใน body | ตรวจ body.action |
| `CORS error` ใน browser | GAS ไม่รองรับ CORS headers | เปลี่ยนเป็น fetch no-cors หรือ proxy |
| `Exception: Spreadsheet not found` | SPREADSHEET_ID ผิด | ตรวจ ID ใน Code.gs |
| LINE reply 400 | replyToken หมดอายุ | replyToken ใช้ได้ครั้งเดียวใน 30 วิ |
| Vision API 403 | API Key ไม่ถูกต้อง / quota หมด | ตรวจ Cloud Console |

---

## 12. Deployment Guide

### 12.1 GAS Deployment

```
GAS Editor → Deploy → New Deployment
  Type:       Web App
  Execute as: Me (your Google account)
  Access:     Anyone

→ คัดลอก URL ที่ได้ (รูปแบบ: https://script.google.com/macros/s/{ID}/exec)
```

**สำคัญ:** ทุกครั้งที่แก้ Code.gs ต้อง **Deploy ใหม่** (New Deployment) ไม่ใช่แค่ Save

```
GAS Editor → Deploy → Manage Deployments → New version
```

### 12.2 LINE Webhook

```
LINE Developers → Your Channel → Messaging API
→ Webhook URL: {GAS_URL}
→ Use webhook: ON
→ Verify → ต้องได้ Status 200
```

### 12.3 HTML Dashboard Hosting

ไม่ต้องมี web server — เปิดไฟล์ `PKNewEnergy/index.html` ตรงจาก filesystem ได้เลย

ถ้าต้องการ host จริง:
- GitHub Pages (static)
- Netlify Drop
- Google Sites (embed)

### 12.4 Initialization

รัน `initSheets()` ครั้งแรกหลัง deploy:
```
GAS Editor → Select function: initSheets → Run
```
สร้าง 5 sheets พร้อม headers อัตโนมัติ

---

## 13. Known Limitations

### Scalability
- **Google Sheets limit:** ~5 million cells รวมทุก sheet
- **GAS quota:** 6 นาที/execution, 20,000 requests/day (free tier)
- **Vision API:** 1,000 requests/month (free tier)
- **Concurrency:** GAS ไม่รองรับ concurrent writes ดี — อาจ race condition ถ้าหลายคนเซฟพร้อมกัน

### Security
- **No backend auth:** GAS URL เป็น public — ใครมี URL เรียก API ได้เลย
- **Tokens in code:** LINE token อยู่ใน plaintext ใน Code.gs
- **Client-side auth only:** Role/permission check อยู่ฝั่ง browser เท่านั้น

### Functionality
- **No realtime:** Dashboard ต้อง refresh ด้วยตนเอง (ไม่มี WebSocket/polling)
- **No offline:** ต้องการ internet ตลอดเวลา
- **No audit log:** ไม่มีบันทึกว่าใครแก้อะไร เมื่อไหร่
- **LINE reply timeout:** GAS ต้องตอบกลับ LINE ภายใน 30 วินาที

### LINE Bot
- **No conversation state:** Bot ไม่จำ context ระหว่างข้อความ
- **Single reply only:** แต่ละ event reply ได้ครั้งเดียว

---

## 14. Development Conventions

### Code Style

```javascript
// ชื่อ function: camelCase ภาษาอังกฤษ
function processSlipImage(event) { }

// Constants: UPPER_SNAKE_CASE
const SHEET_JOBS = "งานซ่อม";

// ชื่อ sheet/column: ภาษาไทย (ตามที่ใช้ใน Sheets จริง)
const sheet = ss.getSheetByName("งานซ่อม");
const statusCol = 14; // Column N = สถานะ

// Error handling: try-catch ทุก external API call
try {
  const result = callVisionAPI(blob);
} catch (e) {
  Logger.log("Vision API error: " + e.message);
  return { success: false, error: e.message };
}
```

### Sheet Column Index Reference

```javascript
// งานซ่อม columns (1-indexed สำหรับ GAS getRange)
const COL_JOB = {
  JOB_ID:     1,   // A
  DATE:       2,   // B
  USER_ID:    3,   // C
  CUST_NAME:  4,   // D
  CUST_PHONE: 5,   // E
  CAR_BRAND:  6,   // F
  CAR_MODEL:  7,   // G
  CAR_PLATE:  8,   // H
  REPAIR:     9,   // I
  EST_PRICE:  10,  // J
  EST_HOURS:  11,  // K
  NOTES:      12,  // L
  APPT_DATE:  13,  // M
  STATUS:     14,  // N
  ACTUAL_PRICE: 15, // O
  DONE_DATE:  16,  // P
};
```

### Adding a New Feature Checklist

- [ ] เพิ่ม function ใน `Code.gs`
- [ ] เพิ่ม case ใน `doGet()` หรือ `doPost()` router
- [ ] เพิ่ม HTML element ใน `index.html`
- [ ] เพิ่ม JavaScript function ใน `index.html`
- [ ] เพิ่ม tab permission ถ้ามีแท็บใหม่
- [ ] อัปเดต `USER_MANUAL.md`
- [ ] อัปเดต `CODE_GUIDE.md`
- [ ] Deploy GAS ใหม่

---

## Appendix: GAS Helper Snippets

### Read all rows from sheet

```javascript
function getAllRows(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}
```

### Append row to sheet

```javascript
function appendRow(sheetName, rowData) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  sheet.appendRow(rowData);
}
```

### Find row by value in column

```javascript
function findRowByValue(sheetName, colIndex, value) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][colIndex - 1] === value) return i + 1; // 1-indexed row number
  }
  return -1;
}
```

### Return JSON response

```javascript
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

*เอกสารนี้จัดทำสำหรับนักพัฒนาที่ต้องการเข้าใจ, ดูแล, หรือต่อยอดระบบ EV Garage*  
*อัปเดตล่าสุด: พฤษภาคม 2026*
