// lophn_index tool의 실행이다. root·place·document·section·search·
// status는 op마다 소유 읽기 route 하나로만 보낸다. 목차는 적은 양에서 본문으로 내려가는
// 길이라 잘림·누락·반영 지연·새 판 존재를 요약에 그대로 밝힌다. 이 tool은 쓰지 않는다.
import { MCP_CORE_ROUTES } from "../../../protocol/coding-agent/mod.ts";
import type { Route } from "../../../protocol/base/mod.ts";
import type { FlowClient } from "../../connection/mod.ts";
import {
  continuation,
  failureOutput,
  type ToolOutput,
  withContinuation,
  withoutOp,
} from "./output.ts";

export type IndexToolDeps = { client: Pick<FlowClient, "read"> };

const OPS = [
  "root",
  "place",
  "document",
  "section",
  "search",
  "status",
] as const;
type IndexOp = (typeof OPS)[number];

type Coverage = {
  processed_seq: string;
  ledger_basis_seq: string;
  lagging: boolean;
  rebuilding: boolean;
  omissions: { document: string; version: string; reason: string }[];
};

function isIndexOp(op: unknown): op is IndexOp {
  return typeof op === "string" && (OPS as readonly string[]).includes(op);
}

// derived 반영 지연을 모델이 결과의 완전함으로 읽지 않게 이유와 함께 밝힌다.
function coverageNote(coverage: Coverage | undefined): string {
  if (coverage === undefined) return "";
  const notes: string[] = [];
  if (coverage.lagging) {
    notes.push(
      `derived 반영 지연(처리 ${coverage.processed_seq}/장부 ${coverage.ledger_basis_seq}): 최근 저장한 판이 아직 결과에 없을 수 있다`,
    );
  }
  if (coverage.rebuilding) notes.push("derived를 다시 만드는 중이다");
  if (coverage.omissions.length > 0) {
    notes.push(`판 ${coverage.omissions.length}개는 이유와 함께 누락이다`);
  }
  return notes.join("; ");
}

function join(summary: string, ...notes: string[]): string {
  const rest = notes.filter((note) => note !== "");
  return rest.length === 0 ? summary : `${summary}. ${rest.join(". ")}`;
}

export function createIndexTool(
  deps: IndexToolDeps,
): (toolName: string, route: Route, input: unknown) => Promise<ToolOutput> {
  const routes = MCP_CORE_ROUTES.lophn_index as unknown as Record<
    IndexOp,
    Route
  >;
  return async function runIndexTool(_toolName, _route, rawInput) {
    const op = (rawInput as { op?: unknown } | undefined)?.op;
    if (!isIndexOp(op)) {
      // 표에 없는 op는 실행하지 않는다. 쓰기 op는 이 tool에 없다.
      return failureOutput({
        code: "invalid_input",
        message: "index tool 표에 없는 op다",
        details: { op: typeof op === "string" ? op : null },
      }, [`lophn_index ${OPS.join(", ")}만 있다`]);
    }
    const input = withoutOp(rawInput);
    if (op === "section") {
      const reference = input.reference as { section?: string | null };
      if (reference?.section === undefined || reference.section === null) {
        // section op는 고른 구역의 하위 목차다. 구역 없이 문서 목차로 추측하지 않는다.
        return failureOutput({
          code: "invalid_input",
          message: "section op는 reference.section이 필요하다",
          details: { op },
        }, ["문서 전체 목차는 lophn_index document로 읽는다"]);
      }
    }
    const read = await deps.client.read(routes[op], input);
    if (!read.ok) {
      // 범위 밖 대상은 없는 것과 같은 오류가 그대로 온다.
      return failureOutput(read.error, [
        "lophn_index root로 읽을 수 있는 자리를 다시 읽는다",
      ]);
    }
    return describe(op, read.value as Record<string, unknown>);
  };
}

function describe(op: IndexOp, value: Record<string, unknown>): ToolOutput {
  switch (op) {
    case "root":
      return describeRoot(value);
    case "place":
      return describePlace(value);
    case "document":
    case "section":
      return describeDocument(op, value);
    case "search":
      return describeSearch(value);
    case "status":
      return describeStatus(value);
  }
}

