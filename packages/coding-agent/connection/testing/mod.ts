// connection의 테스트 전용 fixture다. mod.ts에서 내보내지 않고 다른 leaf의 테스트는
// 이 파일을 직접 import한다(code-map). core client의 호출 모양을 기록하고 route별로
// 답을 정해 주는 흐름 client와, 준비를 마친 문서 파일 입력 예를 낸다.
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import { ROUTES as appsRoutes } from "../../../protocol/apps/mod.ts";
import { ROUTES as codingAgentRoutes } from "../../../protocol/coding-agent/mod.ts";
import { ROUTES as documentsRoutes } from "../../../protocol/projects/mod.ts";
import { ROUTES as lophnAgentRoutes } from "../../../protocol/lophn-agent/mod.ts";
import { ROUTES as platformRoutes } from "../../../protocol/platform/mod.ts";
import { ROUTES as problemsRoutes } from "../../../protocol/problems/mod.ts";
import type { DocumentFileInput } from "../../../protocol/projects/mod.ts";
import type { CommandRoute, Route } from "../../../protocol/platform/mod.ts";
import type { FlowClient } from "../document-save.ts";
import type { PrepareBytes, SubmissionScope } from "../submission.ts";

export type Sent = {
  kind: "read" | "command";
  name: string;
  input: unknown;
  idempotency_key?: string;
  compare?: unknown;
  prepared?: readonly string[];
};

export type Reply =
  | Result<unknown, LophnError>
  | Record<string, unknown>
  | unknown[];
type Handler = Reply | ((input: unknown) => Reply);

export type ScriptedFlow = {
  client: FlowClient;
  sent: Sent[];
  // route 이름(`document.prepare`)의 호출만 걸러 본다.
  calls(name: string): Sent[];
};

// handlers는 route 이름 → 답이다. 함수면 입력을 받아 답을 만든다. 답이 `{ error }`로
// 시작하는 Result(`fail`)면 오류이고, 그렇지 않으면 성공 값이다. 없는 route는 테스트가
// 부르지 않아야 할 호출이라 실패시킨다.
export function scriptedFlow(
  handlers: Record<string, Handler>,
): ScriptedFlow {
  const sent: Sent[] = [];
  function answer(name: string, input: unknown): Result<unknown, LophnError> {
    const handler = handlers[name];
    if (handler === undefined) {
      throw new Error(`예상하지 못한 호출이다: ${name}`);
    }
    const reply = typeof handler === "function" ? handler(input) : handler;
    if (
      typeof reply === "object" && reply !== null && "ok" in reply &&
      typeof (reply as { ok: unknown }).ok === "boolean"
    ) return reply as Result<unknown, LophnError>;
    return ok(reply);
  }
  const client: FlowClient = {
    command(route: CommandRoute, body) {
      sent.push({
        kind: "command",
        name: route.name,
        input: body.input,
        idempotency_key: body.idempotency_key,
        compare: body.compare,
        prepared: body.prepared,
      });
      return Promise.resolve(answer(route.name, body.input));
    },
    read(route: Route, input: unknown) {
      sent.push({ kind: "read", name: route.name, input });
      return Promise.resolve(answer(route.name, input));
    },
  };
  return {
    client,
    sent,
    calls: (name) => sent.filter((call) => call.name === name),
  };
}

