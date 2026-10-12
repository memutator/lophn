import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../../protocol/server/mod.ts";

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

const registration = new URL("../../../../apps/core/apps.ts", import.meta.url);
const documents = new URL(
  "../../../../apps/core/documents.ts",
  import.meta.url,
);
// active_release 기입은 writer transaction 안에서 dispatch하는 fixture command로
// 남긴다. probeWrite는 rollback되므로 원본 표 기록으로 쓰지 않는다.
const runtimeFixtures = new URL("./testing/mod.ts", import.meta.url);

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
    await opened.command(
      user,
      envelope("app.create", `create-${slug}`, {
        slug,
        name: "Usage",
        description: "collect usage",
      }),
    ),
  );
  const id = (created.result as { id: string }).id;
  commandResult(
    await opened.command(
      user,
      envelope("runtime.tests.adopt_release", `adopt-${slug}`, {
        app: id,
        release: REL,
      }),
    ),
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

function started(nonce: string, release = REL) {
  return {
    app: "",
    process_nonce: nonce,
    started_at: "2026-10-05T00:00:00.000Z",
    attestation: {
      release,
      bundle_hash: "a".repeat(64),
      commands: ["usage.sync"],
      data_schema: 0,
      process_nonce: nonce,
      connection_ok: true,
    },
  };
}

async function runtimeOf(opened: LedgerHarness, id: string) {
  return value(
    await opened.read({ resource: "apps", method: "runtime" }, user, {
      app: id,
    }),
  ) as {
    state: { state: string; termination_pending: boolean; reason?: unknown };
    observation: unknown;
  };
}

async function eventTypes(opened: LedgerHarness, id: string) {
  const rows = value(
    await opened.inspect(
      "select type from events where subject = ? order by seq",
      [id],
    ),
  );
  return rows.map((row) => String(row.type));
}

Deno.test("apps/runtime#R13: enable은 보관·release 없음을 거절하고 revision을 새 seq로 올려 낡은 base_revision을 거절한다", async () => {
  const opened = await harness();
  try {
    // release 없는 앱은 invalid_input이다.
    const created = commandResult(
      await opened.command(
        user,
        envelope("app.create", "c0", {
          slug: "bare",
          name: "Bare",
          description: "d",
        }),
      ),
    );
    const bare = (created.result as { id: string }).id;
    code(
      await opened.command(
        user,
        envelope("app.enable_execution", "e0", {
          app: bare,
        }, { base_revision: await revision(opened, bare) }),
      ),
      "invalid_input",
    );
    const id = await openedApp(opened, "cas");
    const base = await revision(opened, id);
    const enabled = commandResult(
      await opened.command(
        user,
        envelope("app.enable_execution", "e1", {
          app: id,
        }, { base_revision: base }),
      ),
    );
    const next = (enabled.result as { revision: string }).revision;
    assert(next !== base);
    assertEquals(await revision(opened, id), next);
    // 낡은 base_revision은 conflict다.
    code(
      await opened.command(
        user,
        envelope("app.disable_execution", "d-old", {
          app: id,
        }, { base_revision: base }),
      ),
      "conflict",
    );
    // 모르는 앱은 not_found다.
    code(
      await opened.command(
        user,
        envelope("app.disable_execution", "d-x", {
          app: "app_01h455vb4pex5v6nkc6gd5fdw9",
        }, { base_revision: "1" }),
      ),
      "not_found",
    );
    // 보관한 앱은 허용하지 못한다.
    commandResult(
      await opened.command(
        user,
        envelope("app.archive", "a1", {
          app: id,
        }, { base_revision: next }),
      ),
    );
    code(
      await opened.command(
        user,
        envelope("app.enable_execution", "e2", {
          app: id,
        }, { base_revision: await revision(opened, id) }),
      ),
      "conflict",
    );
  } finally {
    await opened.close();
  }
});

Deno.test("apps/runtime#R13: machine record는 사람 CAS 없이 사실을 남기고 user는 record를 부를 수 없으며 과거 event만으로 running이라 하지 않는다", async () => {
  const opened = await harness();
  try {
    const id = await openedApp(opened, "records");
    commandResult(
      await opened.command(
        user,
        envelope("app.enable_execution", "en", {
          app: id,
        }, { base_revision: await revision(opened, id) }),
      ),
    );
    code(
      await opened.command(
        user,
        envelope("app.record_started", "u-rec", {
          ...started("n1"),
          app: id,
        }),
      ),
      "forbidden",
    );
    const result = commandResult(
      await opened.command(
        machine,
        envelope("app.record_started", "m1", {
          ...started("n1"),
          app: id,
        }),
      ),
    );
    // 방금 받은 attestation은 live 연결 확인이므로 그 응답의 state는 running이다.
    assertEquals(
      (result.result as { state: { state: string } }).state.state,
      "running",
    );
    // 같은 자식의 재전송은 AppStarted를 다시 남기지 않는다.
    commandResult(
      await opened.command(
        machine,
        envelope("app.record_started", "m1b", {
          ...started("n1"),
          app: id,
        }),
      ),
    );
    assertEquals(
      (await eventTypes(opened, id)).filter((t) => t === "AppStarted").length,
      1,
    );
    // 이후 runtime read는 supervisor 관측이 없으면 과거 AppStarted로 running이라 하지 않는다.
    const read = await runtimeOf(opened, id);
    assertEquals(read.state.state, "unavailable");
    assertEquals(read.observation, null);
    // attestation이 없는 release의 started는 contract가 거절한다.
    code(
      await opened.command(
        machine,
        envelope("app.record_started", "m-null", {
          ...started("n2", null as unknown as string),
          app: id,
        }),
      ),
      "invalid_input",
    );
  } finally {
    await opened.close();
  }
});

Deno.test("apps/runtime#R13: record_unavailable은 run_enabled를 바꾸지 않고 같은 근거의 연속 재전송만 가리며 그 사이 started가 있으면 새로 남긴다", async () => {
  const opened = await harness();
  try {
    const id = await openedApp(opened, "unavail");
    commandResult(
      await opened.command(
        user,
        envelope("app.enable_execution", "en", {
          app: id,
        }, { base_revision: await revision(opened, id) }),
      ),
    );
    const input = {
      app: id,
      release: REL,
      process_nonce: "n1",
      started_at: "2026-10-05T00:00:00.000Z",
      reason: { code: "unexpected_exit", summary: "the app process exited" },
    };
    const first = commandResult(
      await opened.command(
        machine,
        envelope("app.record_unavailable", "u1", input),
      ),
    );
    const state = (first.result as {
      state: { state: string; reason: { code: string } };
    }).state;
    assertEquals(state.state, "unavailable");
    assertEquals(state.reason.code, "unexpected_exit");
    commandResult(
      await opened.command(
        machine,
        envelope("app.record_unavailable", "u2", input),
      ),
    );
    commandResult(
      await opened.command(
        machine,
        envelope("app.record_started", "s", {
          ...started("n2"),
          app: id,
        }),
      ),
    );
    commandResult(
      await opened.command(
        machine,
        envelope("app.record_unavailable", "u3", {
          ...input,
          process_nonce: "n2",
        }),
      ),
    );
    const types = await eventTypes(opened, id);
    assertEquals(
      types.filter((t) => t === "AppUnavailable").length,
      2,
    );
    const got = value(
      await opened.read({ resource: "apps", method: "get" }, user, { app: id }),
    ) as { app: { run_enabled: boolean } };
    assertEquals(got.app.run_enabled, true);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/runtime#R15: 멈춤은 허용값만 닫고 종료 확인은 record_stopped가 한 번만 남긴다", async () => {
  const opened = await harness();
  try {
    const id = await openedApp(opened, "stop-usage");
    commandResult(
      await opened.command(
        user,
        envelope("app.enable_execution", "en", {
          app: id,
        }, { base_revision: await revision(opened, id) }),
      ),
    );
    commandResult(
      await opened.command(
        machine,
        envelope("app.record_started", "s", {
          ...started("n1"),
          app: id,
        }),
      ),
    );
    const disabled = commandResult(
      await opened.command(
        user,
        envelope("app.disable_execution", "dis", {
          app: id,
        }, { base_revision: await revision(opened, id) }),
      ),
    );
    assertEquals(
      (disabled.result as { run_enabled: boolean }).run_enabled,
      false,
    );
    // 관측 없이 읽으면 stopped이고, 종료 확인은 record_stopped의 응답이 말한다.
    assertEquals((await runtimeOf(opened, id)).state.state, "stopped");
    const stopped = commandResult(
      await opened.command(
        machine,
        envelope("app.record_stopped", "st", {
          app: id,
          release: REL,
          process_nonce: "n1",
          started_at: "2026-10-05T00:00:00.000Z",
          termination_confirmed: true,
        }),
      ),
    );
    assertEquals(
      (stopped.result as { state: unknown }).state,
      { state: "stopped", termination_pending: false },
    );
    commandResult(
      await opened.command(
        machine,
        envelope("app.record_stopped", "st2", {
          app: id,
          release: REL,
          process_nonce: "n1",
          started_at: "2026-10-05T00:00:00.000Z",
          termination_confirmed: true,
        }),
      ),
    );
    const types = await eventTypes(opened, id);
    assertEquals(types.filter((t) => t === "AppStopped").length, 1);
    assert(types.includes("AppExecutionDisabled"));
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R8: archive도 같은 순서로 닫히고 unarchive 뒤에도 사람의 허용 전에는 멈춤이 유지된다", async () => {
  const opened = await harness();
  try {
    const id = await openedApp(opened, "archived-app");
    commandResult(
      await opened.command(
        user,
        envelope("app.enable_execution", "enable-2", {
          app: id,
        }, { base_revision: await revision(opened, id) }),
      ),
    );
    commandResult(
      await opened.command(
        user,
        envelope("app.archive", "archive-1", {
          app: id,
        }, { base_revision: await revision(opened, id) }),
      ),
    );
    assertEquals((await runtimeOf(opened, id)).state.state, "stopped");
    commandResult(
      await opened.command(
        user,
        envelope("app.unarchive", "unarchive-1", {
          app: id,
        }, { base_revision: await revision(opened, id) }),
      ),
    );
    const back = value(
      await opened.read({ resource: "apps", method: "get" }, user, { app: id }),
    ) as { app: { run_enabled: boolean; status: string } };
    assertEquals(back.app.run_enabled, false);
    assertEquals(back.app.status, "active");
    assertEquals((await runtimeOf(opened, id)).state.state, "stopped");
  } finally {
    await opened.close();
  }
});
