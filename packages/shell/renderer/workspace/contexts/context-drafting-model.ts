// 만드는 중(drafting) context의 흐린 초안을 그릴 값: 초안 content에서 개체 이름과 개체 사이 관계를
// 읽는다. content는 submit 전에는 검사되지 않은 JSON 객체이므로 아는 모양만 골라 읽고 나머지는 버린다.
import type { DraftProgress } from "./source.ts";

export interface DraftRelation {
  readonly from: string;
  readonly label: string;
  readonly to: string;
}

export interface DraftSketch {
  /** 초안의 개체 이름. content에 적힌 순서다. */
  readonly types: readonly string[];
  readonly relations: readonly DraftRelation[];
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function draftSketch(draft: DraftProgress): DraftSketch {
  const listed = recordOf(recordOf(draft.content)?.contract)?.types;
  const types: string[] = [];
  const relations: DraftRelation[] = [];
  for (const item of Array.isArray(listed) ? listed : []) {
    const type = recordOf(item);
    const name = textOf(type?.name);
    if (type === null || name === null) continue;
    types.push(name);
    const own = type.relations;
    for (const entry of Array.isArray(own) ? own : []) {
      const relation = recordOf(entry);
      const label = textOf(relation?.label) ?? textOf(relation?.name);
      const to = textOf(relation?.to);
      if (label !== null && to !== null) {
        relations.push({ from: name, label, to });
      }
    }
  }
  return { types, relations };
}
