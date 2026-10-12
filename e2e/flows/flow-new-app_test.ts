// apps#T27 flow new-app E2E(docs/flows/new-app.md) — 지금 제품이 실제로 가는 데까지만 본다.
// 제품 core(temp LOPHN_HOME)와 실제 apps supervisor·준비 자식을 띄우고(Electron은 띄우지 않는다, app-export
// flow와 같다) coding agent 자리가 MCP tool `lophn_app`으로 가는 길을 실제 core client로 돌린다:
// 앱을 코드·source·release 없이 등록한다(4) → 템플릿으로 만든 git repository를 source로 연결한다(7) →
// bundle을 준비해 고정 bundle hash를 받는다(8, `validate`) → 준비가 release를 확정하지 않음을 본다(active
// release 없음). coding agent 자리는 lophn-mcp handler를 core client로 직접 부른다(`tools/fake-coding-agent`의
// stdio 자식은 쓰지 않는다: 연결 credential 발급은 coding-agent#T36이라 시험 credential을 core에 직접 넣는다).
// 사람 데이터 root(~/.lophn)는 열지 않는다. 띄운 core 트리는 temp home 이름으로만 정리한다.
//
// release.prepare를 부르는 쪽(finalizer)은 core가 쥔다(apps/core/apps-release-finalizer.ts). ticket claim을 가진
// coding agent의 prepare_bundle 접수가 끝났고 같은 bundle hash의 app test가 통과로 기록돼 있으면 준비를 읽을 때
// 확정된다(apps/core/release-finalizer_test.ts가 본다). 이 flow는 같은 bundle의 app test를 아직 돌리지 않아
// new-app의 9 이후(preview 확인 → 적용 허락 → activation → acceptance check)는 남는다.
// 이 flow가 아직 돌리지 않은 것(통로가 없는 것이 아니라 하지 않았다):
// - 같은 bundle의 app test(RequestTest → Verification)와 preview. 둘 다 core 쪽 길은 있다.
// - 템플릿 앱이 운영 자식으로 뜨는 흐름(entry·`@lophn/base` 해석·read 허락).
// - ticket 없는 준비(`validate`)만 돈다. `release_prepare`는 ticket·claim이 필요하고 claim·보고는 coding-agent
//   slice E2E가 돈다.
import { assert, assertEquals } from "@std/assert";

import type { AuthenticatedContext } from "../../packages/protocol/platform/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import { createHandler } from "../../packages/coding-agent/mcp-server/server.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
import { createAppTool } from "../../packages/coding-agent/mcp-server/tools/app.ts";
import { DatabaseSync } from "node:sqlite";
import { deriveAppTest } from "../../packages/problems/tests/mod.ts";
import {
  installedHome,
  removeTree,
  scaffoldInto,
} from "../../packages/apps/sdk/testing/mod.ts";
import { madeFixture } from "../../apps/core/testing/problems-app-test.ts";
import { codingAgentConnectionDefinitions } from "../../apps/core/coding-agent.ts";
import { ticketDefinitions } from "../../apps/core/tickets.ts";
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
const SCOPED_TOKEN = "s".repeat(43);
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
        // 제품 기동처럼 앱 supervisor(준비 자식)를 띄운다.
        appSupervisor: true,
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
      assertEquals(
        (shown.data.app as { active_release: unknown }).active_release,
        null,
      );
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

// 8~9단계(app test → 준비 확정). 앞 단계와 달리 coding agent가 ticket claim을 쥔 채 release_prepare로 bundle을 준비하고,
// 같은 bundle hash의 app test를 실제 runner(test-runner kind)로 돌려 Verification을 얻는다. core finalizer는 통과일 때만
// prepared release를 세운다(화면 있는 앱은 core runner에서 pass가 될 수 없어 그 확정 단계는 ignore다). ticket과 claim 행은 documents 판이 필요한 ticket 생성·claim 통로를 돌리지 않으려고
// ledger에 직접 둔다(coding-agent#T41 쪽이 그 통로를 본다). Verification은 runner가 남긴 것만 쓴다.
const STAGE_TEAMS = [
  ...TEAMS,
  { codingAgentConnectionDefinitions },
  { ticketDefinitions },
];
const STAGE_MODULES = [
  ...MODULES,
  new URL("../../apps/core/coding-agent.ts", import.meta.url).href,
  new URL("../../apps/core/tickets.ts", import.meta.url).href,
];
const TICKET = "tkt_01arz3ndektsv4rrffq69g5fav";
const CLAIM_SEQ = "3";

