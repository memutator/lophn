import { err, ok, type Result } from "../../../../base/mod.ts";
import type {
  ToolResult,
  VisualBlock,
} from "../../../../protocol/lophn-agent/mod.ts";
import { readStoredBlock, type StoredBlock } from "../../../visuals/mod.ts";
import { fitJson } from "../result.ts";
import { bodyOf, continuation, wrap } from "./paging.ts";

// 시각 묶음이 저장된 메시지 본문을 읽어 보여 주는 모양이다. 저장된 명세는 값 그대로 두고 크기
// 상한 안의 창으로만 나눈다(R19).

// 한 번에 읽는 항목 수(표 행, 차트 점, 도표 node·edge)의 상한이다. 24 KiB 상한이 먼저 닿으면 더 적다.
const READ_ITEMS = 100;

export function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type StoredBody = { body: string; parts: unknown[] };

export function bodyParts(value: unknown): Result<StoredBody> {
  const body = bodyOf(value);
  const content = body["content"];
  if (
    typeof body["body"] !== "string" || !plain(content) ||
    !Array.isArray(content["parts"])
  ) {
    return err({
      code: "unavailable",
      message: "message body is not readable",
    });
  }
  return ok({ body: body["body"], parts: content["parts"] });
}

export type Located = { position: number; stored: StoredBlock };

export function visualsOf(parts: readonly unknown[]): Located[] {
  return parts.flatMap((part, position) =>
    plain(part) && part["kind"] === "visual"
      ? [{ position, stored: readStoredBlock(part["block"]) }]
      : []
  );
}

export function keyOf(located: Located): string | null {
  return located.stored.status === "ready"
    ? located.stored.block.key
    : located.stored.key;
}

export function summaryOf(located: Located): Record<string, unknown> {
  const { stored, position } = located;
  if (stored.status === "ready") {
    const { block } = stored;
    return {
      position,
      key: block.key,
      kind: block.kind,
      status: "ready",
      title: block.title,
      description: block.description,
      sources: block.sources,
    };
  }
  // 현재 검사를 통과하지 못하는 블록도 본문·설명·출처는 저장된 그대로 보인다.
  return {
    position,
    key: stored.key,
    kind: stored.kind,
    status: "unavailable",
    reason: "the stored block does not pass the current visual check",
    title: stored.title,
    description: stored.description,
    sources: stored.sources,
  };
}

// 블록의 데이터를 이어 읽을 항목으로 편다. 차트는 점, 도표는 node 다음 edge다.
function itemsOf(block: VisualBlock): {
  head: Record<string, unknown>;
  items: unknown[];
} {
  switch (block.kind) {
    case "table":
      return {
        head: {
          columns: block.payload.columns,
          row_count: block.payload.rows.length,
        },
        items: block.payload.rows,
      };
    case "chart":
      return {
        head: {
          type: block.payload.type,
          x: block.payload.x,
          y: block.payload.y,
          series: block.payload.series.map((series) => ({
            key: series.key,
            label: series.label,
            point_count: series.points.length,
          })),
        },
        items: block.payload.series.flatMap((series) =>
          series.points.map((point) => ({
            series: series.key,
            x: point.x,
            y: point.y,
          }))
        ),
      };
    case "diagram":
      return {
        head: {
          node_count: block.payload.nodes.length,
          edge_count: block.payload.edges.length,
        },
        items: [
          ...block.payload.nodes.map((node) => ({ node })),
          ...block.payload.edges.map((edge) => ({ edge })),
        ],
      };
    case "app_card":
      // 저장된 참조 그대로다. 다른 앱·release·화면으로 바꾸지 않는다.
      return { head: { card: block.payload }, items: [] };
  }
}

export function blockWindow(
  summary: string,
  scope: string,
  block: VisualBlock,
  skip: number,
  position: number,
): ToolResult {
  const { head, items } = itemsOf(block);
  const view = items.slice(skip, skip + READ_ITEMS);
  const fitted = fitJson({
    position,
    key: block.key,
    kind: block.kind,
    title: block.title,
    description: block.description,
    sources: block.sources,
    ...head,
    offset: skip,
    total_items: items.length,
    items: view,
  }, ["items"]);
  const kept = fitted.content === null
    ? 0
    : ((fitted.content as Record<string, unknown>)["items"] as unknown[])
      .length;
  // 항목 하나가 상한보다 커서 하나도 못 싣는 때는 그 항목을 건너뛰고(omitted에 남는다) 같은
  // cursor를 되풀이하지 않는다.
  const consumed = skip + (kept === 0 && view.length > 0 ? 1 : kept);
  const next = consumed < items.length ? wrap(scope, null, consumed) : null;
  return {
    status: "success",
    summary,
    content: fitted.content as ToolResult["content"],
    complete: fitted.complete && next === null,
    source: null,
    continuation: continuation(next),
    pending: [],
  };
}

const SUMMARY_MAX = 400;

// 모델이 고칠 수 있는 거절이다. 소유 contract를 부르지 않았으므로 not_executed고 아무것도 저장하지
// 않았다. 받은 값은 싣지 않는다.
export function notDone(
  subject: string,
  reason: { stage: string; block: string | null; message: string },
): ToolResult {
  const text = `${subject}: ${reason.message}`;
  return {
    status: "not_executed",
    summary: Array.from(text).slice(0, SUMMARY_MAX).join(""),
    content: {
      stored: false,
      rejection: {
        stage: reason.stage,
        block: reason.block,
        message: reason.message,
      },
    },
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  };
}

const TOOL_CALL_ULID = /^tcl_([0-7][0-9a-hjkmnp-tv-z]{25})$/;

// 같은 ToolCall의 재전송이 같은 메시지 ID를 쓰도록 ToolCall ID에서 낸다. RecordMessage는 같은 ID·
// 같은 내용을 이전 결과로 돌려주므로 재전송이 메시지를 늘리지 않는다.
export function messageIdFor(
  call: string | undefined,
  fresh: () => string,
): string {
  const match = call === undefined ? null : TOOL_CALL_ULID.exec(call);
  return match === null ? fresh() : `msg_${match[1]}`;
}
