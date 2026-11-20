// Pure helpers for the Report Assistant UI (contracts §3.2–3.5a). No React, no fetch: unit-testable by qa.
import {
  CONSENT_VERSION,
  MAX_CONVERSATION_CHARS,
  MAX_CONVERSATION_MESSAGES,
  MAX_MESSAGE_CHARS,
  READY_TOKEN,
} from "@/types/protocol";
import type { ChatMessage, ReportFacts, ReportSaveResponse, UiLang } from "@/types/api";

export type Msg = ChatMessage;

/** The exact final bytes the server sends when the interview is complete (§3.2). */
export const READY_SUFFIX = `\n${READY_TOKEN}`;

/**
 * Room kept for the assistant's reply, so that the conversation after the reply still fits the limits
 * for /api/report/generate (which receives the whole conversation, including that reply).
 */
export const REPLY_RESERVE_CHARS = 2000;

/**
 * Visible interview reply and whether it ended with "\n[READY]".
 * While streaming (`done = false`) a trailing partial suffix ("\n", "\n[RE") is held back so it never flashes.
 * Any stray "[READY]" elsewhere is removed from display but only the final suffix counts as ready.
 */
export function parseInterviewReply(raw: string, done: boolean): { text: string; ready: boolean } {
  let s = raw;
  let ready = false;
  const trimmed = s.replace(/\s+$/, "");
  if (trimmed.endsWith(READY_TOKEN)) {
    // Exact contract is "\n[READY]"; trailing whitespace is tolerated.
    ready = done;
    s = trimmed.slice(0, trimmed.length - READY_TOKEN.length);
  } else if (!done) {
    for (let n = Math.min(READY_SUFFIX.length - 1, s.length); n > 0; n--) {
      if (s.endsWith(READY_SUFFIX.slice(0, n))) {
        s = s.slice(0, s.length - n);
        break;
      }
    }
  }
  // Loop: stripping "[REA[READY]DY]" once would re-form a token.
  while (s.includes(READY_TOKEN)) s = s.split(READY_TOKEN).join("");
  return { text: s.replace(/\s+$/, ""), ready };
}

export function conversationChars(messages: readonly Msg[]): number {
  return messages.reduce((n, m) => n + m.content.length, 0);
}

export type LimitProblem = "empty" | "message_too_long" | "too_many" | "too_long";

/**
 * Can the user send `draft` as the next message? Returns null if yes.
 * Leaves room for the assistant's reply (one more message and REPLY_RESERVE_CHARS) so generate still fits.
 */
export function checkNextMessage(messages: readonly Msg[], draft: string): LimitProblem | null {
  const text = draft.trim();
  if (!text) return "empty";
  if (text.length > MAX_MESSAGE_CHARS) return "message_too_long";
  const next = appendUserMessage(messages, text);
  if (next.length + 1 > MAX_CONVERSATION_MESSAGES) return "too_many";
  const last = next[next.length - 1]!;
  if (last.content.length > MAX_MESSAGE_CHARS) return "message_too_long";
  if (conversationChars(next) + REPLY_RESERVE_CHARS > MAX_CONVERSATION_CHARS) return "too_long";
  return null;
}

/** True when no further message can be sent at all (the user must create the summary or start over). */
export function isAtLimit(messages: readonly Msg[]): boolean {
  return (
    messages.length + 2 > MAX_CONVERSATION_MESSAGES ||
    conversationChars(messages) + 1 + REPLY_RESERVE_CHARS > MAX_CONVERSATION_CHARS
  );
}

/**
 * Adds the user's text. If the last message is already `user` (the previous reply failed or was stopped),
 * the text is appended to it, so the conversation always alternates and ends with `user`.
 */
export function appendUserMessage(messages: readonly Msg[], text: string): Msg[] {
  const t = text.trim();
  const last = messages[messages.length - 1];
  if (last?.role === "user") return [...messages.slice(0, -1), { role: "user", content: `${last.content}\n\n${t}` }];
  return [...messages, { role: "user", content: t }];
}

