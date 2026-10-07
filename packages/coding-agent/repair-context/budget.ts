// 전체 묶음 예산(repair-context#R11, R12). 묶음은 UTF-8 24,576 bytes와 300줄을 둘 다 지킨다. 잘림 표시·
// 누락 표시·이어 읽기 안내·fence도 이 안에 센다. 넘치면 log → 대표 발생 → 첨부 순으로 절을 줄이고,
// 그래도 넘치면 나머지 문제별 절도 참조만 남긴다. 절 하나를 통째로 이어 읽기 참조로 바꾸므로 code point나
// 구조 중간을 자르지 않고, 줄인 자리마다 원래 크기와 실제 이어 읽기를 적는다.
import type {
  RepairContextSection,
  RepairEvidenceRead,
} from "../../contracts/coding-agent/mod.ts";
import {
  REPAIR_CONTEXT_BYTES,
  REPAIR_CONTEXT_LINES,
} from "../../contracts/coding-agent/mod.ts";
import { lineCount, utf8Bytes } from "./text.ts";

// 묶음 본문. `context.bytes`·`context.lines`는 이 글을 센다.
export function renderSections(
  sections: readonly RepairContextSection[],
): string {
  return sections.map((section) =>
    [
      `## ${section.kind}${
        section.problem === null ? "" : ` ${section.problem}`
      }`,
      section.content,
      ...(section.availability === "available"
        ? []
        : [`[${section.availability}] ${section.reason}`]),
    ].join("\n")
  ).join("\n");
}

export function fits(sections: readonly RepairContextSection[]): boolean {
  const text = renderSections(sections);
  return utf8Bytes(text) <= REPAIR_CONTEXT_BYTES &&
    lineCount(text) <= REPAIR_CONTEXT_LINES;
}

// 줄이는 순서. 앞의 셋이 요구된 순서고(log → 대표 excerpt → 첨부 metadata), 뒤는 마지막 수단이라
// 문제를 알아보는 절(증상)을 맨 끝에 둔다.
const REDUCE_ORDER = [
  "logs",
  "representative_occurrences",
  "attachments",
  "related_problems",
  "past_repairs",
  "preceding_changes",
  "reproduction",
  "human_text",
  "failure_basis",
  "target_symptom",
] as const;

const MORE_KIND: Record<string, RepairEvidenceRead["kind"]> = {
  logs: "log",
  representative_occurrences: "occurrences",
  attachments: "screen",
};

export function reduceSections(
  input: readonly RepairContextSection[],
): RepairContextSection[] {
  const sections = input.map((section) => ({ ...section }));
  for (const kind of REDUCE_ORDER) {
    for (const section of sections) {
      if (fits(sections)) return sections;
      if (section.kind !== kind || section.problem === null) continue;
      const original = renderSections([section]);
      const more: RepairEvidenceRead[] = section.more ?? [{
        problem: section.problem,
        kind: MORE_KIND[kind] ?? "reference",
        source: `problem:${section.problem}`,
        cursor: null,
      }];
      const next = more[0];
      section.content = `전체 예산 때문에 생략(원래 ${
        utf8Bytes(original)
      } bytes·${
        lineCount(original)
      }줄). 이어 읽기: more ${next.kind} ${next.source}`;
      section.availability = "truncated";
      section.reason = "전체 예산 때문에 절을 이어 읽기 참조로 바꿨다";
      section.more = more;
    }
  }
  return sections;
}
