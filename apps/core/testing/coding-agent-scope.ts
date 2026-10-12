// coding-agent#T15 범위 시험이 쓰는 core 조립이다. 실제 core(documents·apps 등록과 I/O
// worker)를 temp 데이터 root에 띄우고, 전체 범위 연결과 앱 하나 범위 연결 두 개의
// credential을 같은 core에 심는다. 이 fixture는 시험 전용이고 mod.ts로 내보내지 않는다.
// 사람 데이터 root는 열지 않는다.
import { createHash } from "node:crypto";
import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../../packages/base/mod.ts";
import { extractFormat } from "../../../packages/core/projects/formats/guest.ts";
import {
  derivedPath,
  type DerivedStore,
  openDerived,
} from "../../../packages/core/projects/outline-and-search/adapters/store.ts";
import { recordExtraction } from "../../../packages/core/projects/outline-and-search/extraction.ts";
import type { AuthenticatedContext } from "../../../packages/protocol/server/mod.ts";
import { codingExternalCredential } from "../../../packages/core/server/identity/mod.ts";
import { createCoreClient } from "../../../packages/coding-agent/connection/client/core.ts";
import {
  type PathSaveDeps,
  uploadPrepareBytes,
} from "../../../packages/coding-agent/connection/mod.ts";
import {
  createHandler,
  resolveRoute,
} from "../../../packages/coding-agent/mcp-server/mod.ts";
import { createDocumentTool } from "../../../packages/coding-agent/mcp-server/tools/document.ts";
import { createFormatTool } from "../../../packages/coding-agent/mcp-server/tools/format.ts";
import { createIndexTool } from "../../../packages/coding-agent/mcp-server/tools/index.ts";
import { createProjectTool } from "../../../packages/coding-agent/mcp-server/tools/project.ts";
import { createReadTool } from "../../../packages/coding-agent/mcp-server/tools/read.ts";
import { createSaveTool } from "../../../packages/coding-agent/mcp-server/tools/save.ts";
import { createSeriesTool } from "../../../packages/coding-agent/mcp-server/tools/series.ts";
import { createLedgerRegistration as createAppsRegistration } from "../apps.ts";
import { codingAgentConnectionDefinitions } from "../coding-agent.ts";
import { type Core, startCore } from "../core.ts";
import { createLedgerRegistration } from "../documents.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "../lophn-agent.ts";
import {
  createLedgerRegistration as createProblemsRegistration,
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "../problems.ts";
import type { TeamModule } from "../registration.ts";
import { ticketDefinitions } from "../tickets.ts";

// 사람이 만든 project의 ID다. 앱 ID는 core가 정하므로 world가 만든 값을 읽는다.
export const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";

const CAC_ALL = "cac_01arz3ndektsv4rrffq69g5fav";
const CAC_A = "cac_01arz3ndektsv4rrffq69g5faw";
const CAC_B = "cac_01arz3ndektsv4rrffq69g5fax";

// 문서 읽기·저장 통로가 쓰는 route의 operation 이름이다. 사람이 연결을 만들 때 주는
// 허용 operation의 시험용 모양이고, 금지 route는 하나도 들어 있지 않다.
export const DOCUMENT_OPERATIONS: readonly string[] = [
  "document.upload",
  "document.prepare",
  "document.save",
  "document.list",
  "document.get",
  "document.history",
  "document.read",
  "document.section_history",
  "document.diff",
  "outline.root",
  "outline.place",
  "outline.document",
  "search.query",
  "search.status",
  "project.list",
  "project.get",
  "project.resolve_cwd",
  "format.list",
  "format.get",
  "format.validate",
  "series.list",
  "series.get",
  "series.next",
];

export type Who = "all" | "appA" | "appB";

const TOKENS: Record<Who, string> = {
  all: "a".repeat(43),
  appA: "b".repeat(43),
  appB: "c".repeat(43),
};
const USER_TOKEN = "u".repeat(43);

const CONNECTIONS: Record<Who, string> = {
  all: CAC_ALL,
  appA: CAC_A,
  appB: CAC_B,
};

// 제품 core의 조립(main.ts)과 같은 팀 목록이다. 금지 route가 실제 handler에 닿아야 거절이
// 뜻을 가진다.
function teamsFor(): TeamModule[] {
  return [
    { createLedgerRegistration },
    { createLedgerRegistration: createAppsRegistration },
    { problemsTestDefinitions },
    { problemsReportDefinitions },
    { createLedgerRegistration: createProblemsRegistration },
    { codingAgentConnectionDefinitions },
    { lophnAgentDefinitions },
    { createLedgerRegistration: createLophnAgentRegistration },
    { ticketDefinitions },
  ];
}

// MCP tools/call 한 번의 결과다. structuredContent와 text는 같은 사실이다.
export type McpReply = {
  isError: boolean;
  summary: string;
  data: Record<string, unknown>;
  next: string[];
};

export type ScopeWorld = {
  core: Core;
  // 같은 core에 사람이 등록한 두 앱의 ID다. appA·appB 연결은 각각 그 앱 자리만 닿는다.
  appA: string;
  appB: string;
  project: string;
  home: string;
  work: string;
  baseUrl: string;
  connection(who: Who): string;
  token(who: Who): string;
  clientOf(who: Who): ReturnType<typeof createCoreClient>;
  saveDeps(who: Who, forbidden?: readonly string[]): PathSaveDeps;
  mcp(who: Who, name: string, args: Record<string, unknown>): Promise<McpReply>;
  // 저장한 판을 실제 document format module로 추출해 파생 store에 심고 장부 끝까지
  // 반영됐다고 표시한다. consumer 조립은 documents 몫이라 시험이 직접 심는다.
  index(
    saved: { document: string; version: string },
    slug: string,
    text: string,
  ): Promise<void>;
  post(
    who: Who | "user" | string,
    path: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }>;
  // 허용 operation을 따로 준 coding_agent 연결을 더한다. 반환값은 post의 who다.
  addAgent(
    name: string,
    operations: readonly string[],
    targets?: Record<string, string>,
  ): Promise<string>;
  dispose(): Promise<void>;
};

// operations는 두 통로 표에서 나온 route 이름이고, 범위(targets)가 앱 하나로 좁은
// 연결은 그 앱 자리의 문서만 닿는다.
export async function openScopeWorld(
  operations: readonly string[],
): Promise<ScopeWorld> {
  const home = await Deno.makeTempDir({ prefix: "lophn-scope-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-scope-work-" }),
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: teamsFor(),
    teamModules: [
      new URL("../documents.ts", import.meta.url).href,
      new URL("../apps.ts", import.meta.url).href,
      new URL("../problems.ts", import.meta.url).href,
      new URL("../coding-agent.ts", import.meta.url).href,
      new URL("../lophn-agent.ts", import.meta.url).href,
      new URL("../tickets.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(77),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  // 발급(platform/identity의 `codingExternalCredential`)이 내는 모양 그대로다. 앱 하나 연결은
  // `targets.app`·`conditions.app`이고 문서 owner는 문서 자리의 앱을 target에 줘서 맞춘다.
  const agent = (
    who: Who,
    app: string | null,
  ): AuthenticatedContext => {
    const issued = codingExternalCredential(
      CONNECTIONS[who],
      app === null ? { kind: "all", app: null } : { kind: "app", app },
    );
    return {
      principal: issued.principal,
      actor: issued.actor,
      scope: { operations: [...operations], targets: issued.targets },
      conditions: issued.conditions,
      credential_ref: `cred-${who}`,
    };
  };
  async function accept(context: AuthenticatedContext, token: string) {
    const accepted = await core.acceptTestCredential?.(context, token);
    assert(accepted?.ok);
    const recorded = await core.record(context);
    assert(recorded.ok);
  }
  await accept(agent("all", null), TOKENS.all);
  await accept({
    principal: "user",
    actor: "user",
    scope: { operations: ["project.create", "app.create"], targets: {} },
    conditions: {},
    credential_ref: "cred-user",
  }, USER_TOKEN);
  const baseUrl = `http://127.0.0.1:${core.port}`;
  const appIds: string[] = [];
  for (const slug of ["notes", "ledger"]) {
    const created = await postJson(baseUrl, USER_TOKEN, "apps/create", {
      input: { slug, name: slug, description: `${slug} app` },
      idempotency_key: `app-${slug}`,
      compare: {},
      prepared: [],
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    appIds.push((created.body as { id: string }).id);
  }
  const [appA, appB] = appIds;
  await accept(agent("appA", appA), TOKENS.appA);
  await accept(agent("appB", appB), TOKENS.appB);
  const projectBody = await postJson(baseUrl, USER_TOKEN, "projects/create", {
    input: {
      id: PROJECT,
      name: "mahas",
      title: "Notes",
      purpose: "작업 기록",
      folders: [{
        path: `${work}/project-folder`,
        description: "비공개 폴더 설명",
      }],
      tracking: {
        enabled: false,
        patterns: [{ effect: "exclude", glob: "secret-rule/**" }],
        use_gitignore: false,
      },
    },
    idempotency_key: "project-1",
    compare: {},
    prepared: [],
  });
  assertEquals(projectBody.status, 200, JSON.stringify(projectBody.body));
  const clientOf = (who: Who) =>
    createCoreClient({
      baseUrl,
      connection: CONNECTIONS[who],
      provider: () =>
        Promise.resolve({ ok: true, value: { token: TOKENS[who] } }),
    });
  await Deno.mkdir(`${home}/derived`, { recursive: true });
  const opened = openDerived(derivedPath(`${home}/derived`));
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const store: DerivedStore = opened.value;
  const handlers = new Map<Who, ReturnType<typeof createHandler>>();
  function handlerOf(who: Who) {
    const existing = handlers.get(who);
    if (existing !== undefined) return existing;
    const client = clientOf(who);
    const save = createSaveTool({
      client,
      scope: { root: work, forbidden: [home] },
      prepareBytes: uploadPrepareBytes(client),
    });
    const tools = {
      lophn_index: createIndexTool({ client }),
      lophn_project: createProjectTool({ client }),
      lophn_document: createDocumentTool({ client }),
      lophn_read: createReadTool({ client }),
      lophn_format: createFormatTool({
        client,
        scope: { root: work, forbidden: [home] },
        prepareBytes: uploadPrepareBytes(client),
      }),
      lophn_series: createSeriesTool({ client }),
      lophn_save: save,
    };
    const handler = createHandler({
      callTool: (name, args) => {
        const op = (args as { op?: string }).op;
        const resolved = resolveRoute(name, op);
        assert(resolved, `route ${name} ${op}`);
        const run = tools[name as keyof typeof tools];
        assert(run, `tool ${name}`);
        return run(name, resolved.route, args);
      },
    });
    handlers.set(who, handler);
    return handler;
  }
  const extraTokens = new Map<string, string>();
  let rpcId = 0;
  return {
    core,
    appA,
    appB,
    project: PROJECT,
    home,
    work,
    baseUrl,
    async index(saved, slug, text) {
      const fixed = await postJson(baseUrl, TOKENS.all, "documents/get", {
        document: saved.document,
        version: saved.version,
      });
      const version = (fixed.body as {
        version: { content_hash: string; format: { module_hash: string } };
      }).version;
      const bytes = new TextEncoder().encode(text);
      const result = extractFormat("document", {
        input_hash: createHash("sha256").update(bytes).digest("hex"),
        module_hash: version.format.module_hash,
        files: [{
          path: `${slug}.md`,
          media_type: "text/markdown",
          primary: true,
          content: Array.from(bytes),
        }],
      });
      assertEquals(result.status, "ready");
      if (result.status !== "ready") return;
      const written = recordExtraction(store, {
        document: saved.document,
        version: saved.version,
        content_hash: version.content_hash,
        module_hash: version.format.module_hash,
        extraction: {
          status: "ready",
          title: result.title ?? undefined,
          text: result.text,
          text_hash: result.text_hash,
          sections: result.sections,
        },
      }, "1");
      assert(written.ok, written.ok ? "" : written.error.message);
      const basis = await postJson(baseUrl, TOKENS.all, "documents/list", {});
      const seq = String((basis.body as { as_of_seq: string }).as_of_seq);
      const cursor = store.transaction((tx) =>
        ok(tx.sql.run(
          `INSERT OR REPLACE INTO derived_cursors (consumer, processed_seq, rebuilding) VALUES ('search', ?, 0)`,
          [seq],
        ))
      );
      assert(cursor.ok);
    },
    async mcp(who, name, args) {
      rpcId += 1;
      const response = await handlerOf(who)(JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId,
        method: "tools/call",
        params: { name, arguments: args },
      }));
      assert(response !== undefined);
      assertEquals(response.error, undefined, JSON.stringify(response));
      const result = response.result as {
        isError?: boolean;
        structuredContent: { summary: string; data: unknown; next: string[] };
        content: { text: string }[];
      };
      assertEquals(
        JSON.parse(result.content[0].text),
        result.structuredContent,
      );
      return {
        isError: result.isError === true,
        summary: result.structuredContent.summary,
        data: result.structuredContent.data as Record<string, unknown>,
        next: result.structuredContent.next,
      };
    },
    connection: (who) => CONNECTIONS[who],
    token: (who) => TOKENS[who],
    clientOf,
    saveDeps(who, forbidden = [home]) {
      const client = clientOf(who);
      return {
        client,
        scope: { root: work, forbidden },
        prepareBytes: uploadPrepareBytes(client),
      };
    },
    async addAgent(name, extraOperations, targets = {}) {
      extraTokens.set(name, `${name}`.padEnd(43, "x").slice(0, 43));
      const id = `cac_01arz3ndektsv4rrffq69g5f${extraTokens.size + 10}`;
      await accept({
        principal: `coding_agent:${id}`,
        actor: `coding_agent:${id}`,
        scope: { operations: [...extraOperations], targets },
        conditions: {},
        credential_ref: `cred-${name}`,
      }, extraTokens.get(name)!);
      return name;
    },
    post: (who, path, body) =>
      postJson(
        baseUrl,
        who === "user"
          ? USER_TOKEN
          : extraTokens.get(who) ?? TOKENS[who as Who],
        path,
        body,
      ),
    async dispose() {
      store.close();
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(work, { recursive: true });
    },
  };
}

async function postJson(
  baseUrl: string,
  token: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
