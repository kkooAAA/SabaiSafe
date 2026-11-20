# Project Proposal: SabaiSafe

> **English summary (for agents):** SabaiSafe is an AI-powered web app prototype for foreign tourists in Phuket.
> It has 4 features: Legal Guide, Report Assistant (a Thai incident summary to support a police report), Fair Price, and Help & Trusted Services.
> It supports English and Chinese and shows legal sources. It does NOT file reports or take legal action on the user's behalf.
> Timeline: 12 weeks. Budget: 40,000 THB. Stack: Next.js, Supabase, Claude/OpenAI API, RAG, Vercel.
> Revenue: free core features; transparent, labelled sponsorship from tourism businesses, with neutral information.

---

## 1. Background and Objectives

นักท่องเที่ยวต่างชาติในภูเก็ต เผชิญความเสี่ยงจากการหลอกลวง การเอาเปรียบด้านราคา และบริการที่ไม่เป็นธรรม ขณะเดียวกันยังขาดความเข้าใจกฎหมายไทยและสิทธิของตนเอง อีกทั้งยังมีข้อจำกัดด้านภาษาและการเข้าถึงความช่วยเหลือ โครงการนี้จึงมุ่งพัฒนา Web Application ที่ใช้ AI เป็นเครื่องมือ เพื่อช่วยลดความเสี่ยง ให้ข้อมูลกฎหมาย และสนับสนุนในการขอความช่วยเหลือ

## 2. Target Audience

- **กลุ่มเป้าหมายหลัก:** นักท่องเที่ยวต่างชาติในภูเก็ตที่ไม่คุ้นเคยกับภาษา พื้นที่ และกฎหมาย
- **กลุ่มเป้าหมายทางธุรกิจ:** ผู้ประกอบการท่องเที่ยว เพื่อร่วมประชาสัมพันธ์ สนับสนุนข้อมูลราคา และบริการ

## 3. Innovation and Project Scope

พัฒนา Web Application Prototype ที่รวบรวม 4 ฟังก์ชันไว้ในแพลตฟอร์มเดียว

1. **Legal Guide:** ค้นหาข้อมูลกฎหมายและข้อห้ามตามสถานที่
2. **Report Assistant:** AI Chatbot ช่วยรวบรวม และสรุปเหตุการณ์เป็นภาษาไทยเพื่อประกอบการแจ้งความ
3. **Fair Price:** ตรวจสอบราคาอ้างอิงสินค้าและบริการจากข้อมูลภาครัฐและภาคสนาม
4. **Help & Trusted Services:** รวบรวมช่องทางขอความช่วยเหลือและแนะนำผู้ประกอบการที่ผ่านเกณฑ์เบื้องต้น

*ระบบรองรับภาษาอังกฤษและภาษาจีน พร้อมแสดงแหล่งอ้างอิงกฎหมาย โดยไม่ครอบคลุมการแจ้งความหรือดำเนินคดีแทนเจ้าหน้าที่*

## 4. Implementation Plan

| ระยะเวลา | ขั้นตอน | การดำเนินงาน | ผู้รับผิดชอบ |
|---|---|---|---|
| Week 1–2 | Research & Planning | ศึกษาปัญหาและความต้องการของนักท่องเที่ยว และรวบรวมข้อมูลที่เกี่ยวข้อง | ฝ่ายธุรกิจ และฝ่ายกฎหมาย |
| Week 3–4 | Requirement & Design | กำหนดฟังก์ชัน และออกแบบ UI/UX ต้นแบบ | ฝ่ายออกแบบ |
| Week 5–6 | App Development | พัฒนาระบบพื้นฐาน | ฝ่ายพัฒนาระบบ |
| Week 7–8 | Feature Development | พัฒนาระบบ Chatbot | ฝ่ายพัฒนาระบบ และฝ่ายกฎหมาย |
| Week 9–10 | Testing & Improvement | ทดสอบระบบ และปรับปรุงการใช้งาน | ทุกฝ่าย |
| Week 11 | User Feedback | ทดลองใช้งานกับกลุ่มเป้าหมาย และรวบรวมความคิดเห็น | ฝ่ายธุรกิจ |
| Week 12 | Final Presentation & Launch Preparation | สรุปผล และเตรียมความพร้อมสำหรับการเปิดตัวใช้งาน | ทุกฝ่าย |

**เครื่องมือที่ใช้:** Next.js, Supabase, Claude API หรือ OpenAI API, RAG และ Vercel

## 5. Budget

| รายการ | งบประมาณ (บาท) |
|---|---:|
| 1. Research & Data Collection | 3,000 |
| 2. UI/UX Design | 3,000 |
| 3. Prototype Development | 12,000 |
| 4. Chatbot & AI Tools | 5,000 |
| 5. Legal Information | 4,000 |
| 6. Hosting & Database | 2,000 |
| 7. Testing & Survey | 3,000 |
| 8. Marketing & Presentation | 3,000 |
| 9. Contingency Budget | 5,000 |
| **รวมทั้งหมด** | **40,000** |

## 6. Business Model and Sustainability

โครงการนี้จะเปิดให้ใช้งานฟังก์ชันพื้นฐานฟรี และต่อยอดรายได้ผ่านความร่วมมือกับผู้ประกอบการท่องเที่ยว เช่น โรงแรม บริษัทให้เช่ายานพาหนะ ในรูปแบบประชาสัมพันธ์ โดยเปิดเผยการสนับสนุนอย่างชัดเจน และรักษาความเป็นกลางของข้อมูล เพื่อสร้างรายได้และขยายการให้บริการในระยะยาว

## 7. Conclusion

โครงการนี้มุ่งแก้ปัญหาด้านกฎหมายและความปลอดภัยของนักท่องเที่ยวต่างชาติ ผ่านการพัฒนาต้นแบบ LegalTech ที่ผสานเทคโนโลยี AI ภายใน 12 สัปดาห์ ด้วยงบประมาณ 40,000 บาท เพื่อยกระดับการคุ้มครองสิทธิ สร้างความเชื่อมั่น และต่อยอดสู่ระบบนิเวศการท่องเที่ยวที่ปลอดภัยและเป็นธรรม
