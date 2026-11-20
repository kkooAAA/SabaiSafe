// Shared fixtures for the Report Assistant tests (contracts §3.2–3.5a).
import type { ChatMessage, ReportFacts } from "@/types/api";

/** PII that must never reach the model, the generated output, or storage. */
export const PII = {
  passportToken: "AB1234567",
  passportAfterWord: "123456789", // after "passport no."
  passportZh: "E12345678", // after 护照号
  thaiMobileIntl: "+66 81 234 5678",
  thaiMobile: "081-234-5678",
  thaiLandline: "076 123 456",
  cnMobile: "13800138000",
  cnMobileIntl: "+86 138 0013 8000",
  email: "tourist.name+trip@example.com",
} as const;

/** Must be KEPT verbatim (hotlines, amounts, the fact itself). */
export const KEEP = ["1155", "191", "1669", "1166", "5,000 baht", "kept my passport"] as const;

export const PII_TEXT =
  `The rental shop kept my passport as a deposit. My passport no. ${PII.passportAfterWord}, the other one is ${PII.passportToken}. ` +
  `护照号 ${PII.passportZh}. Call me on ${PII.thaiMobileIntl} or ${PII.thaiMobile}, the shop is ${PII.thaiLandline}, ` +
  `my friend ${PII.cnMobile} / ${PII.cnMobileIntl}, email ${PII.email}. They demanded 5,000 baht. ` +
  `I already called 1155 and 191; the ambulance is 1669 and consumer protection 1166.`;

/** Every raw PII value (and digit-runs of them) that must be absent from `s`. */
export function leakedPii(s: string): string[] {
  const digitsOnly = s.replace(/\D/g, " ");
  const leaks: string[] = Object.values(PII).filter((v) => s.includes(v));
  for (const v of Object.values(PII)) {
    const d = v.replace(/\D/g, "");
    if (d.length >= 8 && digitsOnly.includes(d)) leaks.push(`digits:${d}`);
  }
  // Also catch a reformatted number: the 8+ digit run with separators removed.
  const compact = s.replace(/[\s-]/g, "");
  for (const v of [PII.thaiMobile, PII.cnMobile, PII.thaiLandline]) {
    const d = v.replace(/\D/g, "");
    if (compact.includes(d)) leaks.push(`compact:${d}`);
  }
  return [...new Set(leaks)];
}

/** Alternating user/assistant conversation of `n` messages starting with user, each `len` chars. */
export function conversation(n: number, len = 10): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: (i % 2 === 0 ? "u" : "a").repeat(len),
  }));
}

export const INTERVIEW: ChatMessage[] = [
  { role: "user", content: `A jet ski operator in Patong says I damaged the jet ski. ${PII_TEXT}` },
  { role: "assistant", content: "When did it happen?" },
  { role: "user", content: "Yesterday afternoon at Patong Beach." },
  { role: "assistant", content: "Here is what I understood... Is this correct?" },
  { role: "user", content: "yes" },
];

export const FACTS: ReportFacts = {
  incident_type: "damage_claim",
  incident_summary_en: `The operator kept my passport ${PII.passportToken} and demanded 5,000 baht. Call ${PII.thaiMobile}.`,
  date: "2026-11-14",
  time: "approx. afternoon",
  location: "Patong Beach",
  parties: [{ role: "business", name: "Jet ski stand", description: `owner phone ${PII.thaiMobileIntl}, ${PII.email}`, vehicle_plate: null }],
  money: { amount: 5000, currency: "THB", type: "demanded", payment_method: "cash" },
  evidence: ["photos", `LINE chat with ${PII.cnMobile}`],
  witnesses: null,
  user_goal: "get my passport back",
  reporter: { nationality: "Chinese", name: null },
};

export const TH_HEADING = "## ฉบับภาษาไทย (สำหรับเจ้าหน้าที่)";
export const EN_HEADING = "## English translation (for you to check)";

export const MARKDOWN = [
  TH_HEADING,
  "**เรื่อง:** สรุปเหตุการณ์เพื่อประกอบการแจ้งความ",
  "**รายละเอียดเหตุการณ์:** ผู้แจ้งระบุว่าผู้ประกอบการเรียกเงิน 5,000 บาท และยึดหนังสือเดินทางไว้",
  "",
  EN_HEADING,
  "**Subject:** Incident summary to support a police report",
  "**Details:** The reporter states that the operator demanded 5,000 baht and kept the passport. 游客护照被扣押。",
].join("\n");

export async function jsonOf<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export function jsonRequest(url: string, body: unknown, init: RequestInit = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
