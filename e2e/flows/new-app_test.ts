// apps#T27 flow new-app E2E(docs/flows/new-app.md) — 지금 제품이 실제로 가는 데까지만 본다.
// 제품 core(temp LOPHN_HOME)와 실제 apps supervisor·준비 자식을 띄우고(Electron은 띄우지 않는다, app-export
// flow와 같다) coding agent 자리가 MCP tool `lophn_app`으로 가는 길을 실제 core client로 돌린다:
// 앱을 코드·source·release 없이 등록한다(4) → 템플릿으로 만든 git repository를 source로 연결한다(7) →
// bundle을 준비해 고정 bundle hash를 받는다(8, `validate`) → 준비가 release를 확정하지 않음을 본다(active
// release 없음). coding agent 자리는 lophn-mcp handler를 core client로 직접 부른다(`tools/fake-coding-agent`의
// stdio 자식은 쓰지 않는다: 연결 credential 발급은 coding-agent#T36이라 시험 credential을 core에 직접 넣는다).
// 사람 데이터 root(~/.lophn)는 열지 않는다. 띄운 core 트리는 temp home 이름으로만 정리한다.
//
// 통로가 없어 볼 수 없는 것(T27 상태 줄에 적었다. 새 결함으로 리드가 따로 맡긴다):
// - release.prepare를 부르는 쪽(finalizer)이 제품 코드에 없다. prepare_bundle 완료·같은 bundle의 app test 통과
//   뒤 machine이 봉인 사본에서 blueprint·manifest·data_changes·tests를 모아 `release.prepare`를 부르는 길이
//   core·supervisor 어디에도 없어(apps#T19 이어보냄 (1)) new-app의 9 이후(preview 확인 → 적용 허락 →
//   activation → acceptance check)는 이 flow로 끝까지 돌 수 없다.
// 이 flow가 아직 돌리지 않은 것(통로가 없는 것이 아니라 하지 않았다):
// - 같은 bundle의 app test(RequestTest → Verification)와 preview. 둘 다 core 쪽 길은 있다.
// - 템플릿 앱이 운영 자식으로 뜨는 흐름(entry·`@lophn/base` 해석·read 허락).
// - ticket 없는 준비(`validate`)만 돈다. `release_prepare`는 ticket·claim이 필요하고 claim·보고는 coding-agent
//   slice E2E가 돈다.
import { assert, assertEquals } from "@std/assert";

