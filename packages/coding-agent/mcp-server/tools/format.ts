// lophn_format tool의 실행이다(T14, mcp#R14). list·show는 설치된 선언을 읽고,
// validate는 파일 bytes 검사를 format 실행(worker) 요청으로 보낸다. 검사 결과를
// 호출자가 주장하는 입력은 없다: 입력 hash와 명시 여부는 이 tool이 정한다.
import { MCP_CORE_ROUTES } from "../../../protocol/coding-agent/mod.ts";
import type { Route } from "../../../protocol/server/mod.ts";
import {
  canonicalFilesHash,
  type FlowClient,
  type HashedFile,
  type PrepareBytes,
  type SubmissionScope,
  submitPaths,
} from "../../connection/mod.ts";
import { failureOutput, type ToolOutput, withoutOp } from "./output.ts";

export type FormatToolDeps = {
  client: Pick<FlowClient, "read">;
  // validate가 읽는 파일의 검사 범위와 bytes 제출 통로다. list·show는 쓰지 않는다.
  scope: SubmissionScope;
  prepareBytes: PrepareBytes;
};

type Declaration = {
  name: string;
  module_hash: string;
  media_types: string[];
  extracts?: boolean;
};

// 검사 page를 끝까지 읽되 무한히 따라가지 않는다.
const VALIDATE_PAGE_CAP = 50;

// 선언의 media type이 요청 type을 받는지. `image/*`·`*/*`는 넓은 선언이다.
function accepts(declared: string, wanted: string): boolean {
  if (declared === "*/*") return true;
  if (declared.endsWith("/*")) {
    return wanted.toLowerCase().startsWith(declared.slice(0, -1));
  }
  return declared.toLowerCase() === wanted.toLowerCase();
}

type ValidatePage = {
  input_hash: string;
  module_hash: string;
  status: "passed" | "failed";
  error_count: number;
  warning_count: number;
  diagnostics: unknown[];
  complete: boolean;
  next_cursor: string | null;
};

export function createFormatTool(
  deps: FormatToolDeps,
): (toolName: string, route: Route, input: unknown) => Promise<ToolOutput> {
  const routes = MCP_CORE_ROUTES.lophn_format as Record<string, Route>;
  return async function runFormatTool(_toolName, _route, rawInput) {
    const input = withoutOp(rawInput);
    const op = (rawInput as { op?: unknown } | undefined)?.op;
    const owned = typeof op === "string" && Object.hasOwn(routes, op)
      ? routes[op]
      : undefined;
    if (owned === undefined) {
      return failureOutput({
        code: "invalid_input",
        message: "format tool 표에 없는 op다",
        details: { op: typeof op === "string" ? op : null },
      }, ["lophn_format list, show, validate만 있다"]);
    }
    if (op === "list") return await list(deps, owned, input);
    if (op === "show") return await show(deps, owned, input);
    return await validate(deps, owned, input);
  };
}

async function list(
  deps: FormatToolDeps,
  route: Route,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  const wanted = typeof input.media_type === "string"
    ? input.media_type
    : undefined;
  const read = await deps.client.read(route, {});
  if (!read.ok) {
    return failureOutput(read.error, ["lophn_format list로 다시 읽는다"]);
  }
  const declared = (read.value as { formats: Declaration[] }).formats;
  const matched = declared.filter((format) =>
    wanted === undefined ||
    format.media_types.some((type) => accepts(type, wanted))
  );
  // 구체적인 선언이 먼저고 `*/*`(data)는 마지막 대안이다.
  matched.sort((left, right) =>
    Number(left.media_types.includes("*/*")) -
    Number(right.media_types.includes("*/*"))
  );
  return {
    summary: wanted === undefined
      ? `format ${matched.length}개`
      : `${wanted}에 맞는 format ${matched.length}개`,
    data: {
      formats: matched.map((format) => ({
        name: format.name,
        module_hash: format.module_hash,
        media_types: format.media_types,
        extracts: format.extracts ?? false,
      })),
    },
    next: ["lophn_format show로 선언과 작성 안내를 읽는다"],
  };
}

async function show(
  deps: FormatToolDeps,
  route: Route,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  const read = await deps.client.read(route, input);
  if (!read.ok) {
    return failureOutput(read.error, ["lophn_format list로 이름을 확인한다"]);
  }
  const declaration = read.value as Declaration;
  return {
    summary: `${declaration.name}: ${declaration.media_types.join(", ")}`,
    data: declaration,
    next: [
      "lophn_format validate로 파일이 이 format에 맞는지 검사한다",
      "lophn_save의 format에 name·module_hash를 넣어 명시한다",
    ],
  };
}

async function validate(
  deps: FormatToolDeps,
  route: Route,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  // 검사할 파일은 경로로 받아 제출 root 안에서 다시 검사한다. bytes는 core의 blob
  // 준비로 가고 호출자가 blob 참조를 주장하지 않는다.
  const submitted = await submitPaths(
    input.paths as string[],
    deps.scope,
    deps.prepareBytes,
  );
  if (!submitted.ok) {
    return failureOutput(submitted.error, [
      "제출 root 안의 파일 경로로 다시 검사한다",
    ]);
  }
  const files = submitted.value as HashedFile[];
  const { paths: _paths, ...routeInput } = input;
  // 입력 hash는 문서 저장 준비가 쓰는 정의와 같다. 호출자 주장이 아니다.
  const inputHash = await canonicalFilesHash(files);
  const diagnostics: unknown[] = [];
  let cursor: string | undefined;
  let last: ValidatePage | undefined;
  for (let page = 0; page < VALIDATE_PAGE_CAP; page += 1) {
    const read = await deps.client.read(route, {
      ...routeInput,
      files: submitted.value,
      input_hash: inputHash,
      explicit: true,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!read.ok) {
      return failureOutput(read.error, [
        "lophn_format show로 format을 확인한다",
      ]);
    }
    last = read.value as ValidatePage;
    diagnostics.push(...last.diagnostics);
    if (last.complete || last.next_cursor === null) break;
    cursor = last.next_cursor;
  }
  const done = last!;
  const complete = done.complete;
  return {
    summary:
      `${done.status}: error ${done.error_count}, warning ${done.warning_count}${
        complete ? "" : " (진단을 끝까지 읽지 못했다)"
      }`,
    data: {
      status: done.status,
      module_hash: done.module_hash,
      input_hash: done.input_hash,
      error_count: done.error_count,
      warning_count: done.warning_count,
      diagnostics,
      complete,
    },
    next: done.status === "passed"
      ? ["lophn_save로 저장한다"]
      : ["진단의 file·줄 위치를 고친 뒤 다시 validate한다"],
  };
}
