import { assert, assertEquals } from "@std/assert";
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

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const APP_B = "app_01h455vb4pex5v6nkc6gd5fdw2";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const REL_B = "rel_01h455vb4pex5v6nkc6gd5fdw2";
const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const INV_2 = "inv_01h455vb4pex5v6nkc6gd5fdw2";
const RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const TOOL = "tcl_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T00:00:00.000Z";
const LATER = "2026-10-04T00:00:01.000Z";

const operations = [
  "invocation.record_started",
  "invocation.record_finished",
  "invocation.record_denied",
  "invocations.list",
  "invocations.get",
  "CommandResult",
];

function credential(
  overrides: Partial<AuthenticatedContext> = {},
): AuthenticatedContext {
  return {
    actor: "machine",
    principal: "task:check",
    credential_ref: "test:task:check",
    scope: { operations, targets: {} },
    conditions: {},
    ...overrides,
  };
}

const machine = credential();

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function commandResult(
  result: Result<CommandSuccess>,
): CommandSuccess {
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
): CommandEnvelope {
  return { command, input, compare: {}, idempotency_key: key, prepared: [] };
}

async function harness(): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: [registration],
      credentials: [machine],
    }),
  );
}

async function start(
  opened: LedgerHarness,
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<CommandSuccess> {
  return commandResult(
    await opened.command(
      machine,
      envelope("invocation.record_started", `start-${id}`, {
        invocation: id,
        app: APP,
        release: REL,
        mode: "live",
        actor: "user",
        caller: { kind: "direct" },
        operation: { kind: "command", command: "usage.sync" },
        trigger: { kind: "direct" },
        started_at: AT,
        ...overrides,
      }),
    ),
  );
}

async function finish(
  opened: LedgerHarness,
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<CommandSuccess> {
  return commandResult(
    await opened.command(
      machine,
      envelope("invocation.record_finished", `finish-${id}`, {
        invocation: id,
        status: "succeeded",
        started_at: AT,
        finished_at: LATER,
        summary: { code: "ok" },
        detail_hash: null,
        ...overrides,
      }),
    ),
  );
}

function got(result: Result<unknown>): {
  invocation: Record<string, unknown> | null;
} {
  return value(result) as { invocation: Record<string, unknown> | null };
}

Deno.test("apps/invocations#R3: release 교체 뒤에도 당시 release·operation·trigger·mode·actor·caller가 그대로다", async () => {
  const opened = await harness();
  try {
    await start(opened, INV);
    await finish(opened, INV);
    // release 교체 같은 이후 변화가 이 행의 사실을 바꾸는 통로가 없다.
    // terminal trigger는 갱신을 막고, 읽은 값의 사실은 당시 값이다.
    const got1 = got(
      await opened.read(
        { resource: "invocations", method: "get" },
        machine,
        { invocation: INV },
      ),
    );
    assert(got1.invocation !== null);
    assertEquals(got1.invocation.app, APP);
    assertEquals(got1.invocation.release, REL);
    assertEquals(got1.invocation.mode, "live");
    assertEquals(got1.invocation.actor, "user");
    assertEquals(got1.invocation.caller, { kind: "direct" });
    assertEquals(got1.invocation.operation, {
      kind: "command",
      command: "usage.sync",
    });
    assertEquals(got1.invocation.trigger, { kind: "direct" });
    assertEquals(got1.invocation.status, "succeeded");
    assertEquals(got1.invocation.started_at, AT);
    assertEquals(got1.invocation.finished_at, LATER);
    // machine actor로 시작 통보를 다시 내면 release가 달라도 무효다.
    code(
      await opened.command(
        machine,
        envelope("invocation.record_started", "start-late", {
          invocation: INV,
          app: APP,
          release: REL_B,
          mode: "preview",
          actor: "machine",
          caller: { kind: "automation", key: "nightly" },
          operation: { kind: "start" },
          trigger: { kind: "automation", key: "nightly" },
          started_at: LATER,
        }),
      ),
      "conflict",
    );
    const got2 = got(
      await opened.read(
        { resource: "invocations", method: "get" },
        machine,
        { invocation: INV },
      ),
    );
    assertEquals(got2.invocation?.release, REL);
    assertEquals(got2.invocation?.status, "succeeded");
  } finally {
    await opened.close();
  }
});

Deno.test("apps/releases#R17: command를 지운 새 release 뒤에도 당시 operation key가 그대로다", async () => {
  const opened = await harness();
  try {
    await start(opened, INV, {
      operation: { kind: "command", command: "usage.sync" },
    });
    await finish(opened, INV);
    // 새 release가 usage.sync command를 지웠어도 이 행은 당시 key로 읽는다.
    // invocation 읽기가 현재 blueprint를 보지 않는 것이 확인이다.
    const got1 = got(
      await opened.read(
        { resource: "invocations", method: "get" },
        machine,
        { invocation: INV },
      ),
    );
    assertEquals(got1.invocation?.operation, {
      kind: "command",
      command: "usage.sync",
    });
  } finally {
    await opened.close();
  }
});

Deno.test("apps/invocations#R16: A→B app caller와 agent run/tool_call caller를 구별하고 부모 없으면 없음이다", async () => {
  const opened = await harness();
  try {
    // 앱 B가 앱 A의 invocation을 부른다. caller는 B와 당시 release를 남긴다.
    await start(opened, INV, {
      caller: {
        kind: "app",
        app: APP_B,
        release: REL_B,
        parent_invocation: null,
      },
    });
    await finish(opened, INV);
    // agent가 같은 command를 부른다. caller는 run·tool_call을 남긴다.
    await start(opened, INV_2, {
      app: APP,
      caller: { kind: "agent", run: RUN, tool_call: TOOL },
    });
    await finish(opened, INV_2);
    const first = got(
      await opened.read(
        { resource: "invocations", method: "get" },
        machine,
        { invocation: INV },
      ),
    );
    assertEquals(first.invocation?.caller, {
      kind: "app",
      app: APP_B,
      release: REL_B,
      parent_invocation: null,
    });
    const second = got(
      await opened.read(
        { resource: "invocations", method: "get" },
        machine,
        { invocation: INV_2 },
      ),
    );
    assertEquals(second.invocation?.caller, {
      kind: "agent",
      run: RUN,
      tool_call: TOOL,
    });
  } finally {
    await opened.close();
  }
});

Deno.test("apps/invocations#R17: actor·caller는 machine 통보 안의 원래 요청자고 approval은 별도 참조다", async () => {
  const opened = await harness();
  try {
    // confirm 접수(approval 있는 행)는 T12다. 여기서는 record 명령이
    // actor를 machine으로 바꿔 저장하지 않는지 본다.
    await start(opened, INV);
    const got1 = got(
      await opened.read(
        { resource: "invocations", method: "get" },
        machine,
        { invocation: INV },
      ),
    );
    // 사람 요청자다. machine이 남긴 것이 아니다.
    assertEquals(got1.invocation?.actor, "user");
    assert(got1.invocation?.approval === null);
    // app caller도 원래 요청자를 남긴다. machine actor로 바뀌지 않는다.
    await start(opened, INV_2, {
      caller: { kind: "app", app: APP, release: REL, parent_invocation: null },
    });
    const got2 = got(
      await opened.read(
        { resource: "invocations", method: "get" },
        machine,
        { invocation: INV_2 },
      ),
    );
    assertEquals(got2.invocation?.actor, "user");
    assertEquals(got2.invocation?.caller, {
      kind: "app",
      app: APP,
      release: REL,
      parent_invocation: null,
    });
    assert(got2.invocation?.approval === null);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/invocations#R13: succeeded는 handler 반환일 뿐 업무 정확성 필드가 없다", async () => {
  const opened = await harness();
  try {
    await start(opened, INV);
    await finish(opened, INV, {
      summary: { code: "ok" },
    });
    const stored = value(
      await opened.inspect("select summary from invocations where id = ?", [
        INV,
      ]),
    );
    // 성공 summary는 code뿐이다. 업무 집계(problem 닫힘 등) 필드는 없다.
    assertEquals(JSON.parse(String(stored[0]?.summary)), { code: "ok" });
    const got1 = got(
      await opened.read(
        { resource: "invocations", method: "get" },
        machine,
        { invocation: INV },
      ),
    );
    assertEquals(Object.keys(got1.invocation ?? {}).sort(), [
      "actor",
      "app",
      "approval",
      "caller",
      "detail_hash",
      "finished_at",
      "id",
      "input_hash",
      "mode",
      "operation",
      "release",
      "started_at",
      "status",
      "summary",
      "trigger",
    ]);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/invocations#R15: 16KiB를 넘는 summary는 invalid_input이고 redaction 뒤 secret 원문이 없다", async () => {
  const opened = await harness();
  try {
    await start(opened, INV);
    const big = "a".repeat(17000);
    code(
      await opened.command(
        machine,
        envelope("invocation.record_finished", "finish-big", {
          invocation: INV,
          status: "succeeded",
          started_at: AT,
          finished_at: LATER,
          summary: { code: big },
          detail_hash: null,
        }),
      ),
      "invalid_input",
    );
    // 민감 key는 구조로 지운다. secret 원문값은 이력에 남지 않는다.
    await start(opened, INV_2);
    await finish(opened, INV_2, {
      summary: {
        code: "network_error",
        secret: "raw-credential-value",
        nested: { token: "raw-token" },
      },
    });
    const stored = value(
      await opened.inspect("select summary from invocations where id = ?", [
        INV_2,
      ]),
    );
    const text = String(stored[0]?.summary);
    assert(text.includes("raw-credential-value") === false);
    assert(text.includes("raw-token") === false);
    const parsed = JSON.parse(text);
    assertEquals(parsed.secret, "*");
    assertEquals(parsed.nested.token, "*");
    assertEquals(parsed.code, "network_error");
  } finally {
    await opened.close();
  }
});

Deno.test("apps/invocations#R6: 같은 key 재전송은 같은 결과고 다른 종료 사실은 conflict다", async () => {
  const opened = await harness();
  try {
    // record_started는 알려지지 않은 ID를 running으로 만든다.
    await start(opened, INV);
    await finish(opened, INV);
    // 종료 통보를 반복 보내도 결과 하나다.
    await finish(opened, INV);
    const rows = value(
      await opened.inspect(
        "select type, count(*) as n from events where subject = ? group by type order by type",
        [INV],
      ),
    );
    assertEquals(rows.map((row) => row.type), [
      "InvocationFinished",
      "InvocationStarted",
    ]);
    // 종료 뒤 다른 종료 결과는 거절이다.
    code(
      await opened.command(
        machine,
        envelope("invocation.record_finished", "finish-different", {
          invocation: INV,
          status: "failed",
          started_at: AT,
          finished_at: LATER,
          summary: { code: "no" },
          detail_hash: null,
        }),
      ),
      "conflict",
    );
    // 종료 뒤 시작 통보는 running으로 되돌리지 않는다. 같은 사실이면 무변경이고,
    // 상태는 succeeded 그대로다. 새 event도 남지 않는다.
    await opened.command(
      machine,
      envelope("invocation.record_started", "start-late", {
        invocation: INV,
        app: APP,
        release: REL,
        mode: "live",
        actor: "user",
        caller: { kind: "direct" },
        operation: { kind: "command", command: "usage.sync" },
        trigger: { kind: "direct" },
        started_at: AT,
      }),
    );
    const got1 = got(
      await opened.read(
        { resource: "invocations", method: "get" },
        machine,
        { invocation: INV },
      ),
    );
    assertEquals(got1.invocation?.status, "succeeded");
    // 늦은 시작 통보 뒤에도 event는 하나다.
    const after = value(
      await opened.inspect(
        "select type, count(*) as n from events where subject = ? group by type order by type",
        [INV],
      ),
    );
    assertEquals(after.map((row) => row.type), [
      "InvocationFinished",
      "InvocationStarted",
    ]);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/invocations#R10 #R2: 알려지지 않은 종료 사실은 호출을 만들지 않고 알려진 거절만 남긴다", async () => {
  const opened = await harness();
  try {
    // record_finished는 행을 만들지 않는다.
    code(
      await opened.command(
        machine,
        envelope("invocation.record_finished", "finish-absent", {
          invocation: INV,
          status: "succeeded",
          started_at: AT,
          finished_at: LATER,
          summary: { code: "ok" },
          detail_hash: null,
        }),
      ),
      "conflict",
    );
    const got1 = got(
      await opened.read(
        { resource: "invocations", method: "get" },
        machine,
        { invocation: INV },
      ),
    );
    assertEquals(got1.invocation, null);
    // 알려지지 않은 호출을 지어내지 않는다. record_denied는 인증된 연결이 선언된 command를
    // 부르다 handler 전에 거절된 알려진 호출을 started_at 없이 거절 행으로 남긴다(R2, R9).
    commandResult(
      await opened.command(
        machine,
        envelope("invocation.record_denied", "deny-absent", {
          invocation: INV_2,
          app: APP,
          release: REL,
          actor: "user",
          caller: { kind: "direct" },
          operation: { kind: "command", command: "usage.sync" },
          trigger: { kind: "direct" },
          finished_at: AT,
          summary: { reason: "grant missing" },
        }),
      ),
    );
    const got2 = got(
      await opened.read(
        { resource: "invocations", method: "get" },
        machine,
        { invocation: INV_2 },
      ),
    );
    assertEquals(got2.invocation?.status, "denied");
    assertEquals(got2.invocation?.started_at, null);
    assertEquals(got2.invocation?.approval, null);
    // 알려진 ID만 unknown으로 확정한다.
    await start(opened, INV);
    await finish(opened, INV, { status: "unknown", started_at: null });
    const got3 = got(
      await opened.read(
        { resource: "invocations", method: "get" },
        machine,
        { invocation: INV },
      ),
    );
    assertEquals(got3.invocation?.status, "unknown");
  } finally {
    await opened.close();
  }
});

Deno.test("apps/invocations#R3: list는 app·status filter와 cursor로 이어 본다", async () => {
  const opened = await harness();
  try {
    await start(opened, INV);
    await finish(opened, INV);
    await start(opened, INV_2, { app: APP_B });
    const listed = value(
      await opened.read({ resource: "invocations", method: "list" }, machine, {
        status: "succeeded",
      }),
    ) as {
      invocations: { id: string; status: string }[];
      next_cursor: string | null;
    };
    assertEquals(listed.invocations.map((row) => row.id), [INV]);
    assertEquals(listed.next_cursor, null);
    const all = value(
      await opened.read({ resource: "invocations", method: "list" }, machine, {
        limit: 1,
      }),
    ) as {
      invocations: { id: string }[];
      next_cursor: string | null;
    };
    assertEquals(all.invocations.length, 1);
    assert(all.next_cursor !== null);
  } finally {
    await opened.close();
  }
});
