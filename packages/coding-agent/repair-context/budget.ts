import type { RepairContextSection } from "../../contracts/coding-agent/mod.ts";
import { REPAIR_CONTEXT_BYTES, REPAIR_CONTEXT_LINES } from "../../contracts/coding-agent/mod.ts";
import { lineCount, utf8Bytes } from "./text.ts";

export function renderSections(sections: readonly RepairContextSection[]): string {
  return sections.map((section) => [
    `## ${section.kind}${section.problem === null ? "" : ` ${section.problem}`}`,
    section.content,
    ...(section.availability === "available" ? [] : [`[${section.availability}] ${section.reason}`]),
  ].join("\n")).join("\n");
}

export function fits(sections: readonly RepairContextSection[]): boolean {
  const text = renderSections(sections);
  return utf8Bytes(text) <= REPAIR_CONTEXT_BYTES && lineCount(text) <= REPAIR_CONTEXT_LINES;
}

// 원문 문자열이나 JSON을 자르는 대신 절 전체를 실제 추가 읽기 참조로 바꾼다.
export function reduceSections(input: readonly RepairContextSection[]): RepairContextSection[] {
  const sections = input.map((section) => ({ ...section }));
  const order = ["logs", "representative_occurrences", "attachments", ...new Set(input.map((section) => section.kind))];
  for (const kind of order) {
    for (const section of sections) {
      if (fits(sections)) return sections;
      if (section.kind !== kind || section.problem === null) continue;
      const original = renderSections([section]);
      const more = section.more ?? [{
        problem: section.problem,
        kind: kind === "logs" ? "log" as const : kind === "representative_occurrences" ? "occurrences" as const : "reference" as const,
        source: `problem:${section.problem}`,
        cursor: null,
      }];
      section.content = `잘림: 원래 ${utf8Bytes(original)} bytes·${lineCount(original)}줄. read repair_context more ${more[0].kind} ${more[0].source}`;
      section.availability = "truncated";
      section.reason = "전체 예산 때문에 절을 추가 읽기로 바꿨다";
      section.more = more;
    }
  }
  return sections;
}
