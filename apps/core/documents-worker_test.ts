// documents/file-tracking#R9·R3, documents/versions#R13: 제품 core가 documents worker를
// 실제 자식 프로세스로 띄우고 감독 pipe로 묻는다. 데이터 root는 temp dir다. 사람
// 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const TOKEN = "c".repeat(43);

async function openCore(
  superviseIo: boolean,
): Promise<{ core: Core; home: string }> {
  const home = await Deno.makeTempDir({ prefix: "lophn-docs-worker-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(3),
    testCredentials: true,
    superviseIo,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const context: AuthenticatedContext = {
    principal: "user-1",
    actor: "user",
    scope: { operations: ["files.status"], targets: {} },
    conditions: {},
    credential_ref: "cred-docs-worker",
  };
  const accepted = await started.value.acceptTestCredential?.(context, TOKEN);
  assert(accepted?.ok);
  const recorded = await started.value.record(context);
  assert(recorded.ok);
  return { core: started.value, home };
}

function status(port: number): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/v1/files/status`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      target: { kind: "project_file", project: PROJECT, path: "/work/a.md" },
    }),
  });
}

Deno.test("documents/file-tracking#R9: documents worker가 없으면 FileStatus는 추적 안 함이 아니라 unavailable이다", async () => {
  const { core, home } = await openCore(false);
  try {
    const answer = await status(core.port);
    const body = await answer.json() as { error?: { code?: string } };
    assertEquals(answer.status, 503);
    assertEquals(body.error?.code, "unavailable");
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("documents/file-tracking#R9: 실제 documents worker가 감독 pipe로 관측 없음을 답하면 추적 안 함이다", async () => {
  const { core, home } = await openCore(true);
  try {
    const answer = await status(core.port);
    const body = await answer.json() as {
      status?: { state?: string; observed_hash?: string | null };
    };
    assertEquals(answer.status, 200, JSON.stringify(body));
    assertEquals(body.status?.state, "not_tracked");
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
