# EV Garage Management System — P&K New Energy

> ระบบบริหารจัดการอู่ซ่อมรถยนต์ไฟฟ้าครบวงจร
> Version 3.1 | HTML Dashboard + Google Apps Script + Google Sheets + LINE Booking + Slip OCR

Full-stack EV repair shop management for P&K New Energy: รับงานซ่อม, วินิจฉัย, เสนอราคา, ซ่อม/ทดสอบ, QC, ชำระเงิน, ใบเสร็จ PDF, บัญชี และนัดหมาย LINE ในหน้า Dashboard เดียว.

---

## System Overview

```
Customer / LINE Booking ──► HTML Dashboard ──► GAS Web App
                                      │              │
                                      │              ▼
                                      └──────► Google Sheets
                                                     │
Accounting / Receipt / QC ◄────────── Dashboard ◄────┘
```

---

## Main Workflow

ระบบออกแบบเป็นขบวนการทำงานตามสถานะใบงาน เพื่อให้ทีมรับรถ ช่าง QC และบัญชีทำงานต่อเนื่องกันได้

| ขั้นตอน | สถานะหลัก | สิ่งที่ทำในระบบ |
|---|---|---|
| 1. รับงาน | รอตรวจสอบ | กรอกข้อมูลลูกค้า รถ ทะเบียน อาการ ราคาประเมินเบื้องต้น และวันนัด |
| 2. วินิจฉัย | รอวินิจฉัย / กำลังวินิจฉัย | บันทึกสาเหตุ อะไหล่ที่ต้องใช้ แผนการซ่อม และช่างผู้รับผิดชอบ |
| 3. เสนอราคา | รออนุมัติราคา | แยกกรอก **ค่าแรง**, **ค่าอะไหล่**, ส่วนลด และเงื่อนไขใบเสนอราคา |
| 4. อนุมัติราคา | รอซ่อม | Manager/Admin อนุมัติราคา แล้วส่งงานเข้าคิวซ่อม |
| 5. ซ่อม/ทดสอบ | กำลังซ่อม / รอ QC | บันทึกขั้นตอนซ่อม ผลทดสอบ Before/After และข้อมูลเทคนิค |
| 6. QC | ผ่าน QC / ส่งซ่อมใหม่ | QC Inspector ตรวจ checklist, pass/fail และสร้างรายงาน QC PDF |
| 7. ชำระเงิน | รอชำระเงิน | บันทึกเงินสด/โอน/มัดจำ/ชำระบางส่วน แนบสลิป และตรวจ OCR ได้ |
| 8. ปิดงาน | ปิดงาน | ปิดงานและออกใบเสร็จรับเงินสำหรับพิมพ์หรือ Save as PDF |
| 9. บัญชี | service_invoice | ระบบแยกรายรับค่าแรง รายรับอะไหล่ ต้นทุนอะไหล่ และกำไรอัตโนมัติ |

---

## Receipt / PDF Process

ใบเสร็จรับเงินใช้ปุ่ม **ใบเสร็จ** หรือ **ปิดงาน + ออกใบเสร็จ** แล้วใช้หน้าต่าง Print ของ browser เพื่อพิมพ์หรือ Save as PDF

ใบเสร็จเวอร์ชันล่าสุดแยกรายการชัดเจนสำหรับงานบัญชี:

| รายการในใบเสร็จ | แหล่งข้อมูล |
|---|---|
| ค่าแรง | ฟิลด์ `ค่าแรง` จาก tab เสนอราคา |
| ค่าอะไหล่ | ฟิลด์ `ค่าอะไหล่` จาก tab เสนอราคา |
| ส่วนลด | ฟิลด์ `ส่วนลด` จาก tab เสนอราคา |
| ยอดสุทธิ | ค่าแรง + ค่าอะไหล่ - ส่วนลด |
| รับชำระแล้ว | `paid_amount` หรือ `ราคาจริง (฿)` |
| วิธีชำระเงิน | เงินสด, โอนเงิน, มัดจำ, หรือชำระบางส่วน |
| เลขอ้างอิงโอน | ฟิลด์เลขอ้างอิงใน tab ชำระเงิน |

