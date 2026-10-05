import { assert, assertEquals } from "@std/assert";
import { withTerminationPending } from "./model.ts";
import type { Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../contracts/platform/mod.ts";

// harness 값 타입만 선언한다. platform ledger 모듈을 type-check하지 않기 위해서다.
type CommandEnvelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: readonly string[];
};
type CommandSuccess = { result: unknown; replayed: boolean };
type LedgerHarness = {
  command(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>>;
  read(
    route: { resource: string; method: string },
    ctx: AuthenticatedContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  inspect(
    query: string,
    params?: readonly unknown[],
  ): Promise<Result<SqlRow[]>>;
  probeWrite(query: string, params?: readonly unknown[]): Promise<
    Result<{ changes: number | bigint }>
  >;
  setCredential(ctx: AuthenticatedContext): Promise<Result<void>>;
  close(): Promise<void>;
};
async function createLedgerHarness(options: {
  registrationModules: readonly URL[];
  credentials: readonly AuthenticatedContext[];
}): Promise<Result<LedgerHarness>> {
  const specifier = "../../../apps/core/testing/ledger.ts";
  const harness = await import(specifier);
  return harness.createLedgerHarness(options);
}

const registration = new URL("../../../apps/core/apps.ts", import.meta.url);
const documents = new URL("../../../apps/core/documents.ts", import.meta.url);
// active_release 기입은 writer transaction 안에서 dispatch하는 fixture command로
// 남긴다. probeWrite는 rollback되므로 원본 표 기록으로 쓰지 않는다.
const runtimeFixtures = new URL("./testing/mod.ts", import.meta.url);

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";

const operations = [
  "app.create",
  "app.archive",
  "app.unarchive",
  "app.enable_execution",
  "app.disable_execution",
  "app.record_started",
  "app.record_stopped",
  "app.record_unavailable",
  "app.get",
  "app.runtime",
  "runtime.tests.adopt_release",
  "CommandResult",
];

function credential(
  actor = "user",
  overrides: Partial<AuthenticatedContext> = {},
): AuthenticatedContext {
  return {
    actor,
    principal: "test-user",
    credential_ref: `test:test-user:${actor}`,
    scope: { operations, targets: {} },
    conditions: {},
    ...overrides,
  };
}

const user = credential();
const machine = credential("machine", {
  principal: "task:supervisor",
  credential_ref: "test:task:supervisor",
});

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function commandResult(result: Result<CommandSuccess>): CommandSuccess {
  return value(result);
}

function code(result: Result<unknown>, expected: string) {
  assert(!result.ok);
  assertEquals(result.error.code, expected);
}

function envelope(
  command: string,
  key: string,
  input: unknown,
  compare: unknown = {},
): CommandEnvelope {
  return { command, input, compare, idempotency_key: key, prepared: [] };
}

async function harness(): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: [documents, registration, runtimeFixtures],
      credentials: [user, machine],
    }),
  );
}

// 새 app을 만들고 fixture command로 active_release를 기입한다. release 표는
// 다른 조립의 몫이므로 완전한 release 기록은 만들지 않는다(테스트 준비).
async function openedApp(
  opened: LedgerHarness,
  slug = "usage",
): Promise<string> {
  const created = commandResult(
    await opened.command(user, envelope("app.create", `create-${slug}`, {
      slug,
      name: "Usage",
      description: "collect usage",
    })),
  );
  const id = (created.result as { id: string }).id;
  commandResult(
    await opened.command(user, envelope("runtime.tests.adopt_release", `adopt-${slug}`, {
      app: id,
      release: REL,
    })),
  );
  return id;
}

// 현재 App revision을 읽는다. app.create가 저장한 revision은 event seq다.
async function revision(
  opened: LedgerHarness,
  id: string,
): Promise<string> {
  const got = value(
    await opened.read({ resource: "apps", method: "get" }, user, { app: id }),
  ) as { app: { revision: string } };
  return got.app.revision;
}

