// lophn_read tool의 실행이다(T13, mcp#R10). 고정 판의 본문(선택 구역·줄 범위)을 소유 읽기
// route 하나로 읽는다. 입력의 reference는 고정 판이라 읽는 중 새 판이 생겨도 같은 판을
// 이어 읽고, 새 판이 있으면 결과가 그것을 알린다. 두 가지 실패를 구별한다: 문서·판이
// 없거나 범위 밖이면 isError(없는 것과 같은 not_found)이고, 판은 있으나 본문을 뽑지 못했거나
// 지원하지 않는 형식이면 오류가 아닌 결과로 이유와 원문 파일 참조를 낸다.
import { MCP_CORE_ROUTES } from "../../../protocol/coding-agent/mod.ts";
import type { Route } from "../../../protocol/base/mod.ts";
import type { FlowClient } from "../../connection/mod.ts";
import { failureOutput, type ToolOutput } from "./output.ts";

export type ReadToolDeps = { client: Pick<FlowClient, "read"> };

type ReadValue = {
  document: string;
  version: string;
  latest_version: string;
  section: string | null;
  section_status: string;
  text: string | null;
  redacted: boolean;
  failure_reason: string | null;
  omission_reason: string | null;
  complete: boolean;
  next_cursor: string | null;
  file: { version: string; path: string } | null;
};

export function createReadTool(
  deps: ReadToolDeps,
): (toolName: string, route: Route, input: unknown) => Promise<ToolOutput> {
  const route = MCP_CORE_ROUTES.lophn_read as unknown as Route;
  return async function runReadTool(_toolName, _route, rawInput) {
    const read = await deps.client.read(route, rawInput);
    if (!read.ok) {
      // cursor가 다른 판·구역·범위에서 왔거나 만료됐으면 이유가 그대로 온다.
      return failureOutput(read.error, [
        "lophn_index document로 고정 판과 구역 key를 다시 읽는다",
      ]);
    }
    return describe(read.value as ReadValue);
  };
}

function describe(value: ReadValue): ToolOutput {
  const stale = value.version !== value.latest_version;
  const staleNote = stale
    ? `고정 판은 최신 판이 아니다. 새 판(${value.latest_version})이 있다. 이 결과는 요청한 고정 판의 본문이다`
    : "";
  const where = value.section === null ? "문서 전체" : `구역 ${value.section}`;
  const tail = (head: string) =>
    staleNote === "" ? head : `${head}. ${staleNote}`;
  const nextLatest = stale
    ? [
      "새 판을 읽으려면 reference.version을 latest_version으로 바꿔 다시 읽는다",
    ]
    : [];
  switch (value.section_status) {
    case "missing":
      return {
        summary: tail(`${where}이 이 판에 없다`),
        data: value,
        next: [
          "lophn_index document로 이 판의 구역 key를 다시 읽는다",
          ...nextLatest,
        ],
      };
    case "unverified":
      return {
        summary: tail(
          `${where}의 구조를 확인하지 못했다(${value.failure_reason}). 원문 파일은 있다. 없는 문서가 아니다`,
        ),
        data: value,
        next: ["data.file의 고정 판 파일이 원문이다", ...nextLatest],
      };
    case "unsupported":
      return {
        summary: tail(
          `이 format은 본문 읽기를 지원하지 않는다. 원문 파일은 있다. 없는 문서가 아니다`,
        ),
        data: value,
        next: ["data.file의 고정 판 파일이 원문이다", ...nextLatest],
      };
  }
  if (value.text === null) {
    // 본문이 숨겨진 읽기다. 빈 본문과 구별되게 이유를 낸다.
    return {
      summary: tail(
        `${where}의 본문을 내지 않았다(${
          value.omission_reason ?? "이유 없음"
        })`,
      ),
      data: value,
      next: nextLatest,
    };
  }
  const more = !value.complete || value.next_cursor !== null;
  const characters = [...value.text].length;
  return {
    summary: tail(
      `${where} 본문 ${characters}자${
        more ? ". 이어 읽을 범위가 남았다(next_cursor)" : ", 끝까지 읽었다"
      }${value.redacted ? ". 일부는 가려졌다" : ""}`,
    ),
    data: value,
    next: more
      ? [
        "next_cursor를 넣고 같은 reference로 lophn_read를 이어 읽는다. 새 판이 생겨도 같은 판을 읽는다",
        ...nextLatest,
      ]
      : nextLatest,
  };
}