ข้อควรทำก่อนออกใบเสร็จ:

1. กรอกค่าแรงและค่าอะไหล่ใน tab **เสนอราคา** ให้ครบ
2. ให้ Manager/Admin อนุมัติราคา
3. ให้ QC ผ่านก่อนรับชำระเงิน
4. บันทึกยอดชำระและวิธีชำระเงินใน tab **ชำระเงิน**
5. กด **ปิดงาน + ออกใบเสร็จ** หรือเปิดงานที่ปิดแล้วแล้วกดปุ่มใบเสร็จ
6. ในหน้าต่าง Print เลือก printer หรือเลือก **Save as PDF**

---

## Features

| Module | Features |
|---|---|
| **Dashboard** | Live metrics: งานวันนี้, งานกำลังซ่อม, งานรอ QC, รายได้ และสรุปการเงิน |
| **งานซ่อม** | ค้นหา/กรองใบงาน, เปิดรายละเอียด, pipeline สถานะ, ใบงาน, ใบเสร็จ, แสดงคอลัมน์ **วันนัด** ในตารางรายการงาน |
| **เสนอราคา** | แยกค่าแรง, ค่าอะไหล่ขาย, ต้นทุนอะไหล่อัตโนมัติ, กำไรอะไหล่, ส่วนลด |
| **ชำระเงิน** | บันทึกชำระเงินหลายครั้ง, โอน/เงินสด/มัดจำ/บางส่วน, แนบสลิป, OCR สลิป |
| **ใบเสร็จ PDF** | พิมพ์หรือ Save as PDF โดยแยกค่าแรงและค่าอะไหล่ในตารางรายการ |
| **ลูกค้า** | Auto-created from job form, searchable, visit count |
| **คลังอะไหล่** | Low-stock warnings, stock value, inventory update |
| **QC** | EV checklist, pass/fail, QC report PDF, QC-only role view |
| **นัดหมาย** | Calendar + list view, LINE booking integration |
| **บัญชี** | Auto split labor revenue, parts revenue, parts cost, parts gross profit, CSV export |
| **ตั้งค่า** | GAS URL, shop info, LINE config, users and roles |

---

## เอกสารเพิ่มเติม

| ไฟล์ | คำอธิบาย |
|------|---------|
| [USER_MANUAL.md](./USER_MANUAL.md) | คู่มือการใช้งานสำหรับผู้ใช้ทุกระดับ |
| [CODE_GUIDE.md](./CODE_GUIDE.md) | คู่มือสำหรับนักพัฒนา / Technical Reference |

---

## Files

```
index.html       — Frontend dashboard แบบ standalone HTML
README.md        — ภาพรวมระบบและขบวนการใช้งาน
USER_MANUAL.md   — คู่มือผู้ใช้
CODE_GUIDE.md    — คู่มือนักพัฒนา / technical reference
```

> หมายเหตุ: Backend Google Apps Script ใช้ผ่าน GAS Web App URL ที่ตั้งค่าในหน้า Dashboard

---

## How to Run

### Step 1 — Google Sheet

