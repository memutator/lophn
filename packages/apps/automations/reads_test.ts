import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import {
  appAutomations,
  type AutomationView,
  type RuntimeObservation,
} from "../../contracts/apps/mod.ts";
import {
  type ReadSnapshot,
  type RequestContext,
  TargetAuthorization,
} from "../../contracts/platform/mod.ts";
import {
  AUTOMATION_REASONS,
  createAutomationReads,
  withAutomationObservation,
} from "./reads.ts";
import type { DatabaseSync } from "node:sqlite";
import type { App } from "../../contracts/apps/mod.ts";
import { invocationsSchemaSteps } from "../invocations/testing/mod.ts";
import { createGrantSnapshot } from "../permissions/testing/mod.ts";

// ---- apps.automations read 시험용 ledger snapshot ----
// 실제 schema의 메모리 DB다. 다른 leaf의 fixture는 *_test.ts에서만 import할 수 있어 이 시험 안에 둔다.

export const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
export const OTHER_APP = "app_01h455vb4pex5v6nkc6gd5fdw2";
export const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
export const HASH = "ab".repeat(32);

export type AutomationSnapshot = {
  snapshot: ReadSnapshot;
  db: DatabaseSync;
  close(): void;
};

// 실제 apps·grants·invocations 표(실제 schema)를 가진 메모리 DB다. 현재 release 선언은 permissions
// fixture의 reader port와 같은 구현이 시험 표에서 읽는다.
export function createAutomationSnapshot(): AutomationSnapshot {
  const opened = createGrantSnapshot({ withDeclarations: true });
  for (const step of invocationsSchemaSteps) opened.db.exec(step.sql);
  return opened;
}

export function seedApp(
  db: DatabaseSync,
  over: Partial<Pick<App, "active_release" | "run_enabled" | "status">> = {},
  id = APP,
): void {
  const app = {
    active_release: RELEASE as string | null,
    run_enabled: true,
    status: "active",
    ...over,
  };
  db.prepare(
    `INSERT INTO apps (id, slug, name, description, planning_version,
       source_path, active_release, run_enabled, revision, status)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, '1', ?)`,
  ).run(
    id,
    `slug-${id.slice(-4)}`,
    "Usage",
    "an app",
    app.active_release,
    app.run_enabled ? 1 : 0,
    app.status,
  );
}

export type DeclaredAutomation = {
  key: string;
  command: string;
  external: boolean;
  input_hash: string;
  when: { kind: "on_start" } | { kind: "interval"; interval_ms: number };
};

export function declareAutomations(
  db: DatabaseSync,
  automations: readonly DeclaredAutomation[],
  app = APP,
  release = RELEASE,
): void {
  db.prepare(
    `INSERT INTO permissions_test_declarations (app, body) VALUES (?, ?)
     ON CONFLICT(app) DO UPDATE SET body = excluded.body`,
  ).run(
    app,
    JSON.stringify({
      release,
      permissions: [],
      app_connections: [],
      commands: [...new Set(automations.map((a) => a.command))],
      automations,
    }),
  );
}

let grantCounter = 0;

// 켜는 승인(Grant kind `automation.run`)을 그대로 넣는다.
export function insertRunGrant(
  db: DatabaseSync,
  declared: DeclaredAutomation,
  status: "active" | "revoked" = "active",
  app = APP,
): void {
  grantCounter += 1;
  const suffix = grantCounter.toString().padStart(2, "0");
  const scope = {
    kind: "automation.run",
    automation: declared.key,
    command: declared.command,
    input_hash: declared.input_hash,
    when: declared.when,
  };
  db.prepare(
    `INSERT INTO grants (id, app, kind, scope, approval, status, created_by,
       created_at, revoked_by, revoked_at)
     VALUES (?, ?, 'automation.run', ?, ?, ?, 'user', ?, ?, ?)`,
  ).run(
    `grt_01h455vb4pex5v6nkc6gd5fd${suffix}`,
    app,
    JSON.stringify(scope),
    `apr_01h455vb4pex5v6nkc6gd5fd${suffix}`,
    status,
    "2026-10-06T00:00:00.000Z",
    status === "revoked" ? "user" : null,
    status === "revoked" ? "2026-10-06T01:00:00.000Z" : null,
  );
}