function ledger<T>(home: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return run(db);
  } finally {
    db.close();
  }
}

Deno.test({
  name:
    "apps/releases#R5 R6, problems/tests#R1 R4 flow new-app 8: 같은 bundle의 app test를 실제 runner로 돌려 기록하고, 통과가 아니면 release를 준비하지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const installed = await installedHome();
    const made = await madeFixture("broken", installed);
    const home = installed.home;
    const core: Core = await (async () => {
      const started = await startCore({
        lophnHome: home,
        port: 0,
        teams: STAGE_TEAMS,
        teamModules: STAGE_MODULES,
        writerClock: "system",
        testCredentials: true,
        // 제품 기동처럼 앱 supervisor(준비 자식)를 띄운다.
        appSupervisor: true,
      });
      assert(started.ok, started.ok ? "" : started.error.message);
      return started.value;
    })();
    try {
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
      // 앱을 등록하기 전에는 전체 범위 연결이고, 등록한 뒤에는 그 앱 범위로 좁힌 연결로 바꾼다.
      let token = AGENT_TOKEN;
      const client = createCoreClient({
        baseUrl: `http://127.0.0.1:${core.port}`,
        connection: CAC,
        provider: () => Promise.resolve({ ok: true, value: { token } }),
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

      const registered = await agent({
        op: "register",
        slug: "usage",
        name: "사용 기록",
        description: "앱 사용 기록을 남긴다",
      });
      assertEquals(registered.isError, false, registered.summary);
      const app = String(registered.data.id);
      await accept(core, {
        principal: `coding_agent:${CAC}`,
        actor: `coding_agent:${CAC}`,
        scope: { operations: OPERATIONS, targets: { app } },
        conditions: { app },
        credential_ref: "cred-agent-app",
      }, SCOPED_TOKEN);
      token = SCOPED_TOKEN;
      const commit = await made.commit();
      const linked = await agent({ op: "source", app, source_path: made.dir });
      assertEquals(linked.isError, false, linked.summary);

      // coding agent가 지정 ticket의 claim을 쥔다.
      ledger(home, (db) => {
        db.prepare(
          `insert into tickets (id, app, kind, title, what, why, inspect, preserve, problems,
             state, readiness, needs, cancel_reason, completion_seq, revision)
           values (?, ?, 'implementation', 't', 'w', 'y', '[]', '[]', '[]', 'claimed', 'ready',
             '[]', NULL, NULL, '1')`,
        ).run(TICKET, app);
        db.prepare(
          `insert into ticket_claims (ticket, connection, claim_seq, expires_at)
           values (?, ?, ?, '2099-01-01T00:00:00.000Z')`,
        ).run(TICKET, CAC, CLAIM_SEQ);
      });
      const releases = () =>
        ledger(home, (db) =>
          db.prepare(
            "select id, bundle_hash, code_commit, status, ticket_source from releases where app = ?",
          ).all(app) as {
            id: string;
            bundle_hash: string;
            code_commit: string;
            status: string;
            ticket_source: string;
          }[]);

      // 8: 준비한다. 접수한 쪽은 ticket claim을 가진 coding agent다.
      const prepare = {
        op: "release_prepare",
        app,
        commit,
        request_key: "new-app-fin-1",
        ticket_source: { ticket: TICKET, claim_seq: CLAIM_SEQ },
      };
      let done = await agent(prepare);
      // 기동 직후에는 app supervisor가 아직 준비 중일 수 있다. 접수되지 않았으니 같은 요청을 다시 보낸다.
      const ready = Date.now() + 60_000;
      while (
        done.isError && done.summary.includes("not ready") &&
        Date.now() < ready
      ) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        done = await agent(prepare);
      }
      assertEquals(done.isError, false, done.summary);
      const deadline = Date.now() + 120_000;
      while (done.data.status === "preparing" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        done = await agent({
          op: "preparation",
          app,
          request_key: "new-app-fin-1",
        });
      }
      assertEquals(done.data.status, "completed", JSON.stringify(done));
      const bundleHash = String(done.data.bundle_hash);
      // 준비가 끝났어도 같은 bundle의 통과한 app test가 없으면 release는 없다.
      assertEquals(releases().length, 0);

      // 같은 묶음을 대상으로 app test를 실제 runner로 돌린다.
      const copy = `${home}/apps/${app}/bundles/${bundleHash}`;
      const derived = await deriveAppTest(copy, bundleHash);
      assert(derived.ok, derived.ok ? "" : derived.reason);
      const testRequest = {
        op: "test",
        request_key: "new-app-test-1",
        kind: "app_test",
        app,
        target: { bundle_hash: bundleHash, release: null },
        problem: null,
        basis_seq: null,
        reports: [],
        before: null,
        after: null,
        ticket: null,
        test: derived.value.test_hash,
      };
      let tested = await agent(testRequest);
      const testDeadline = Date.now() + 600_000;
      while (
        tested.data.real_test !== true && !tested.isError &&
        Date.now() < testDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        tested = await agent(testRequest);
      }
      // runner가 실제로 돌려 Verification을 남겼다. 이 bundle을 대상으로 한 app_test 기록이다.
      assertEquals(tested.data.real_test, true, JSON.stringify(tested));
      const verification = tested.data.verification as {
        id: string;
        kind: string;
        result: string;
        target: { bundle_hash: string };
      };
      assertEquals(verification.kind, "app_test");
      assertEquals(verification.target.bundle_hash, bundleHash);
      // 통과가 아니면(미통과·판정 불가) 준비를 읽어도 release는 서지 않는다.
      if (verification.result !== "pass") {
        const reread = await agent({
          op: "preparation",
          app,
          request_key: "new-app-fin-1",
        });
        assertEquals(reread.isError, false, reread.summary);
        assertEquals(releases().length, 0);
      }
      // 제품 결함으로 막혀 있다: core runner의 collector에는 test mode feedback 접수 통로가 없어
      // (apps/worker/problems/runner-service.ts collectorFor) 화면 있는 앱의 feedback 검사가 통과하지 못하고,
      // 화면 검사 host(SCREEN_TEST_HOST)도 dev에는 없다. 화면 있는 template·fixture는 모두 app test가 pass가 되지 않아
      // 아래 확정을 실제 통과 Verification으로 돌릴 수 없다. problems/tests#R7에서 넘어온 것.
      await t.step({
        name: "통과 기록 뒤 준비를 읽으면 그 test로 prepared release가 선다",
        ignore: true,
        fn: async () => {
          assertEquals(verification.result, "pass");
          const confirmed = await agent({
            op: "preparation",
            app,
            request_key: "new-app-fin-1",
          });
          assertEquals(confirmed.isError, false, confirmed.summary);
          const rows = releases();
          assertEquals(rows.length, 1);
          assertEquals(rows[0].bundle_hash, bundleHash);
          assertEquals(rows[0].code_commit, commit);
          assertEquals(rows[0].status, "prepared");
          assertEquals(JSON.parse(rows[0].ticket_source), {
            ticket: TICKET,
            claim_seq: CLAIM_SEQ,
          });
          assertEquals(
            ledger(home, (db) =>
              (db.prepare(
                "select verification from release_tests where release = ?",
              ).all(rows[0].id) as { verification: string }[]).map((row) =>
                row.verification
              )),
            [verification.id],
          );
          // 준비 확정은 적용이 아니다.
          const shown = await agent({ op: "show", app });
          assertEquals(
            (shown.data.app as { active_release: unknown }).active_release,
            null,
          );
        },
      });
    } finally {
      await core.shutdown();
      await new Deno.Command("pkill", { args: ["-f", home] }).output().catch(
        () => undefined,
      );
      await new Deno.Command("chmod", { args: ["-R", "u+rwX", home] })
        .output().catch(() => undefined);
      await made.dispose();
    }
  },
});