1. Create a new Google Sheet
2. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/**SHEET_ID**/edit`

### Step 2 — Google Apps Script

1. Open the Sheet → **Extensions → Apps Script**
2. Paste or update backend Apps Script code
3. Fill in required config such as Spreadsheet ID, LINE token, and shop settings
4. Click **Deploy → New Deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone** or according to shop policy
5. Click **Deploy** → copy the **Web App URL**

### Step 3 — HTML Dashboard

1. Open `index.html` in a browser
2. Login with a configured user
3. Go to **ตั้งค่า**
4. Paste GAS Web App URL → click **บันทึก URL**
5. Refresh data and start using the workflow

### Step 4 — LINE / Booking Setup

1. Go to LINE Developers Console
2. Select Messaging API channel
3. Set Webhook URL = GAS Web App URL
4. Enable **Use webhook**
5. Configure LINE OA / booking link in the Dashboard settings

---

## Google Sheets Structure

Sheets are created or updated by backend actions. Main data groups include:

**งานซ่อม** — Job ID, วันที่สร้าง, วันนัด, ชื่อลูกค้า, เบอร์โทร, ยี่ห้อรถ, รุ่นรถ, ทะเบียน, รายการซ่อม / ปัญหา, หมายเหตุ, สถานะ, ค่าแรง, ค่าอะไหล่, ส่วนลด, ราคาประเมิน (฿), ราคาจริง (฿), paid_amount, payment_history, วิธีชำระเงิน, เลขอ้างอิงโอน, URL สลิป, วันเสร็จ

**ลูกค้า** — ชื่อลูกค้า, เบอร์โทร, ยี่ห้อรถ, รุ่นรถ, ทะเบียน, จำนวนครั้งที่ใช้บริการ, ครั้งล่าสุด

**คลังอะไหล่** — รหัสอะไหล่, ชื่ออะไหล่, หมวดหมู่, จำนวนคงเหลือ, จำนวนขั้นต่ำ, ราคา/ชิ้น, อัปเดตล่าสุด

**นัดหมาย** — วันที่, เวลา, ลูกค้า, เบอร์โทร, รถ, ทะเบียน, ประเภทงาน, แหล่งที่มา, สถานะ

**บัญชี** — วันที่, ประเภท, หมวดหมู่, รายละเอียด, อ้างอิง, จำนวน, บันทึกโดย, source

---

## Roles

| Role | สิทธิ์หลัก |
|---|---|
| Admin | เข้าถึงทุกเมนู ตั้งค่า users และอนุมัติราคา |
| Manager | อนุมัติราคา ดูบัญชี และติดตามงาน |
| Tech | ทำงานซ่อม วินิจฉัย บันทึกผลซ่อม |
| QC | ตรวจ QC และออกรายงาน QC |
| Front Desk | รับงาน นัดหมาย และติดตามสถานะลูกค้า |

---

## API Reference

| Method | Params | Description |
|---|---|---|
| GET | `?action=getJobs` | Load all jobs |
| GET | `?action=getCustomers` | Load customers |
| GET | `?action=getInventory` | Load inventory |
| GET | `?action=getDashboard` | Load dashboard summary |
| GET | `?action=getAppointments` | Load appointments |
| POST | `{ action: "createJob", ...fields }` | Create job |
| POST | `{ action: "updateJob", jobId, fields }` | Update job fields |
| POST | `{ action: "updateJobStatus", jobId, status }` | Update job status |
| POST | `{ action: "updateInventory", partCode, qtyChange }` | Adjust stock |
| POST | `{ action: "createAppointment", ...fields }` | Create appointment |
| POST | `{ action: "updateAppointment", ...fields }` | Update appointment |
| POST | `{ action: "deleteAppointment", id }` | Delete appointment |

---

## Changelog

### 2026-07-29

- เพิ่มคอลัมน์ **วันนัด** ในตารางหน้า **งานซ่อม** (ต่อจากคอลัมน์วันที่สร้าง) เพื่อให้เห็นวันนัดหมายของแต่ละใบงานได้จากหน้ารายการโดยไม่ต้องเปิดรายละเอียด
- ปรับ `colspan` ของแถว loading / empty-state ในตารางงานซ่อมจาก 9 เป็น 10 ให้ตรงกับจำนวนคอลัมน์ใหม่

### 2026-07-01

- Updated receipt print/PDF layout to separate **ค่าแรง** and **ค่าอะไหล่** clearly
- Added receipt totals: subtotal, discount, net total, paid amount, and balance
- Documented end-to-end workflow from job intake to accounting automation