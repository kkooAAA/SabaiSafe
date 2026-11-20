// The ONLY phone numbers the app may show or the AI may mention without a verified DB source.
// Source: CLAUDE.md (non-negotiable rules). Do not add numbers here without the lead's approval.
export const HOTLINES = [
  { key: "tourist_police", number: "1155", name_en: "Tourist Police", name_zh: "旅游警察", name_th: "ตำรวจท่องเที่ยว" },
  { key: "police", number: "191", name_en: "Police (emergency)", name_zh: "报警电话", name_th: "แจ้งเหตุด่วนเหตุร้าย" },
  { key: "ambulance", number: "1669", name_en: "Ambulance / medical emergency", name_zh: "急救电话", name_th: "การแพทย์ฉุกเฉิน" },
  { key: "consumer", number: "1166", name_en: "Consumer Protection Board (OCPB)", name_zh: "消费者保护委员会", name_th: "สำนักงานคณะกรรมการคุ้มครองผู้บริโภค (สคบ.)" },
] as const;

export type HotlineKey = (typeof HOTLINES)[number]["key"];
export const HOTLINE_NUMBERS: readonly string[] = HOTLINES.map((h) => h.number);