export function fail(
  code: LophnError["code"],
  message: string,
  details?: Record<string, unknown>,
): Result<never, LophnError> {
  return err({ code, message, ...(details ? { details } : {}) });
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

// 준비를 마친 두 파일(첫 파일이 primary)이다.
export function documentFiles(): DocumentFileInput[] {
  return [
    {
      path: "plan.md",
      media_type: "text/markdown",
      bytes: 7,
      blob_hash: HASH_A,
      primary: true,
      content: {
        kind: "prepared",
        blob: {
          preparation: "prep-a",
          principal: "cac",
          purpose: "document_file",
          hash: HASH_A,
          size_bytes: 7,
        },
      },
    },
    {
      path: "extra.txt",
      media_type: "text/plain",
      bytes: 5,
      blob_hash: HASH_B,
      primary: false,
      content: {
        kind: "prepared",
        blob: {
          preparation: "prep-b",
          principal: "cac",
          purpose: "document_file",
          hash: HASH_B,
          size_bytes: 5,
        },
      },
    },
  ];
}

export const PROJECT_PLACE = {
  kind: "project" as const,
  id: "prj_01arz3ndektsv4rrffq69g5fav",
};
export const SERIES_ID = "ser_01arz3ndektsv4rrffq69g5fav";
export const VERSION_1 = "ver_01arz3ndektsv4rrffq69g5fav";
export const VERSION_2 = "ver_01arz3ndektsv4rrffq69g5faw";
export const FORMAT_HASH = "c".repeat(64);

// document.prepare가 돌려주는 PreparedVersion 모양이다. 입력의 document·base·key를 이어 받는다.
export function preparedFor(input: unknown): Record<string, unknown> {
  const request = input as {
    document: string;
    base_version: string | null;
    metadata?: unknown;
    idempotency_key: string;
    format?: unknown;
  };
  return {
    document: request.document,
    base_version: request.base_version,
    files_hash: HASH_A,
    file_count: 2,
    primary_path: "plan.md",
    content_hash: HASH_A,
    preparation_ref: `prep-ref-${request.idempotency_key}`,
    idempotency_key: request.idempotency_key,
    ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    format: request.format ??
      { name: "document", module_hash: FORMAT_HASH, explicit: false },
    validation: {
      input_hash: HASH_A,
      module_hash: FORMAT_HASH,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    source: null,
  };
}

export function savedResult(
  status: "saved" | "unchanged",
  document: string,
  warnings: unknown[] = [],
) {
  return {
    status,
    document,
    version: status === "saved" ? VERSION_1 : VERSION_2,
    reference: {
      place: "notes",
      document: "plan",
      section: null,
      version: status === "saved" ? 1 : 2,
    },
    warnings,
    event_seq: status === "saved" ? "7" : null,
  };
}

export type Workspace = {
  scope: SubmissionScope;
  data: string;
  // prepareBytes가 받은 파일 경로(문서 안 경로) 목록이다.
  prepared: string[];
  prepareBytes: PrepareBytes;
  cleanup(): Promise<void>;
};

// 제출 root(notes/plan.md, notes/extra.txt)와 그 밖의 운영 data 폴더를 실제 temp에 만든다.
// prepareBytes는 core 대신 읽은 hash·크기 그대로 준비 참조를 돌려준다.
export async function workspace(): Promise<Workspace> {
  const base = await Deno.makeTempDir({ prefix: "lophn-submit-" });
  const root = await Deno.realPath(base);
  const data = `${root}-data`;
  await Deno.mkdir(`${root}/notes`);
  await Deno.mkdir(data);
  await Deno.writeTextFile(`${root}/notes/plan.md`, "# plan\n");
  await Deno.writeTextFile(`${root}/notes/extra.txt`, "extra");
  await Deno.writeTextFile(`${data}/ledger.sqlite`, "secret");
  const prepared: string[] = [];
  return {
    scope: { root, forbidden: [data] },
    data,
    prepared,
    prepareBytes: (file) => {
      prepared.push(file.path);
      return Promise.resolve(ok({
        preparation: `prep-${file.path}`,
        principal: "cac",
        purpose: "document_file",
        hash: file.blob_hash,
        size_bytes: file.bytes,
      }));
    },
    async cleanup() {
      await Deno.remove(root, { recursive: true });
      await Deno.remove(data, { recursive: true });
    },
  };
}

// 모든 최상위 계약의 route를 이름으로 찾는 표다. 금지 route가 계약 표에 실제로 있는지,
// 두 통로가 부르는 route가 coding_agent actor를 받는지 보는 시험이 쓴다.
export type ContractRoute = { name: string; actors: readonly string[] };

export function contractRoutesByName(): Map<string, ContractRoute> {
  const all = [
    ...platformRoutes,
    ...documentsRoutes,
    ...codingAgentRoutes,
    ...appsRoutes,
    ...problemsRoutes,
    ...lophnAgentRoutes,
  ] as readonly ContractRoute[];
  return new Map(all.map((route) => [route.name, route]));
}
