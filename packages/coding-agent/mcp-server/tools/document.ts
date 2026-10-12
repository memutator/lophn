// lophn_document tool의 실행이다(T13, mcp#R11·R12). list는 본문 없는 문서 목록, history는
// 고정 판 목록(section을 주면 같은 key의 판별 변화), diff는 두 고정 판의 줄 단위 추가·삭제다.
// 모두 읽기 route 하나로만 보낸다. 비교는 같은 key와 줄만 본다: 의미상 이름 변경은 추정해
// 사실로 내지 않고, 복원하지 못한 범위는 누락으로 밝힌다. 이 tool은 쓰지 않는다.
import { MCP_CORE_ROUTES } from "../../../protocol/coding-agent/mod.ts";
import { documentSectionHistory } from "../../../protocol/projects/mod.ts";
import type { Route } from "../../../protocol/base/mod.ts";
import type { FlowClient } from "../../connection/mod.ts";
import {
  continuation,
  failureOutput,
  type ToolOutput,
  withContinuation,
  withoutOp,
} from "./output.ts";

export type DocumentToolDeps = { client: Pick<FlowClient, "read"> };

const OPS = ["list", "history", "diff"] as const;
type DocumentOp = (typeof OPS)[number];

type Omission = { version: string; section: string | null; reason: string };

const NO_RENAME_NOTE =
  "같은 key와 줄만 비교한다. 이름이 바뀐 구역의 짝 맞춤(rename 추정)은 하지 않는다";

function omissionNote(omissions: readonly Omission[]): string {
  if (omissions.length === 0) return "";
  const reasons = [...new Set(omissions.map((item) => item.reason))];
  return `복원하지 못해 비교하지 못한 곳 ${omissions.length}개(${
    reasons.join("; ")
  })`;
}

function join(summary: string, ...notes: string[]): string {
  const rest = notes.filter((note) => note !== "");
  return rest.length === 0 ? summary : `${summary}. ${rest.join(". ")}`;
}

export function createDocumentTool(
  deps: DocumentToolDeps,
): (toolName: string, route: Route, input: unknown) => Promise<ToolOutput> {
  const routes = MCP_CORE_ROUTES.lophn_document as unknown as Record<
    DocumentOp,
    Route
  >;
  return async function runDocumentTool(_toolName, _route, rawInput) {
    const op = (rawInput as { op?: unknown } | undefined)?.op;
    if (typeof op !== "string" || !(OPS as readonly string[]).includes(op)) {
      // 표에 없는 op는 실행하지 않는다. 저장·복원·보관 op는 이 tool에 없다.
      return failureOutput({
        code: "invalid_input",
        message: "document tool 표에 없는 op다",
        details: { op: typeof op === "string" ? op : null },
      }, ["lophn_document list, history, diff만 있다"]);
    }
    const input = withoutOp(rawInput);
    if (op === "list") return await list(deps, routes.list, input);
    if (op === "history") {
      return await history(deps, routes.history, input);
    }
    return await diff(deps, routes.diff, input);
  };
}

async function list(
  deps: DocumentToolDeps,
  route: Route,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  const { unplaced, ...rest } = input;
  // unplaced는 tool 선택자다. 소유 route의 "자리 없음"은 place: null이다.
  const sent = unplaced === true ? { ...rest, place: null } : rest;
  const read = await deps.client.read(route, sent);
  if (!read.ok) {
    return failureOutput(read.error, [
      "lophn_index root로 읽을 수 있는 자리를 다시 읽는다",
    ]);
  }
  const value = read.value as Record<string, unknown>;
  const rows = (value.documents as {
    document: { status?: string };
  }[] | undefined) ?? [];
  const archived = rows.filter((row) => row.document.status === "archived")
    .length;
  const scope = unplaced === true
    ? "자리 없는 문서"
    : input.place === undefined
    ? "문서"
    : "자리의 문서";
  return {
    summary: withContinuation(
      `${scope} ${rows.length}개${
        archived > 0 ? ` (보관 ${archived}개 포함)` : ""
      }. 본문은 목록에 없다`,
      value,
    ),
    data: value,
    next: continuation(value).more
      ? ["next_cursor로 lophn_document list를 이어 읽는다"]
      : [
        "lophn_index document로 문서의 구역 목차를 읽는다",
        "lophn_document history로 판 이력을 읽는다",
      ],
  };
}

async function history(
  deps: DocumentToolDeps,
  route: Route,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  const { section, ...rest } = input;
  const read = section === undefined
    ? await deps.client.read(route, rest)
    : await deps.client.read(documentSectionHistory, { ...rest, section });
  if (!read.ok) {
    return failureOutput(read.error, [
      "lophn_document list로 읽을 수 있는 문서를 다시 읽는다",
    ]);
  }
  const value = read.value as Record<string, unknown>;
  if (section === undefined) {
    const versions = (value.versions as unknown[] | undefined) ?? [];
    return {
      summary: withContinuation(`고정 판 ${versions.length}개`, value),
      data: value,
      next: [
        "lophn_document history에 section을 넣어 한 구역의 변화를 읽는다",
        "lophn_document diff로 두 고정 판의 줄 차이를 읽는다",
      ],
    };
  }
  const entries = (value.entries as { status: string }[] | undefined) ?? [];
  const omissions = (value.omissions as Omission[] | undefined) ?? [];
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
  }
  const labels: [string, string][] = [
    ["added", "추가"],
    ["modified", "본문 변경"],
    ["missing", "소실"],
    ["unchanged", "변경 없음"],
  ];
  const parts = labels
    .filter(([status]) => (counts.get(status) ?? 0) > 0)
    .map(([status, label]) => `${label} ${counts.get(status)}`);
  return {
    summary: join(
      withContinuation(
        `구역 ${String(section)}의 판별 변화 ${entries.length}개${
          parts.length === 0 ? "" : ` (${parts.join(", ")})`
        }`,
        value,
      ),
      omissionNote(omissions),
      NO_RENAME_NOTE,
    ),
    data: value,
    next: [
      "lophn_document diff에 section을 넣어 두 판의 줄 차이를 읽는다",
      "lophn_read로 고정 판의 구역 본문을 읽는다",
    ],
  };
}

async function diff(
  deps: DocumentToolDeps,
  route: Route,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  const read = await deps.client.read(route, input);
  if (!read.ok) {
    return failureOutput(read.error, [
      "lophn_document history로 이 문서의 고정 판을 다시 읽는다",
    ]);
  }
  const value = read.value as Record<string, unknown>;
  const additions = (value.additions as unknown[] | undefined) ?? [];
  const deletions = (value.deletions as unknown[] | undefined) ?? [];
  const omissions = (value.omissions as Omission[] | undefined) ?? [];
  const same = additions.length === 0 && deletions.length === 0 &&
    omissions.length === 0 && continuation(value).more === false;
  const target = typeof input.section === "string"
    ? `구역 ${input.section}`
    : "문서 전체";
  return {
    summary: join(
      withContinuation(
        same
          ? `${target}: 두 판의 줄이 같다(변경 없음)`
          : `${target}: 추가 ${additions.length}곳, 삭제 ${deletions.length}곳`,
        value,
      ),
      omissionNote(omissions),
      NO_RENAME_NOTE,
    ),
    data: value,
    next: continuation(value).more
      ? ["next_cursor로 lophn_document diff를 이어 읽는다"]
      : ["lophn_read로 고정 판의 본문을 읽어 맥락을 확인한다"],
  };
}
