# EV Garage Management System — P&K New Energy

> ระบบบริหารจัดการอู่ซ่อมรถยนต์ไฟฟ้าครบวงจร  
> Version 3.0 | Google Apps Script + Google Sheets + LINE Bot + Vision API OCR

Full-stack EV repair shop management: LINE Bot + Slip OCR → Google Apps Script → Google Sheets → HTML Dashboard.

---

## System Overview

```
LINE Customer ──► LINE Messaging API ──► GAS doPost()
                                              │
                                    Google Sheets (3 tabs)
                                              │
HTML Dashboard ◄──── GAS doGet() ────────────┘
HTML Dashboard ────► GAS doPost() ──► Sheets
```

---

## Features

| Module | Features |
|---|---|
| **Dashboard** | Live metrics: jobs today, in-progress, done, daily revenue |
| **งานซ่อม** | Full CRUD table, search/filter, status update, receipt print |
| **ลูกค้า** | Auto-created from job form, searchable, visit count |
| **คลังอะไหล่** | Low-stock warnings, LINE Notify alert, Excel import |
| **QC** | Inspection form, pass/fail, QC-only role view |
| **นัดหมาย** | Calendar + list view, LINE booking integration |
| **สลิปโอนเงิน** | OCR via Vision API, duplicate detection, auto revenue update |
| **รายงาน** | Monthly revenue chart (Chart.js), per-day breakdown |
| **LINE Bot** | Receive job via text, reply with Job ID, status lookup |
| **LINE Notify** | New job alert, job complete alert, low-stock alert |

---

## เอกสารเพิ่มเติม

| ไฟล์ | คำอธิบาย |
|------|---------|
| [USER_MANUAL.md](./USER_MANUAL.md) | คู่มือการใช้งานสำหรับผู้ใช้ทุกระดับ |
| [CODE_GUIDE.md](./CODE_GUIDE.md) | คู่มือสำหรับนักพัฒนา / Technical Reference |

---

## Files

```
Code.gs                   — Google Apps Script backend
ev_service_system_v2.html — Frontend dashboard (standalone HTML)
README.md
```

---

## How to Run

### Step 1 — Google Sheet

1. Create a new Google Sheet
2. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/**SHEET_ID**/edit`

### Step 2 — Google Apps Script

1. Open the Sheet → **Extensions → Apps Script**
2. Delete any existing code → paste `Code.gs`
3. Fill in the top config section:
   ```js
   const SPREADSHEET_ID     = "YOUR_SHEET_ID";
   const LINE_CHANNEL_TOKEN = "YOUR_CHANNEL_ACCESS_TOKEN"; // from LINE Developers
   const LINE_NOTIFY_TOKEN  = "YOUR_NOTIFY_TOKEN";         // optional
   ```
4. Click **Deploy → New Deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy** → copy the **Web App URL**

### Step 3 — LINE Bot Webhook

1. Go to [LINE Developers Console](https://developers.line.biz/)
2. Select your Messaging API channel
3. Set Webhook URL = your GAS Web App URL
4. Enable **Use webhook**
5. Click **Verify** — should return 200 OK

### Step 4 — HTML Dashboard

1. Open `ev_service_system_v2.html` in any browser (no server needed)
2. Go to **⚙ ตั้งค่า** tab
3. Paste your GAS Web App URL → click **บันทึก URL**
4. Data loads automatically

---

## Google Sheets Structure

Three sheets are auto-created on first use:

**งานซ่อม** — Job ID, วันที่สร้าง, userId, ชื่อลูกค้า, เบอร์โทร, ยี่ห้อรถ, รุ่นรถ, ทะเบียน, รายการซ่อม, ราคาประเมิน, ชั่วโมงประเมิน, หมายเหตุ, วันนัดหมาย, สถานะ, ราคาจริง, วันเสร็จ

**ลูกค้า** — ชื่อลูกค้า, เบอร์โทร, ยี่ห้อรถ, รุ่นรถ, ทะเบียน, จำนวนครั้ง, ครั้งล่าสุด

**คลังอะไหล่** — รหัสอะไหล่, ชื่ออะไหล่, หมวดหมู่, จำนวนคงเหลือ, จำนวนขั้นต่ำ, ราคา/ชิ้น, อัปเดตล่าสุด

---

## LINE Bot Message Format

Send to the bot in this format to create a job:

```
ชื่อ: สมชาย | รถ: Tesla Model 3 | ปัญหา: แบตเตอรี่อ่อน | โทร: 081-234-5678
```

Send `ดูงาน` to get the last 5 jobs.

---

## API Reference

| Method | Params | Description |
|---|---|---|
| GET | `?action=getJobs` | All jobs |
| GET | `?action=getCustomers` | All customers |
| GET | `?action=getInventory` | Inventory |
| GET | `?action=getDashboard` | Today's summary |
| POST | `{ action: "createJob", ...fields }` | Create job |
| POST | `{ action: "updateJobStatus", jobId, status, actualPrice }` | Update status |
| POST | `{ action: "updateInventory", partCode, qtyChange }` | Adjust stock |