/**
 * Adds the assistant's (already [READY]-stripped) reply. An empty reply is not added (ChatMessage needs ≥ 1 char),
 * and a reply over MAX_MESSAGE_CHARS is cut so the next request still validates.
 */
export function commitReply(messages: readonly Msg[], text: string): Msg[] {
  const t = text.trim();
  if (!t || messages[messages.length - 1]?.role !== "user") return [...messages];
  return [...messages, { role: "assistant", content: t.slice(0, MAX_MESSAGE_CHARS) }];
}

/** Retry is only possible when the conversation ends with a user message (the server returns 400 otherwise). */
export function canRetry(messages: readonly Msg[]): boolean {
  return messages.length > 0 && messages[0]!.role === "user" && messages[messages.length - 1]!.role === "user";
}

/** Body for POST /api/report/chat, or null if it would break §3.2 (first and last must be user, limits). */
export function buildChatRequest(messages: readonly Msg[], lang: UiLang): { messages: Msg[]; lang: UiLang } | null {
  if (!canRetry(messages)) return null;
  if (messages.length > MAX_CONVERSATION_MESSAGES || conversationChars(messages) > MAX_CONVERSATION_CHARS) return null;
  return { messages: [...messages], lang };
}

/**
 * Body for POST /api/report/generate. Sends the whole conversation; if it is over the limits, the final
 * assistant message (the "you can create the summary" line) is dropped. Null if it still does not fit.
 */
export function buildGenerateRequest(messages: readonly Msg[]): { messages: Msg[] } | null {
  const fits = (ms: readonly Msg[]) =>
    ms.length > 0 && ms.length <= MAX_CONVERSATION_MESSAGES && conversationChars(ms) <= MAX_CONVERSATION_CHARS;
  if (fits(messages)) return { messages: [...messages] };
  if (messages[messages.length - 1]?.role === "assistant") {
    const trimmed = messages.slice(0, -1);
    if (fits(trimmed)) return { messages: trimmed };
  }
  return null;
}

export type ReportSaveBody = {
  facts: ReportFacts;
  markdown: string;
  lang: UiLang;
  consent: true;
  consent_version: string;
};

/** Body for POST /api/report/save. Null unless the user ticked the consent box. */
export function buildSaveRequest(
  summary: { facts: ReportFacts; markdown: string },
  lang: UiLang,
  consented: boolean,
): ReportSaveBody | null {
  if (consented !== true) return null;
  return { facts: summary.facts, markdown: summary.markdown, lang, consent: true, consent_version: CONSENT_VERSION };
}

export type ReportAction = "chat" | "generate" | "pdf" | "save" | "open" | "delete";

/** Message key under `report.errors` for a failed request. `status` 0 = network error. */
export function errorKeyFor(action: ReportAction, status: number, code?: string | null): string {
  if (status === 0) return "network";
  if (status === 429 || code === "rate_limited") return "rate_limited";
  if (code === "consent_required") return "consent_required";
  if (code === "consent_outdated") return "consent_outdated";
  if (status === 404 || code === "not_found") return action === "open" || action === "delete" ? "not_found" : "generic";
  if (status === 503 || code === "unavailable") return action === "save" ? "save_unavailable" : "unavailable";
  if (status === 400) return action === "chat" || action === "generate" ? "too_long_or_invalid" : "invalid";
  return "generic";
}

/** File name from a Content-Disposition header, or a dated default. Only safe characters are kept. */
export function pdfFilename(contentDisposition: string | null | undefined, now = new Date()): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition ?? "");
  let name = m?.[1] ? decodeURIComponentSafe(m[1]).trim() : "";
  name = name.replace(/[^\w.-]/g, "");
  if (!name || !name.toLowerCase().endsWith(".pdf")) {
    // Same date as the server's bangkokDateStamp (Asia/Bangkok, not UTC).
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now).replace(/-/g, "");
    name = `sabaisafe-report-${d}.pdf`;
  }
  return name;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The Thai and English parts of the summary, split on the two headings fixed by §3.3. */