let invocationCounter = 0;

// invocation 한 건. trigger가 automation key이면 그 automation의 실제 호출 관측이다.
export function insertInvocation(
  db: DatabaseSync,
  over: {
    trigger: Record<string, unknown>;
    status?: "succeeded" | "failed";
    app?: string;
    release?: string;
    mode?: "live" | "preview" | "test";
  },
): void {
  invocationCounter += 1;
  const suffix = invocationCounter.toString().padStart(2, "0");
  db.prepare(
    `INSERT INTO invocations (id, app, release, mode, actor, caller, operation,
       trigger, approval, input_hash, status, started_at, finished_at, summary,
       detail_hash)
     VALUES (?, ?, ?, ?, 'machine', ?, ?, ?, NULL, NULL, ?, ?, ?, '{}', NULL)`,
  ).run(
    `inv_01h455vb4pex5v6nkc6gd5fd${suffix}`,
    over.app ?? APP,
    over.release ?? RELEASE,
    over.mode ?? "live",
    JSON.stringify({ kind: "direct" }),
    JSON.stringify({ kind: "command", command: "lookup" }),
    JSON.stringify(over.trigger),
    over.status ?? "succeeded",
    "2026-10-06T00:00:00.000Z",
    "2026-10-06T00:00:01.000Z",
  );
}

const CTX = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1:user",
  scope: { operations: ["app.automations"], targets: {} },
  conditions: {},
} as unknown as RequestContext;

const EVERY_MINUTE = { kind: "interval", interval_ms: 60_000 } as const;

const lookup: DeclaredAutomation = {
  key: "lookup",
  command: "lookup",
  external: false,
  input_hash: HASH,
  when: EVERY_MINUTE,
};
const sync: DeclaredAutomation = {
  key: "sync",
  command: "sync",
  external: true,
  input_hash: HASH,
  when: { kind: "on_start" },
};

const read = createAutomationReads().automations;

function views(
  world: ReturnType<typeof createAutomationSnapshot>,
): Record<string, AutomationView> {
  const reply = read.handle(world.snapshot, CTX, { app: APP });
  assert(reply.ok, reply.ok ? "" : reply.error.message);
  assert(appAutomations.output.safeParse(reply.value).success);
  return Object.fromEntries(
    reply.value.automations.map((view) => [view.key, view]),
  );
}

Deno.test("apps/automations#R10: 선언만 있는 automation은 실행 가능 여부·관측과 다른 사실로 보인다", () => {
  const world = createAutomationSnapshot();
  try {
    seedApp(world.db);
    declareAutomations(world.db, [lookup]);
    const [only] = Object.values(views(world));
    // 선언은 있지만 지금 살아 있다는 관측이 없다. 실패한 호출이 아니고 호출 관측도 없다.
    assertEquals(only.declared, true);
    assertEquals(only.runnable, false);
    assertEquals(only.observed, false);
    assertEquals(only.release, RELEASE);
    assertEquals(only.reason?.code, AUTOMATION_REASONS.noObservation);
  } finally {
    world.close();
  }
});

Deno.test("apps/automations#R10: 앱 꺼짐·archive·준비 전·권한 없음은 서로 다른 이유이고 호출 관측이 아니다", () => {
  const cases: {
    over: Parameters<typeof seedApp>[1];
    external: boolean;
    code: string;
  }[] = [
    {
      over: { run_enabled: false },
      external: false,
      code: "execution_disabled",
    },
    {
      over: { status: "archived", run_enabled: false },
      external: false,
      code: "archived",
    },
    { over: { active_release: null }, external: false, code: "preparing" },
    {
      over: { active_release: "rel_01h455vb4pex5v6nkc6gd5fdw9" },
      external: false,
      code: "release_not_active",
    },
    // 앱은 열려 있으나 external 켜는 승인이 없다.
    { over: {}, external: true, code: "permission_required" },
  ];
  const codes: string[] = [];
  for (const item of cases) {
    const world = createAutomationSnapshot();
    try {
      seedApp(world.db, item.over);
      declareAutomations(world.db, [item.external ? sync : lookup]);
      const [view] = Object.values(views(world));
      assertEquals(view.reason?.code, item.code);
      assertEquals(view.runnable, false);
      assertEquals(view.observed, false);
      codes.push(view.reason!.code);
    } finally {
      world.close();
    }
  }
  assertEquals(new Set(codes).size, cases.length);
});

