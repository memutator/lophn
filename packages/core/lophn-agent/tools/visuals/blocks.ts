import {
  type MessageLink,
  visualBlockSchema,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { CheckedContent } from "./model.ts";

export type VisualBlockInput = Extract<
  CheckedContent["parts"][number],
  { kind: "visual" }
>["block"];

export function blocksOf(content: CheckedContent): VisualBlockInput[] {
  return content.parts.flatMap((part) =>
    part.kind === "visual" ? [part.block] : []
  );
}

// 메시지 링크는 검증을 통과한 출처에서만 나온다. 같은 대상은 한 번만 건다.
export function sourceLinks(
  blocks: readonly VisualBlockInput[],
): MessageLink[] {
  const links = new Map<string, MessageLink>();
  for (const block of blocks) {
    for (const source of block.sources) {
      if (source.kind === "document") {
        const { document, version } = source.reference;
        links.set(`v:${document}@${version}`, {
          kind: "version",
          document,
          version,
        });
      } else if (source.kind === "app_command") {
        const call = source.reference.tool_call;
        links.set(`t:${call}`, { kind: "tool_call", call });
      }
    }
  }
  return [...links.values()];
}

export type StoredBlock =
  | { status: "ready"; block: ReturnType<typeof visualBlockSchema.parse> }
  | {
    // 현재 검사를 통과하지 못해도 본문·설명·출처를 있는 그대로 둔다. 다른 것으로 바꾸지 않는다.
    status: "unavailable";
    key: string | null;
    kind: string | null;
    title: string | null;
    description: string | null;
    sources: unknown;
  };

// 저장된 블록을 읽는다. 앱·화면·release를 더는 열 수 없거나 명세 판이 달라져 검사를 통과하지
// 못하는 블록도 메시지 읽기를 막지 않고, 원래 값과 이용 불가를 함께 돌려준다.
export function readStoredBlock(raw: unknown): StoredBlock {
  const parsed = visualBlockSchema.safeParse(raw);
  if (parsed.success) return { status: "ready", block: parsed.data };
  const record = (
    raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  ) as Record<string, unknown>;
  const text = (field: string) =>
    typeof record[field] === "string" ? record[field] : null;
  return {
    status: "unavailable",
    key: text("key"),
    kind: text("kind"),
    title: text("title"),
    description: text("description"),
    sources: record["sources"] ?? null,
  };
}
