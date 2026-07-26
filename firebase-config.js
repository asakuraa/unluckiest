// ==========================================================================
// ใส่ค่าจาก Firebase Console ตรงนี้ (Project settings > General > Your apps > SDK setup)
// ถ้ายังไม่มี Firebase project หรือยังไม่กรอก apiKey — แอปจะใช้ localStorage แทนอัตโนมัติ
// (ใช้งานได้ปกติ แค่ข้อมูลจะไม่ sync ข้ามเครื่อง/ไม่แชร์กับคนอื่น)
//
// วิธีได้ค่าพวกนี้:
// 1. ไปที่ https://console.firebase.google.com > สร้างโปรเจกต์ใหม่ (ฟรี)
// 2. เปิด "Realtime Database" (เลือก location ใกล้ ๆ เช่น asia-southeast1) เริ่มด้วย test mode ก่อนได้
// 3. เปิด "Authentication" > Sign-in method > เปิด "Anonymous"
// 4. Project settings (รูปเฟือง) > General > เลื่อนลงมา "Your apps" > เลือก Web (</>) > copy config
// 5. เอา databaseURL, apiKey ฯลฯ มาแปะแทนที่ค่าว่างด้านล่าง แล้ว push ขึ้น GitHub ได้เลย
//    (apiKey ของ Firebase ฝั่ง client ไม่ใช่ความลับ ความปลอดภัยจริงอยู่ที่ Security Rules ใน database.rules.json)
// ==========================================================================

const firebaseConfig = {
  apiKey: "AIzaSyDKcdgmWSfTvSzoSIwiSYH60w7QhTM3-oM",
  authDomain: "unluckiest-is-mine.firebaseapp.com",
  databaseURL: "https://unluckiest-is-mine-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "unluckiest-is-mine",
  storageBucket: "unluckiest-is-mine.firebasestorage.app",
  messagingSenderId: "408163032952",
  appId: "1:408163032952:web:9f2ec1125acf5c2bee728d"
};

// ไม่ต้องแก้บรรทัดล่างนี้ — เช็คอัตโนมัติว่ากรอก config ครบหรือยัง
window.FIREBASE_CONFIG = firebaseConfig;
window.FIREBASE_ENABLED = Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL);