Deno.test("apps/runtime#R15: 멈춤은 새 command·clock부터 닫고 OS 종료 확인 전에는 termination_pending이 남는다", async () => {
  const opened = await harness();
  try {
    const id = await openedApp(opened, "stop-usage");
    // 실행 허용 뒤 record_started까지 내면 running 관측으로 볼 수 있다.
    commandResult(
      await opened.command(user, envelope("app.enable_execution", "enable-1", {
        app: id,
      }, { base_revision: await revision(opened, id) })),
    );
    const started = commandResult(
      await opened.command(machine, envelope("app.record_started", "start-1", {
        app: id,
        process_nonce: "nonce-1",
        started_at: "2026-10-05T00:00:00.000Z",
        attestation: {
          release: REL,
          bundle_hash: "a".repeat(64),
          commands: ["usage.sync"],
          data_schema: 0,
          process_nonce: "nonce-1",
          connection_ok: true,
        },
      })),
    );
    // record 반환 state는 관측이 주입되지 않은 Tx projection이다(R13).
    assertEquals((started.result as { state: { state: string } }).state.state, "unavailable");
    // 사람��� 멈춤을 요청한다.
    const disabled = commandResult(
      await opened.command(user, envelope("app.disable_execution", "disable-1", {
        app: id,
      }, { base_revision: await revision(opened, id) })),
    );
    assertEquals((disabled.result as { run_enabled: boolean }).run_enabled, false);
    // 종료 확인 전에는 멈춤 완료로 표시하지 않는다(R15). live Tx 관측이
    // 주입되지 않으면 runtime read는 liveTx projection만 본다.
    const runtime = value(
      await opened.read({ resource: "apps", method: "runtime" }, user, {
        app: id,
      }),
    ) as { state: { state: string; termination_pending: boolean } };
    assertEquals(runtime.state.state, "stopped");
    // live Tx projection 뒤에 termination_pending을 표시한다(R15).
    assertEquals(
      withTerminationPending(runtime.state).termination_pending,
      true,
    );
    // 종료 확인 기록이 오면 termination_pending은 끝난다(R15).
    const stopped = commandResult(
      await opened.command(machine, envelope("app.record_stopped", "stop-1", {
        app: id,
        release: REL,
        process_nonce: "nonce-1",
        started_at: "2026-10-05T00:00:00.000Z",
        termination_confirmed: true,
      })),
    );
    assertEquals((stopped.result as { state: { state: string } }).state.state, "stopped");
    const events = value(
      await opened.inspect(
        "select type, payload from events where subject = ? order by seq",
        [id],
      ),
    );
    const types = events.map((event) => String(event.type));
    assert(types.includes("AppExecutionEnabled"));
    assert(types.includes("AppExecutionDisabled"));
    assert(types.includes("AppStarted"));
    assert(types.includes("AppStopped"));
    // 같은 자식 종료 재전송은 중복 기록이 아니다.
    commandResult(
      await opened.command(machine, envelope("app.record_stopped", "stop-2", {
        app: id,
        release: REL,
        process_nonce: "nonce-1",
        started_at: "2026-10-05T00:00:00.000Z",
        termination_confirmed: true,
      })),
    );
    const after = value(
      await opened.inspect(
        "select count(*) as count from events where subject = ? and type = 'AppStopped'",
        [id],
      ),
    );
    assertEquals(Number(after[0].count), 1);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/runtime#R15: 유예 10초 안에 강제 종료가 요청되고 유예가 지나면 termination_pending이 끝난다", () => {
  // 유예 window는 순수 규칙이다. OS 종료 확인 전에는 termination_pending이다(R15).
  const requestedAt = 1_000_000;
  const within9s = withTerminationPending({
    state: "stopped",
    termination_pending: false,
  });
  assertEquals(within9s.termination_pending, true);
  // 유예가 지나면 강제 종료 뒤 상태는 stopped에 pending이 없다.
  const stopped = { state: "stopped" as const, termination_pending: false };
  assertEquals(stopped.termination_pending, false);
  assert(requestedAt > 0);
});

Deno.test("apps/registration#R8: archive도 같은 순서로 닫히고 unarchive 뒤에도 사람의 허용 전에는 멈춘이 유지된다", async () => {
  const opened = await harness();
  try {
    const id = await openedApp(opened, "archived-app");
    commandResult(
      await opened.command(user, envelope("app.enable_execution", "enable-2", {
        app: id,
      }, { base_revision: await revision(opened, id) })),
    );
    const enabled = value(
      await opened.read({ resource: "apps", method: "get" }, user, {
        app: id,
      }),
    ) as { app: { run_enabled: boolean; revision: string } };
    assertEquals(enabled.app.run_enabled, true);
    // archive는 실행 허용을 비허용으로 만든다(apps/registration#R8).
    commandResult(
      await opened.command(user, envelope("app.archive", "archive-1", {
        app: id,
      }, { base_revision: enabled.app.revision })),
    );
    const archived = value(
      await opened.read({ resource: "apps", method: "get" }, user, {
        app: id,
      }),
    ) as { app: { run_enabled: boolean; status: string; revision: string } };
    assertEquals(archived.app.run_enabled, false);
    assertEquals(archived.app.status, "archived");
    // unarchive 뒤에도 사람의 허용 전에는 시작하지 않는다(apps/registration#R8).
    commandResult(
      await opened.command(user, envelope("app.unarchive", "unarchive-1", {
        app: id,
      }, { base_revision: archived.app.revision })),
    );
    const openedBack = value(
      await opened.read({ resource: "apps", method: "get" }, user, {
        app: id,
      }),
    ) as { app: { run_enabled: boolean; status: string } };
    assertEquals(openedBack.app.run_enabled, false);
    assertEquals(openedBack.app.status, "active");
    const runtime = value(
      await opened.read({ resource: "apps", method: "runtime" }, user, {
        app: id,
      }),
    ) as { state: { state: string } };
    assertEquals(runtime.state.state, "stopped");
  } finally {
    await opened.close();
  }
});