function describeRoot(value: Record<string, unknown>): ToolOutput {
  const entries = (value.entries as { kind: string }[] | undefined) ?? [];
  const kinds = new Map<string, number>();
  for (const entry of entries) {
    kinds.set(entry.kind, (kinds.get(entry.kind) ?? 0) + 1);
  }
  const text = [...kinds].map(([kind, count]) => `${kind} ${count}`).join(", ");
  return {
    summary: withContinuation(
      `전체 목차 ${entries.length}개${text === "" ? "" : ` (${text})`}`,
      value,
    ),
    data: value,
    next: [
      "lophn_index place로 프로젝트·앱 자리의 문서 목차를 읽는다",
    ],
  };
}

function describePlace(value: Record<string, unknown>): ToolOutput {
  const entries = (value.entries as unknown[] | undefined) ?? [];
  return {
    summary: join(
      withContinuation(`자리 문서 ${entries.length}개`, value),
      coverageNote(value.coverage as Coverage | undefined),
    ),
    data: value,
    next: [
      "lophn_index document로 문서의 구역 목차를 읽는다",
      "lophn_document list로 보관 문서와 자리 없는 문서를 읽는다",
    ],
  };
}

function describeDocument(
  op: "document" | "section",
  value: Record<string, unknown>,
): ToolOutput {
  const status = value.section_status as string;
  const entries = (value.entries as {
    key: string;
    hidden_children_count?: number;
  }[] | undefined) ?? [];
  const hidden = entries.reduce(
    (sum, entry) => sum + (entry.hidden_children_count ?? 0),
    0,
  );
  const stale = value.version !== value.latest_version
    ? `고정 판은 최신 판(${value.latest_version})이 아니다. 최신 판 목차는 version을 바꿔 다시 읽는다`
    : "";
  const reason = (value.failure_reason as string | null | undefined) ?? "";
  let head: string;
  let next: string[];
  switch (status) {
    case "missing":
      head = "고른 구역이 이 판에 없다";
      next = ["lophn_index document로 이 판의 구역 key를 다시 읽는다"];
      break;
    case "unverified":
      head = `구역 구조를 확인하지 못했다(${reason}). 원문 파일은 있다`;
      next = ["data.file의 고정 판 파일로 원문 존재를 확인한다"];
      break;
    case "unsupported":
      head = "이 format은 구역 목차를 지원하지 않는다. 원문 파일은 있다";
      next = ["data.file의 고정 판 파일로 원문 존재를 확인한다"];
      break;
    default:
      head = `${
        op === "section" ? "구역" : "문서"
      } 하위 목차 ${entries.length}개${
        hidden > 0 ? `, 깊이 밖 하위 구역 ${hidden}개` : ""
      }`;
      next = [
        "lophn_read로 reference의 고정 판과 구역 key의 본문을 읽는다",
        "깊이 밖 하위 구역은 lophn_index section으로 내려간다",
      ];
  }
  return {
    summary: join(withContinuation(head, value), stale),
    data: value,
    next,
  };
}

function describeSearch(value: Record<string, unknown>): ToolOutput {
  const results = (value.results as unknown[] | undefined) ?? [];
  const note = coverageNote(value.coverage as Coverage | undefined);
  const more = continuation(value).more;
  return {
    summary: join(
      withContinuation(`검색 결과 ${results.length}개`, value),
      note,
      results.length === 0 && note !== ""
        ? "결과가 없다는 뜻이 아니다. 반영 뒤 다시 찾는다"
        : "",
    ),
    data: value,
    next: [
      "lophn_read에 결과의 reference를 넣어 고정 판 본문을 읽는다",
      ...(more ? ["next_cursor로 lophn_index search를 이어 읽는다"] : []),
      ...(note !== "" ? ["lophn_index status로 반영 상태를 읽는다"] : []),
    ],
  };
}

function describeStatus(value: Record<string, unknown>): ToolOutput {
  const documents = (value.documents as unknown[] | undefined) ?? [];
  const note = coverageNote(value.coverage as Coverage | undefined);
  return {
    summary: join(`반영 상태: 문서 ${documents.length}개`, note),
    data: value,
    next: [
      "lophn_index search로 keyword를 찾는다",
      ...(note !== "" ? ["잠시 뒤 lophn_index status를 다시 읽는다"] : []),
    ],
  };
}