import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import { createHandler } from "../../packages/coding-agent/mcp-server/server.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
import { createAppTool } from "../../packages/coding-agent/mcp-server/tools/app.ts";
import {
  installedHome,
  removeTree,
  scaffoldInto,
} from "../../packages/apps/sdk/testing/mod.ts";
import { createLedgerRegistration as createAppsRegistration } from "../../apps/core/apps.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "../../apps/core/documents.ts";
import { lophnAgentDefinitions } from "../../apps/core/lophn-agent.ts";
import { type Core, startCore } from "../../apps/core/core.ts";
import {
  createLedgerRegistration as createProblemsRegistration,
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "../../apps/core/problems.ts";
import { e2eEnabled } from "../harness.ts";

const TEAMS = [
  { lophnAgentDefinitions },
  { createLedgerRegistration: createDocumentsRegistration },
  { problemsTestDefinitions },
  { problemsReportDefinitions },
  { createLedgerRegistration: createProblemsRegistration },
  { createLedgerRegistration: createAppsRegistration },
];
const MODULES = [
  new URL("../../apps/core/lophn-agent.ts", import.meta.url).href,
  new URL("../../apps/core/documents.ts", import.meta.url).href,
  new URL("../../apps/core/problems.ts", import.meta.url).href,
  new URL("../../apps/core/apps.ts", import.meta.url).href,
];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const AGENT_TOKEN = "a".repeat(43);
const USER_TOKEN = "u".repeat(43);
const OPERATIONS = [
  "app.create",
  "app.connect_source",
  "app.list",
  "app.get",
  "app.runtime",
  "release.prepare_bundle",
  "release.preparation",
  "RequestTest",
  "GetTestRequest",
  "GetVerification",
  "ListVerifications",
];

async function git(cwd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}

type Reply = {
  isError: boolean;
  summary: string;
  data: Record<string, unknown>;
};

async function post(
  core: Core,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch { /* JSON이 아니다 */ }
  return { status: response.status, body: json };
}

async function accept(
  core: Core,
  context: AuthenticatedContext,
  token: string,
): Promise<void> {
  const accepted = await core.acceptTestCredential?.(context, token);
  assert(accepted?.ok);
  const recorded = await core.record(context);
  assert(recorded.ok);
}

Deno.test({
  name:
    "apps/registration#R2 R3, apps/releases#R1 R19 flow new-app(통로 있는 데까지): 새 앱을 등록해 템플릿 source로 bundle을 준비해도 release는 확정되지 않는다",
  ignore: !e2eEnabled(),
  fn: async () => {
    const installed = await installedHome();
    const home = installed.home;
    const source = await Deno.makeTempDir({ prefix: "lophn-e2e-new-app-" });
    const core: Core = await (async () => {
      const started = await startCore({
        lophnHome: home,
        port: 0,
        teams: TEAMS,
        teamModules: MODULES,
        writerClock: "system",
        testCredentials: true,
      });
      assert(started.ok, started.ok ? "" : started.error.message);
      return started.value;
    })();
    try {
      // 사람과 coding agent의 연결을 심는다. 앱은 아직 없으므로 전체 범위 연결이다.
      await accept(core, {
        principal: "user-1",
        actor: "user",
        scope: { operations: ["app.create", "app.get"], targets: {} },
        conditions: {},
        credential_ref: "cred-user",
      }, USER_TOKEN);
      await accept(core, {
        principal: `coding_agent:${CAC}`,
        actor: `coding_agent:${CAC}`,
        scope: { operations: OPERATIONS, targets: {} },
        conditions: {},
        credential_ref: "cred-agent",
      }, AGENT_TOKEN);
      const client = createCoreClient({
        baseUrl: `http://127.0.0.1:${core.port}`,
        connection: CAC,
        provider: () =>
          Promise.resolve({ ok: true, value: { token: AGENT_TOKEN } }),
      });
      const tool = createAppTool({
        client,
        idempotencyKey: () => `new-app-${crypto.randomUUID()}`,
        wait: { budget_ms: 0, interval_ms: 1 },
      });
      const handler = createHandler({
        toolsets: ["core", "app"],
        callTool: (name, args, context) => {
          const resolved = resolveRoute(name, (args as { op?: string }).op);
          assert(resolved, `route ${name}`);
          return tool(name, resolved.route, args, context);
        },
      });
      let id = 0;
      const agent = async (args: Record<string, unknown>): Promise<Reply> => {
        id += 1;
        const response = await handler(JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "lophn_app", arguments: args },
        }));
        assert(response !== undefined);
        assertEquals(response.error, undefined, JSON.stringify(response));
        const result = response.result as {
          isError?: boolean;
          structuredContent: { summary: string; data: unknown };
        };
        return {
          isError: result.isError === true,
          summary: result.structuredContent.summary,
          data: result.structuredContent.data as Record<string, unknown>,
        };
      };

      // 4: 앱을 코드·source·release 없이 등록한다.
      const registered = await agent({
        op: "register",
        slug: "ledger",
        name: "가계부",
        description: "한 달 지출을 적고 합계를 본다",
      });
      assertEquals(registered.isError, false, registered.summary);
      const app = String(registered.data.id);
      assertEquals(registered.data.source_path, null);
      assertEquals(registered.data.active_release, null);

      // 7: 템플릿에서 앱 source를 만들어 commit하고 연결한다.
      const dir = `${source}/app`;
      await scaffoldInto(installed, dir);
      await git(dir, ["init", "-q"]);
      await git(dir, ["config", "user.email", "dev@lophn.local"]);
      await git(dir, ["config", "user.name", "dev"]);
      await git(dir, ["add", "-A"]);
      await git(dir, ["commit", "-q", "-m", "init"]);
      const commit = await git(dir, ["rev-parse", "HEAD"]);
      const linked = await agent({ op: "source", app, source_path: dir });
      assertEquals(linked.isError, false, linked.summary);

      // 8: bundle을 준비한다. 접수는 release 확정이 아니다.
      const prepared = await agent({
        op: "validate",
        app,
        commit,
        request_key: "new-app-prep-1",
      });
      assertEquals(prepared.isError, false, prepared.summary);
      let done: Reply = prepared;
      const deadline = Date.now() + 120_000;
      while (done.data.status === "preparing" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        done = await agent({
          op: "preparation",
          app,
          request_key: "new-app-prep-1",
        });
      }
      assertEquals(done.data.status, "completed", JSON.stringify(done));
      const bundleHash = String(done.data.bundle_hash);
      assert(/^sha256:|^[0-9a-f]{64}$/.test(bundleHash), bundleHash);
      // 준비는 release 확정이 아니다: 앱에는 아직 active release가 없다.
      const shown = await agent({ op: "show", app });
      assertEquals(shown.isError, false, shown.summary);
      assertEquals(shown.data.active_release, null);
    } finally {
      await core.shutdown();
      await new Deno.Command("pkill", { args: ["-f", home] }).output().catch(
        () => undefined,
      );
      await new Deno.Command("chmod", { args: ["-R", "u+rwX", home] })
        .output().catch(() => undefined);
      await removeTree(source);
      await installed.dispose();
    }
  },
});
