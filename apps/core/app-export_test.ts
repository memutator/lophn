// /v1/apps/export의 실제 core 경로 테스트(apps/data#R13, architecture/apps 5.4).
// 등록은 apps.ts workerRoutes가 하고, serving은 core가 제품 기동에서 직접 붙인다(apps-export.ts).
// 이 테스트는 workers seam 없이 core를 제품 방식으로 띄운다. 앱·release 행은 등록 transaction이
// 남기는 모양으로 심는다(blob_test.ts seedRef와 같은 길이다). 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import { removeTree } from "../../packages/core/apps/packages/testing/mod.ts";
import { startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./apps.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";
import {
  APP,
  OTHER_APP,
  seedBundleAndSdk,
  seedDatabase,
  seedLedger,
} from "./testing/app-export-fixtures.ts";

const NOW_MS = Date.UTC(2024, 0, 1);

const teams: TeamModule[] = [{ createLedgerRegistration }];

type ExportBody = {
  app?: string;
  state?: string;
  reason?: { code?: string; summary?: string };
  includes_external_data?: boolean;
  error?: { code?: string; message?: string };
};

function userContext(
  operations: string[],
  ref: string,
  conditions: Record<string, string> = {},
): AuthenticatedContext {
  return {
    principal: "user-1",
    actor: "user",
    scope: { operations, targets: {} },
    conditions,
    credential_ref: ref,
  } as AuthenticatedContext;
}

async function post(
  port: number,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: ExportBody }> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as ExportBody };
}

Deno.test(
  "apps/data#R13: workers seam 없이 띄운 core의 /v1/apps/export는 내 앱을 ready로 답하고 없는 앱과 범위 밖 앱을 같은 not_found로 닫는다",
  async () => {
    const home = await Deno.makeTempDir({ prefix: "lophn-app-export-core-" });
    const started = await startCore({
      lophnHome: home,
      port: 0,
      teams,
      teamModules: [new URL("./apps.ts", import.meta.url).href],
      clock: manualClock(NOW_MS),
      random: seededRandom(11),
      testCredentials: true,
      superviseIo: false,
    });
    assert(started.ok, started.ok ? "" : started.error.message);
    await using guard = closeUnlessKept(async () => {
      await started.value.shutdown();
      // 봉인 디렉터리를 풀고 지운다(sdk testing removeTree).
      await removeTree(home);
    });
    const core = started.value;
    // scope.operations는 route name "app.export"를 넣는다(credential operation scope).
    const owner = userContext(["app.export"], "cred-export");
    const token = "b".repeat(43);
    const scoped = userContext(["app.export"], "cred-scoped", { app: APP });
    const scopedToken = "c".repeat(43);
    for (const [context, secret] of [[owner, token], [scoped, scopedToken]]) {
      const accepted = await core.acceptTestCredential?.(
        context as AuthenticatedContext,
        secret as string,
      );
      assert(accepted?.ok, "test credential seed failed");
      const recorded = await core.record(context as AuthenticatedContext);
      assert(recorded.ok, recorded.ok ? "" : recorded.error?.message ?? "");
    }
    guard.keep();
    try {
      const fixtures = await seedBundleAndSdk(home);
      const dataArea = `${home}/apps/${APP}/data`;
      const databasePath = `${dataArea}/app.sqlite`;
      await Deno.mkdir(dataArea, { recursive: true });
      seedDatabase(databasePath).close();
      seedLedger(home, fixtures.blueprintJson, fixtures.bundleHash);

      const answer = await post(core.port, "apps/export", { app: APP }, token);
      assertEquals(answer.status, 200, JSON.stringify(answer.body));
      assertEquals(answer.body.app, APP);
      assertEquals(answer.body.state, "ready");
      assertEquals(answer.body.includes_external_data, false);

      // 없는 앱과 범위 밖 앱은 같은 답이다(존재를 새지 않는다). 둘 다 503이 아니다.
      const absent = await post(core.port, "apps/export", {
        app: "app_01h455vb4pex5v6nkc6gd5fdw3",
      }, token);
      assertEquals(absent.status, 404, JSON.stringify(absent.body));
      const other = await post(
        core.port,
        "apps/export",
        { app: OTHER_APP },
        scopedToken,
      );
      assertEquals(other.status, 404, JSON.stringify(other.body));
      assertEquals(other.body.error?.code, absent.body.error?.code);
      assertEquals(other.body.error?.message, absent.body.error?.message);
    } finally {
      await core.shutdown();
      // 봉인 디렉터리(export 안 bundle·SDK 사본)를 풀고 지운다(sdk testing removeTree).
      await removeTree(home);
    }
  },
);