export const TH_HEADING = "## ฉบับภาษาไทย (สำหรับเจ้าหน้าที่)";
export const EN_HEADING = "## English translation (for you to check)";

export function splitSummary(markdown: string): { th: string; en: string } | null {
  const ti = markdown.indexOf(TH_HEADING);
  const ei = markdown.indexOf(EN_HEADING);
  if (ti < 0 || ei < 0 || ei < ti) return null;
  return { th: markdown.slice(ti, ei).trim(), en: markdown.slice(ei).trim() };
}

// ---------- saved report in localStorage (§3.5: id + token on this device) ----------

export type SavedReport = Pick<ReportSaveResponse, "id" | "delete_token" | "expires_at">;
export const SAVED_REPORT_KEY = "sabaisafe.report.saved.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isSavedReport(v: unknown): v is SavedReport {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    o.id.length <= 100 &&
    typeof o.delete_token === "string" &&
    o.delete_token.length > 0 &&
    o.delete_token.length <= 200 &&
    typeof o.expires_at === "string" &&
    !Number.isNaN(Date.parse(o.expires_at))
  );
}

/** The saved record, or null if none, malformed or expired (expired/malformed records are removed). */
export function loadSavedReport(storage: StorageLike | null = defaultStorage(), now = Date.now()): SavedReport | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SAVED_REPORT_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (!isSavedReport(v) || Date.parse(v.expires_at) <= now) {
      storage.removeItem(SAVED_REPORT_KEY);
      return null;
    }
    return { id: v.id, delete_token: v.delete_token, expires_at: v.expires_at };
  } catch {
    return null;
  }
}

/** Stores only id, token and expiry (never facts or markdown). Returns false if storage is unavailable. */
export function storeSavedReport(r: SavedReport, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVED_REPORT_KEY, JSON.stringify({ id: r.id, delete_token: r.delete_token, expires_at: r.expires_at }));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedReport(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(SAVED_REPORT_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- save, replacing an earlier saved report (PDPA: never orphan a report the user can't delete) ----------

type Res<T> = { ok: true; data: T } | { ok: false; status: number; code: string };

export type SaveReplacingDeps = {
  deleteSaved: (r: SavedReport) => Promise<Res<null>>;
  saveSummary: (body: ReportSaveBody) => Promise<Res<SavedReport>>;
  store: (r: SavedReport) => boolean;
  clear: () => void;
};

export type SaveReplacingResult =
  /** Saved. `remembered` = the browser kept id + token. `replaced` = an earlier saved report was deleted first. */
  | { ok: true; saved: SavedReport; remembered: boolean; replaced: boolean }
  /** Failed. `stage` says which call failed; `previousGone` = the earlier record no longer exists (deleted or 404). */
  | { ok: false; stage: "delete_old" | "save"; status: number; code: string; previousGone: boolean };

/**
 * Saves a summary. With an earlier saved report on this device, deletes it FIRST (404 = already gone, fine). Only
 * one id + token fits in localStorage, so saving first would lose the earlier token and leave that report on the
 * server with no way to delete it early. If deleting the earlier report fails, nothing is saved.
 */
export async function saveReplacing(
  previous: SavedReport | null,
  body: ReportSaveBody,
  deps: SaveReplacingDeps,
): Promise<SaveReplacingResult> {
  let replaced = false;
  if (previous) {
    const d = await deps.deleteSaved(previous);
    if (!d.ok && d.status !== 404) return { ok: false, stage: "delete_old", status: d.status, code: d.code, previousGone: false };
    deps.clear();
    replaced = true;
  }
  const r = await deps.saveSummary(body);
  if (!r.ok) return { ok: false, stage: "save", status: r.status, code: r.code, previousGone: replaced };
  return { ok: true, saved: r.data, remembered: deps.store(r.data), replaced };
}
