# Gacha Luck Tracker (Monster Strike)

เว็บสำหรับคำนวณ EV ต่อโรล เก็บ log การเปิดกาชา และเทียบ "ดวง" ระหว่างผู้เล่นด้วย z-score
รันเป็น static site ล้วน ๆ (HTML/CSS/JS) — เอาไปใส่ GitHub Pages ได้ทันที

## ใช้งานทันที (ยังไม่ต้องมี Firebase)

เปิด `index.html` ตรง ๆ หรือ push ขึ้น GitHub Pages ได้เลย ระบบจะเก็บข้อมูลใน
`localStorage` ของเบราว์เซอร์เครื่องนั้นอัตโนมัติ — ใช้งานได้ปกติทุกฟีเจอร์
แค่ข้อมูลจะไม่ sync ข้ามเครื่อง/ไม่แชร์กับคนอื่น

## เปิดโหมดแชร์ข้อมูลกันแบบสด (Firebase Realtime Database)

1. ไปที่ https://console.firebase.google.com → สร้างโปรเจกต์ใหม่ (ฟรี)
2. เมนูซ้าย → **Build → Realtime Database** → Create Database → เลือก location (เช่น
   `asia-southeast1`) → เริ่มด้วย "test mode" ไปก่อนได้ (จะ lock ด้วย rules ในขั้นตอนถัดไป)
3. เมนูซ้าย → **Build → Authentication** → Sign-in method → เปิดใช้ **Anonymous**
   (ผู้ใช้ไม่ต้อง login เอง ระบบ sign-in เงียบ ๆ ให้ตอนเปิดหน้าเว็บ)
4. ไอคอนเฟือง (Project settings) → General → เลื่อนลง "Your apps" → กด `</>` (Web) →
   ตั้งชื่อ app → จะได้ config object มา
5. เปิดไฟล์ `firebase-config.js` ในโปรเจกต์นี้ → แทนที่ค่าว่างด้วยค่าที่ได้จากข้อ 4
   (apiKey ของ Firebase ฝั่ง client ไม่ใช่ความลับ ไม่ต้องกลัวหลุด — ความปลอดภัยจริงอยู่ที่ rules ข้อถัดไป)
6. Realtime Database → แท็บ **Rules** → copy เนื้อหาจากไฟล์ `database.rules.json`
   ในโปรเจกต์นี้ไปแปะแทนของเดิม → Publish
   - อนุญาตอ่าน/เขียนเฉพาะคนที่ auth แล้ว (anonymous ก็นับ)
   - `rollLog` และ `pullLog` ถูกล็อกเป็น **append-only** — เขียนใหม่ได้ แต่แก้ของเดิมที่มีอยู่แล้วไม่ได้
     (ให้ตรงกับที่คุยกันว่าอยากได้ audit trail แบบย้อนหลังไม่ได้)
7. push โค้ดทั้งหมด (รวม `firebase-config.js` ที่กรอกค่าแล้ว) ขึ้น GitHub → เปิด
   Settings → Pages → เลือก branch → เสร็จ

หลังจากนี้หัวเว็บ (มุมขวาบน) จะขึ้น "ออนไลน์ (Firebase)" แทน "โหมดเครื่องนี้เครื่องเดียว"
และใครก็ตามที่เปิดลิงก์ GitHub Pages เดียวกันจะเห็นข้อมูลเดียวกันแบบ realtime

## โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | โครงหน้าเว็บ 4 แท็บ: แดชบอร์ด / บันทึกโรล / บันทึกตัวที่ได้ / ตั้งค่า |
| `style.css` | ธีมสี navy + gold |
| `app.js` | logic ทั้งหมด: สูตรคะแนน, EV, z-score, การอ่าน/เขียนข้อมูล (Firebase หรือ localStorage) |
| `firebase-config.js` | ค่า config ของ Firebase project (แก้ตรงนี้ที่เดียว) |
| `database.rules.json` | กติกาความปลอดภัย เอาไปแปะใน Firebase Console → Rules |

## โมเดลคะแนน (ตั้งค่าได้ทั้งหมดในแท็บ "ตั้งค่า")

- **EV/โรล** = อัตราออกของตู้ (%) × Base score ของประเภทที่เลือกไว้เป็นตัวคิด EV (ปกติคือ Collab)
- **คะแนนตัวละคร 1 ตัว** = (Base + Meta bonus [ถ้าติ๊ก]) × Dup weight
  + (Difficulty bonus ของด่าน + Monthly point [ถ้าด่านนั้น monthly]) × Difficulty-dup weight
- **Z-score** ต่อผู้เล่น = (จำนวนที่ออกจริงของ EV-category − จำนวนที่คาดหวัง) ÷ ค่าเบี่ยงเบนมาตรฐาน
  (คำนวณจาก binomial distribution: rolls × rate × (1-rate)) — ใช้อันดับนี้เทียบความซวยข้ามคนที่โรลไม่เท่ากันได้แม่นยำกว่าเทียบส่วนต่างแต้มดิบ
- ด่านยาก (เช่น หอดาว) ตั้งค่าได้ในแท็บ "ตั้งค่า" → "รายการด่านยาก": ตั้งชื่อ, weight 0-1
  (คูณกับ difficulty bonus สูงสุด), และติ๊ก Monthly ถ้าเป็นด่านที่มาทุกเดือน

## ข้อจำกัดที่ควรรู้

- ไม่มี version history/rollback อัตโนมัติแบบ git — ของ log (`rollLog`, `pullLog`) เป็น
  append-only ตาม rules แต่ `settings` (ค่าตู้/base score/รายการด่าน) เขียนทับได้ปกติ ถ้าอยากมี
  ประวัติการแก้ settings ย้อนหลังด้วย ต้องเพิ่ม logic เก็บ snapshot เองภายหลัง
- Firebase free tier (Spark) พอสำหรับกลุ่มเล็ก ๆ ใช้กันเอง ถ้าจำนวน read/write เกิน
  free quota ต้องอัปเกรดเป็น Blaze (pay-as-you-go)