Deno.test("apps/automations#R13: external automation은 켜는 승인이 active인 동안만 승인 이유가 없고 끄면 다시 필요하다", () => {
  const world = createAutomationSnapshot();
  try {
    seedApp(world.db);
    declareAutomations(world.db, [sync]);
    assertEquals(
      views(world).sync.reason?.code,
      AUTOMATION_REASONS.permissionRequired,
    );
    insertRunGrant(world.db, sync);
    // 승인이 있으면 승인 이유는 사라지고 지금 관측만 남는다(관측은 메인 덮기가 채운다).
    assertEquals(
      views(world).sync.reason?.code,
      AUTOMATION_REASONS.noObservation,
    );
    world.db.exec(
      "UPDATE grants SET status = 'revoked', revoked_by = 'user', revoked_at = '2026-10-06T01:00:00.000Z'",
    );
    assertEquals(
      views(world).sync.reason?.code,
      AUTOMATION_REASONS.permissionRequired,
    );
  } finally {
    world.close();
  }
});

Deno.test("apps/automations#R10: 호출 관측은 그 release의 live automation invocation만 세고 직접 호출·다른 release는 세지 않는다", () => {
  const world = createAutomationSnapshot();
  try {
    seedApp(world.db);
    declareAutomations(world.db, [lookup, {
      ...lookup,
      key: "other",
      command: "lookup",
    }]);
    // 수동 확인은 직접 호출이라 주기 회차로 보이지 않는다(R12).
    insertInvocation(world.db, { trigger: { kind: "direct" } });
    // 다른 release·preview·다른 앱의 호출도 이 release의 관측이 아니다.
    insertInvocation(world.db, {
      trigger: { kind: "automation", key: "lookup" },
      release: "rel_01h455vb4pex5v6nkc6gd5fdw9",
    });
    insertInvocation(world.db, {
      trigger: { kind: "automation", key: "lookup" },
      mode: "preview",
    });
    seedApp(world.db, {}, OTHER_APP);
    insertInvocation(world.db, {
      trigger: { kind: "automation", key: "lookup" },
      app: OTHER_APP,
    });
    assertEquals(views(world).lookup.observed, false);
    // 읽기 command라도 automation 호출은 남아 있어 성공·실패 모두 관측이다.
    insertInvocation(world.db, {
      trigger: { kind: "automation", key: "lookup" },
      status: "succeeded",
    });
    assertEquals(views(world).lookup.observed, true);
    assertEquals(views(world).other.observed, false);
    insertInvocation(world.db, {
      trigger: { kind: "automation", key: "other" },
      status: "failed",
    });
    assertEquals(views(world).other.observed, true);
  } finally {
    world.close();
  }
});

Deno.test("apps/automations#R10: 선언을 모르거나 범위 밖 앱은 없는 앱과 같은 응답이다", () => {
  const world = createAutomationSnapshot();
  try {
    seedApp(world.db);
    // 현재 release 선언이 없으면 보일 automation이 없다.
    const none = read.handle(world.snapshot, CTX, { app: APP });
    assert(none.ok);
    assertEquals(none.value.automations, []);

    declareAutomations(world.db, [lookup]);
    const denying: ReadSnapshot = {
      ...world.snapshot,
      port: ((key: { name: string }) => {
        if (key.name === TargetAuthorization.name) {
          return () => ({
            ok: false as const,
            error: { code: "forbidden", message: "out of scope" },
          });
        }
        return world.snapshot.port(key as never);
      }) as ReadSnapshot["port"],
    };
    const outside = read.handle(denying, CTX, { app: APP });
    const absent = read.handle(world.snapshot, CTX, { app: OTHER_APP });
    assert(!outside.ok && !absent.ok);
    assertEquals(outside.error, absent.error);
    assertEquals(outside.error.code, "not_found");
  } finally {
    world.close();
  }
});

