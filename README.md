# Doctor Appointment Tracker

แอปบันทึกใบนัดแพทย์แบบเปิดไฟล์ HTML ได้ทันที รองรับ OCR จากรูปใบนัด, จัดกลุ่มรายการในใบเดียวกัน, ดูแบบรายการและปฏิทิน, แนบรูปใบนัด, ซิงก์ Google Sheet, เก็บรูปใน Google Drive และสร้าง Google Calendar ผ่าน Google Apps Script

## วิธีเปิดใช้งาน

เปิดไฟล์ `index.html` ด้วยเบราว์เซอร์

## การเชื่อม Google

1. สร้าง Google Sheet
2. เปิด Extensions > Apps Script
3. วางโค้ดจาก `apps-script.js`
4. Deploy เป็น Web app แล้วให้สิทธิ์เข้าถึง Calendar และ Drive
5. นำ Web App URL มาใส่ในแอป

## ไฟล์หลัก

- `index.html` หน้าแอป
- `app.js` logic ของแอป, OCR, Calendar view และปุ่มซิงก์
- `styles.css` หน้าตาแอป
- `apps-script.js` backend สำหรับ Google Sheet, Drive และ Calendar
