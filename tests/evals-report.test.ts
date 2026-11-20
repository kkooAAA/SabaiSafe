// evals/report.ts scoring rules (Report Assistant eval, `pnpm eval -- --report`).
import { describe, expect, it } from "vitest";
import { SCENARIOS, checkGenerate, checkReply } from "@/evals/report";
import { ERROR_MARKER, READY_TOKEN } from "@/types/protocol";
import { EN_HEADING, FACTS, MARKDOWN, PII, TH_HEADING } from "./helpers/report";

describe("checkReply", () => {
  it("accepts a plain question and a final \\n[READY] on the confirm turn", () => {
    expect(checkReply("When did it happen?", false)).toEqual({ ready: false, failures: [] });
    expect(checkReply(`Thanks.\n${READY_TOKEN}`, true)).toEqual({ ready: true, failures: [] });
  });
  it.each([
    [`Thanks.\n${READY_TOKEN}`, false, "before the user confirmed"],
    [`Thanks ${READY_TOKEN} more`, true, "not as the exact final"],
    [`a ${READY_TOKEN}\n${READY_TOKEN}`, true, "more than once"],
    [`partial${ERROR_MARKER}`, false, "ERROR_MARKER"],
  ])("flags %j", (body, confirm, msg) => expect(checkReply(body, confirm).failures.join(" ")).toContain(msg));
});

const CLEAN = { ...FACTS, incident_summary_en: "The operator kept my passport.", parties: [], evidence: [] };

describe("checkGenerate", () => {
  it("passes a clean summary", () => expect(checkGenerate(200, { facts: CLEAN, markdown: MARKDOWN })).toEqual([]));
  it("flags wrong headings, PII, invented numbers, and HTTP errors", () => {
    expect(checkGenerate(500, null)).toEqual(["generate HTTP 500"]);
    expect(checkGenerate(200, { facts: CLEAN, markdown: `${TH_HEADING}\n## Extra\n${EN_HEADING}` }).join()).toContain("headings");
    expect(checkGenerate(200, { facts: FACTS, markdown: `${MARKDOWN}\n${PII.thaiMobile}` }).join()).toContain("PII");
    expect(checkGenerate(200, { facts: { x: 1 }, markdown: `${MARKDOWN}\ncall the shop on 076 999 888` }).join()).toContain("invented");
  });
});

describe("SCENARIOS", () => {
  it("each script has PII to scrub and ends with a confirmation", () => {
    for (const s of SCENARIOS) {
      expect(s.turns.length).toBeGreaterThanOrEqual(2);
      expect(Object.values(PII).some((p) => s.turns.join(" ").includes(p)), s.id).toBe(true);
      expect(s.turns.at(-1), s.id).toMatch(/^(yes|是)/i);
    }
    expect(new Set(SCENARIOS.map((s) => s.lang))).toEqual(new Set(["en", "zh"]));
  });
});