const live: RuntimeObservation = {
  app: APP,
  release: RELEASE,
  mode: "live",
  process_nonce: "nonce-1",
  endpoint: null,
  ready: true,
  accepting: true,
};

Deno.test("apps/automations#R10: 현재 관측이 열려 있으면 runnable이고 닫혀 있으면 그 이유가 승인 부족보다 먼저 보인다", async () => {
  const world = createAutomationSnapshot();
  try {
    seedApp(world.db);
    declareAutomations(world.db, [lookup, sync]);
    const pooled = (_ctx: RequestContext, input: unknown) =>
      Promise.resolve(read.handle(world.snapshot, CTX, input as never));
    const overlay = (
      observation: RuntimeObservation | null,
      app = {
        active_release: RELEASE,
        status: "active" as const,
        run_enabled: true,
      },
    ) =>
      withAutomationObservation(pooled, {
        observation: () => Promise.resolve(ok(observation)),
        app: () => Promise.resolve(ok(app)),
        now: () => "2026-10-06T02:00:00.000Z",
      });
    const call = async (
      observation: RuntimeObservation | null,
      app?: Parameters<typeof overlay>[1],
    ) => {
      const reply = await overlay(observation, app)(CTX, { app: APP });
      assert(reply.ok);
      const value = reply.value as {
        automations: AutomationView[];
        observed_at: string | null;
      };
      return {
        by: Object.fromEntries(value.automations.map((v) => [v.key, v])),
        observed_at: value.observed_at,
      };
    };

    const open = await call(live);
    // 열려 있고 승인이 필요 없는 automation은 실행 가능하다. external은 승인이 없으니 아니다.
    assertEquals(open.by.lookup.runnable, true);
    assertEquals(open.by.lookup.reason, undefined);
    assertEquals(open.by.sync.runnable, false);
    assertEquals(open.by.sync.reason?.code, "permission_required");
    assertEquals(open.observed_at, "2026-10-06T02:00:00.000Z");

    insertRunGrant(world.db, sync);
    const approved = await call(live);
    assertEquals(approved.by.sync.runnable, true);

    // 앱이 열려 있지 않으면 그 이유가 보인다(승인이 없는 automation도 앱 쪽 이유가 먼저다).
    const none = await call(null);
    assertEquals(none.by.lookup.reason?.code, "no_observation");
    assertEquals(none.observed_at, null);
    const closed = await call({
      ...live,
      accepting: false,
      ready: false,
      reason: { code: "terminating", summary: "stop requested" },
    });
    assertEquals(closed.by.lookup.reason?.code, "terminating");
    assertEquals(closed.by.lookup.runnable, false);
    const preview = await call({ ...live, mode: "preview", release: null });
    assertEquals(preview.by.lookup.reason?.code, "no_observation");
    // reader 뒤에 앱이 멈췄으면 지금 값으로 다시 본다.
    const stopped = await call(live, {
      active_release: RELEASE,
      status: "active",
      run_enabled: false,
    });
    assertEquals(stopped.by.lookup.reason?.code, "execution_disabled");
    assertEquals(stopped.by.lookup.runnable, false);
  } finally {
    world.close();
  }
});

Deno.test("apps/automations#R10: 관측 질의가 실패하면 reader 값을 그대로 두고 과거 event로 실행 중이라고 하지 않는다", async () => {
  const world = createAutomationSnapshot();
  try {
    seedApp(world.db);
    declareAutomations(world.db, [lookup]);
    const overlay = withAutomationObservation(
      (_ctx: RequestContext, input: unknown) =>
        Promise.resolve(read.handle(world.snapshot, CTX, input as never)),
      {
        observation: () =>
          Promise.resolve(
            err({ code: "unavailable", message: "supervisor is away" }),
          ),
        app: () =>
          Promise.resolve(
            ok({
              active_release: RELEASE,
              status: "active" as const,
              run_enabled: true,
            }),
          ),
        now: () => "2026-10-06T02:00:00.000Z",
      },
    );
    const reply = await overlay(CTX, { app: APP });
    assert(reply.ok);
    const value = reply.value as { automations: AutomationView[] };
    assertEquals(value.automations[0].runnable, false);
    assertEquals(value.automations[0].reason?.code, "no_observation");
  } finally {
    world.close();
  }
});
