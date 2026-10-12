import { assert, assertEquals } from "@std/assert";
import { suggestAppName } from "./model.ts";
import type { Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../../protocol/platform/mod.ts";
import {
  answerFree,
  APP_CREATED,
  applyRegister,
  askRegister,
  chooseOption,
  count,
  EVIDENCE,
  inspect,
  openAppOptionWorld,
  type Registration,
} from "../../../../apps/core/testing/app-option.ts";
import { id } from "../../../../apps/core/testing/tool-judgment-world.ts";

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
  revokeCredential(credentialRef: string): Promise<Result<void>>;
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

const CAC = "cac_01arz3ndektsv4rrffq69g5fav";

const operations = [
  "app.create",
  "app.connect_source",
  "app.archive",
  "app.unarchive",
  "app.rename",
  "app.list",
  "app.get",
  // place_names 이름 공간을 나누는(R6) project command다.
  "project.create",
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
const coding = credential(`coding_agent:${CAC}`);

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function commandResult(result: Result<CommandSuccess>): CommandSuccess {
  return value(result);
}

function rows(result: Result<SqlRow[]>): SqlRow[] {
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
  return {
    command,
    input,
    compare,
    idempotency_key: key,
    prepared: [],
  };
}

async function harness(
  credentials: readonly AuthenticatedContext[] = [user],
): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      // place_names 표와 project command는 documents 등록의 몫이다(R6).
      registrationModules: [documents, registration],
      credentials,
    }),
  );
}

function createInput(slug: string, name: string, planning_version?: string) {
  return planning_version === undefined
    ? { slug, name, description: "collect usage" }
    : { slug, name, description: "collect usage", planning_version };
}

async function create(
  opened: LedgerHarness,
  slug = "usage",
  idempotency = "create-usage",
  planning_version?: string,
) {
  return await opened.command(
    user,
    envelope(
      "app.create",
      idempotency,
      createInput(slug, "Usage", planning_version),
    ),
  );
}

Deno.test("apps/registration#R1: screenless and screen apps register apart from documents", async () => {
  const opened = await harness();
  try {
    commandResult(await create(opened, "collector"));
    commandResult(
      await opened.command(
        user,
        envelope(
          "app.create",
          "create-screen",
          createInput("viewer", "Viewer"),
        ),
      ),
    );
    const stored = rows(
      await opened.inspect("select id, slug, status from apps order by id", []),
    );
    assertEquals(stored.length, 2);
    assertEquals(stored.every((row) => row.status === "active"), true);
    // 문서 등록과 별개 표다.
    const places = rows(
      await opened.inspect(
        "select kind, target from place_names order by kind",
        [],
      ),
    );
    assertEquals(places.every((row) => row.kind === "app"), true);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R2: register without source, release or planning version, look back both ways", async () => {
  const opened = await harness();
  try {
    const bare = commandResult(await create(opened, "bare"));
    const bareId = (bare.result as { id: string }).id;
    const version = "ver_01arz3ndektsv4rrffq69g5fav";
    const planned = commandResult(
      await create(opened, "planned", "create-planned", version),
    );
    const plannedId = (planned.result as { id: string }).id;
    const got = value(
      await opened.read({ resource: "apps", method: "get" }, user, {
        app: plannedId,
      }),
    ) as {
      app: {
        planning_version: string | null;
        source_path: string | null;
        active_release: string | null;
      };
    };
    assertEquals(got.app.planning_version, version);
    assertEquals(got.app.source_path, null);
    assertEquals(got.app.active_release, null);
    const bareGot = value(
      await opened.read({ resource: "apps", method: "get" }, user, {
        app: bareId,
      }),
    ) as { app: { planning_version: string | null } };
    assertEquals(bareGot.app.planning_version, null);
    const listed = value(
      await opened.read({ resource: "apps", method: "list" }, user, {}),
    ) as {
      apps: { slug: string; source_path: string | null }[];
    };
    assertEquals(listed.apps.map((app) => app.slug).sort(), [
      "bare",
      "planned",
    ]);
    assertEquals(listed.apps.every((app) => app.source_path === null), true);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R3: wide-scope connection registers, app-scope connection and agent request are denied", async () => {
  const opened = await harness([user, coding]);
  try {
    // 전체 범위 coding connection의 등록은 user 등록과 같다.
    const registered = commandResult(
      await opened.command(
        coding,
        envelope("app.create", "create-coded", createInput("coded", "Coded")),
      ),
    );
    const stored = rows(await opened.inspect("select slug from apps", []));
    assertEquals(stored.map((row) => row.slug), ["coded"]);
    // 앱 하나 scope connection의 conditions.app은 새 앱 id와 같을 수 없다.
    const appId = (registered.result as { id: string }).id;
    const appScoped = credential(`coding_agent:${CAC}`, {
      credential_ref: `test:test-user:app-scoped`,
      conditions: { app: appId },
    });
    await opened.setCredential(appScoped);
    code(
      await opened.command(
        appScoped,
        envelope(
          "app.create",
          "create-scoped",
          createInput("scoped", "Scoped"),
        ),
      ),
      "forbidden",
    );
    // lophn agent의 직접 요청은 route actors에서 거른다.
    const agent = credential("agent:asg_01arz3ndektsv4rrffq69g5fav");
    await opened.setCredential(agent);
    code(
      await opened.command(
        agent,
        envelope("app.create", "create-agent", createInput("agent", "Agent")),
      ),
      "forbidden",
    );
    const after = rows(await opened.inspect("select slug from apps", []));
    assertEquals(after.map((row) => row.slug), ["coded"]);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R4: connect a git folder outside the managed store and read the real path back", async () => {
  const opened = await harness();
  try {
    const folder = await Deno.makeTempDir({ prefix: "apps-registration-src-" });
    try {
      await Deno.mkdir(`${folder}/.git`);
      const created = commandResult(await create(opened));
      const id = (created.result as { id: string }).id;
      const base = value(
        await opened.read(
          { resource: "apps", method: "get" },
          user,
          { app: id },
        ),
      ) as { app: { revision: string } };
      const connected = commandResult(
        await opened.command(
          user,
          envelope(
            "app.connect_source",
            "connect-usage",
            { app: id, source_path: folder },
            { base_revision: base.app.revision },
          ),
        ),
      );
      const result = connected.result as { source_path: string | null };
      assertEquals(result.source_path, folder);
      const got = value(
        await opened.read(
          { resource: "apps", method: "get" },
          user,
          { app: id },
        ),
      ) as { app: { source_path: string | null } };
      assertEquals(got.app.source_path, folder);
    } finally {
      await Deno.remove(folder, { recursive: true });
    }
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R5: reconnecting source keeps active_release and app data", async () => {
  const opened = await harness();
  try {
    const folder = await Deno.makeTempDir({ prefix: "apps-registration-src-" });
    const moved = await Deno.makeTempDir({ prefix: "apps-registration-src-" });
    try {
      await Deno.mkdir(`${folder}/.git`);
      await Deno.mkdir(`${moved}/.git`);
      const created = commandResult(await create(opened));
      const id = (created.result as { id: string }).id;
      const before = value(
        await opened.read(
          { resource: "apps", method: "get" },
          user,
          { app: id },
        ),
      ) as { app: { revision: string } };
      commandResult(
        await opened.command(
          user,
          envelope(
            "app.connect_source",
            "connect-first",
            { app: id, source_path: folder },
            { base_revision: before.app.revision },
          ),
        ),
      );
      const first = value(
        await opened.read(
          { resource: "apps", method: "get" },
          user,
          { app: id },
        ),
      ) as { app: { revision: string; active_release: string | null } };
      commandResult(
        await opened.command(
          user,
          envelope(
            "app.connect_source",
            "connect-second",
            { app: id, source_path: moved },
            { base_revision: first.app.revision },
          ),
        ),
      );
      const second = value(
        await opened.read(
          { resource: "apps", method: "get" },
          user,
          { app: id },
        ),
      ) as {
        app: {
          source_path: string | null;
          active_release: string | null;
          revision: string;
        };
      };
      assertEquals(second.app.source_path, moved);
      assertEquals(second.app.active_release, null);
      // active_release는 source 재연결 전후 같다.
      assertEquals(second.app.active_release, first.app.active_release);
      // 상태와 run 허용도 건드리지 않는다.
      const stored = rows(
        await opened.inspect(
          "select status, run_enabled from apps where id = ?",
          [id],
        ),
      );
      assertEquals(stored[0]?.status, "active");
      assertEquals(Number(stored[0]?.run_enabled), 0);
    } finally {
      await Deno.remove(folder, { recursive: true });
      await Deno.remove(moved, { recursive: true });
    }
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R6: a slug owned by an existing folder conflicts and the folder stays", async () => {
  const opened = await harness();
  try {
    // documents의 project가 같은 이름 공간을 쓴다. 비소유 project 폴더가 먼저 있다.
    const projectId = "prj_01arz3ndektsv4rrffq69g5fav";
    commandResult(
      await opened.command(
        user,
        envelope("project.create", "create-project", {
          id: projectId,
          name: "shared",
          title: "Shared",
          purpose: "keep notes",
          folders: [],
          tracking: { enabled: false, patterns: [], use_gitignore: false },
        }),
      ),
    );
    const folderBefore = rows(
      await opened.inspect(
        "select kind, target, reserved_seq from place_names where slug = ?",
        ["shared"],
      ),
    );
    assertEquals(folderBefore.length, 1);
    assertEquals(folderBefore[0]?.kind, "project");
    assertEquals(folderBefore[0]?.target, projectId);
    code(await create(opened, "shared", "create-app-shared"), "conflict");
    // 비소유 폴더의 내용과 주인이 바뀌지 않는다.
    const folderAfter = rows(
      await opened.inspect(
        "select kind, target, reserved_seq from place_names where slug = ?",
        ["shared"],
      ),
    );
    assertEquals(folderAfter, folderBefore);
    const apps = rows(await opened.inspect("select id from apps", []));
    assertEquals(apps, []);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R7: suggested name from the slug and the entered name wins", async () => {
  assertEquals(suggestAppName("usage-report"), "Usage Report");
  assertEquals(suggestAppName("usage_report"), "Usage Report");
  assertEquals(suggestAppName("mahas"), "Mahas");
  assertEquals(suggestAppName("MAHAS"), "MAHAS");
  assertEquals(suggestAppName("-leading--trailing_"), "Leading Trailing");
  // 사람이 입력한 이름은 그대로 쓴다.
  const opened = await harness();
  try {
    commandResult(
      await opened.command(
        user,
        envelope("app.create", "create-mahas", {
          slug: "mahas",
          name: "MAHAS",
          description: "keep mahas",
        }),
      ),
    );
    const got = value(
      await opened.read(
        { resource: "apps", method: "get" },
        user,
        {
          app: rows(await opened.inspect("select id from apps", []))[0]
            ?.id as string,
        },
      ),
    ) as { app: { name: string } };
    assertEquals(got.app.name, "MAHAS");
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R8: archive stores run_enabled=false and unarchive keeps it", async () => {
  const opened = await harness([user, coding]);
  try {
    const created = commandResult(await create(opened));
    const id = (created.result as { id: string }).id;
    const active = value(
      await opened.read(
        { resource: "apps", method: "get" },
        user,
        { app: id },
      ),
    ) as { app: { revision: string } };
    commandResult(
      await opened.command(
        user,
        envelope("app.archive", "archive-usage", { app: id }, {
          base_revision: active.app.revision,
        }),
      ),
    );
    const archived = value(
      await opened.read(
        { resource: "apps", method: "get" },
        user,
        { app: id },
      ),
    ) as { app: { status: string; run_enabled: boolean; revision: string } };
    assertEquals(archived.app.status, "archived");
    assertEquals(archived.app.run_enabled, false);
    // coding agent의 보관 해제는 route actors에서 거른다.
    code(
      await opened.command(
        coding,
        envelope("app.unarchive", "unarchive-coded", { app: id }, {
          base_revision: archived.app.revision,
        }),
      ),
      "forbidden",
    );
    commandResult(
      await opened.command(
        user,
        envelope("app.unarchive", "unarchive-usage", { app: id }, {
          base_revision: archived.app.revision,
        }),
      ),
    );
    const unarchived = value(
      await opened.read(
        { resource: "apps", method: "get" },
        user,
        { app: id },
      ),
    ) as { app: { status: string; run_enabled: boolean } };
    assertEquals(unarchived.app.status, "active");
    assertEquals(unarchived.app.run_enabled, false);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R9: archive keeps the place and the history", async () => {
  const opened = await harness();
  try {
    const created = commandResult(await create(opened));
    const id = (created.result as { id: string }).id;
    const active = value(
      await opened.read(
        { resource: "apps", method: "get" },
        user,
        { app: id },
      ),
    ) as { app: { revision: string } };
    commandResult(
      await opened.command(
        user,
        envelope("app.archive", "archive-usage", { app: id }, {
          base_revision: active.app.revision,
        }),
      ),
    );
    // place와 event 이력은 archive 뒤에도 찾는다.
    const places = rows(
      await opened.inspect(
        "select kind, target from place_names where slug = ?",
        ["usage"],
      ),
    );
    assertEquals(places, [{ kind: "app", target: id }]);
    const events = rows(
      await opened.inspect(
        "select type from events where subject = ? order by seq",
        [id],
      ),
    );
    assertEquals(events.map((row) => row.type), ["AppCreated", "AppArchived"]);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R10: register without a project and read the independent place", async () => {
  const opened = await harness();
  try {
    commandResult(await create(opened, "standalone", "create-standalone"));
    const created = commandResult(
      await create(opened, "lonely", "create-lonely"),
    );
    const id = (created.result as { id: string }).id;
    // project 선택 없이 등록됐다.
    const places = rows(
      await opened.inspect(
        "select kind, target from place_names where slug = ?",
        ["standalone"],
      ),
    );
    assertEquals(places.length, 1);
    assertEquals(places[0]?.kind, "app");
    const got = value(
      await opened.read(
        { resource: "apps", method: "get" },
        user,
        { app: id },
      ),
    ) as { app: { slug: string } };
    assertEquals(got.app.slug, "lonely");
    const listed = value(
      await opened.read(
        { resource: "apps", method: "list" },
        user,
        { status: "active" },
      ),
    ) as { apps: { slug: string }[] };
    assertEquals(listed.apps.map((app) => app.slug).sort(), [
      "lonely",
      "standalone",
    ]);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R3: the same key replays and a different payload conflicts", async () => {
  const opened = await harness();
  try {
    const first = commandResult(await create(opened, "same", "create-same"));
    assertEquals(first.replayed, false);
    const replayed = commandResult(await create(opened, "same", "create-same"));
    assertEquals(replayed.replayed, true);
    assertEquals(replayed.result, first.result);
    const stored = code(
      await create(opened, "other", "create-same"),
      "conflict",
    );
    void stored;
    const appCount = rows(await opened.inspect("select id from apps", []));
    assertEquals(appCount.length, 1);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R5: a stale base_revision conflicts", async () => {
  const opened = await harness();
  try {
    const folder = await Deno.makeTempDir({ prefix: "apps-registration-src-" });
    try {
      await Deno.mkdir(`${folder}/.git`);
      const created = commandResult(await create(opened));
      const id = (created.result as { id: string }).id;
      const current = value(
        await opened.read(
          { resource: "apps", method: "get" },
          user,
          { app: id },
        ),
      ) as { app: { revision: string } };
      commandResult(
        await opened.command(
          user,
          envelope(
            "app.connect_source",
            "connect-first",
            { app: id, source_path: folder },
            { base_revision: current.app.revision },
          ),
        ),
      );
      // 낡은 base_revision은 conflict다.
      code(
        await opened.command(
          user,
          envelope(
            "app.connect_source",
            "connect-stale",
            { app: id, source_path: folder },
            { base_revision: "1" },
          ),
        ),
        "conflict",
      );
    } finally {
      await Deno.remove(folder, { recursive: true });
    }
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R2: rename works and moves the revision", async () => {
  const opened = await harness();
  try {
    const created = commandResult(await create(opened));
    const id = (created.result as { id: string }).id;
    const active = value(
      await opened.read(
        { resource: "apps", method: "get" },
        user,
        { app: id },
      ),
    ) as { app: { name: string; revision: string } };
    assertEquals(active.app.name, "Usage");
    commandResult(
      await opened.command(
        user,
        envelope("app.rename", "rename-usage", {
          app: id,
          name: "Usage Analytics",
        }, {
          base_revision: active.app.revision,
        }),
      ),
    );
    const renamed = value(
      await opened.read(
        { resource: "apps", method: "get" },
        user,
        { app: id },
      ),
    ) as { app: { name: string; revision: string } };
    assertEquals(renamed.app.name, "Usage Analytics");
    assertEquals(renamed.app.revision !== active.app.revision, true);
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R2: a stale revision conflicts on rename", async () => {
  const opened = await harness();
  try {
    const created = commandResult(await create(opened));
    const id = (created.result as { id: string }).id;
    const active = value(
      await opened.read(
        { resource: "apps", method: "get" },
        user,
        { app: id },
      ),
    ) as { app: { revision: string } };
    commandResult(
      await opened.command(
        user,
        envelope(
          "app.rename",
          "rename-first",
          { app: id, name: "First Name" },
          {
            base_revision: active.app.revision,
          },
        ),
      ),
    );
    // 낡은 base_revision은 conflict다.
    code(
      await opened.command(
        user,
        envelope(
          "app.rename",
          "rename-stale",
          { app: id, name: "Second Name" },
          {
            base_revision: active.app.revision,
          },
        ),
      ),
      "conflict",
    );
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R2: a non-user actor is refused on rename", async () => {
  const opened = await harness([user, coding]);
  try {
    const created = commandResult(await create(opened));
    const id = (created.result as { id: string }).id;
    const active = value(
      await opened.read(
        { resource: "apps", method: "get" },
        user,
        { app: id },
      ),
    ) as { app: { revision: string } };
    // coding agent의 rename은 거절된다.
    code(
      await opened.command(
        coding,
        envelope("app.rename", "rename-coded", { app: id, name: "New Name" }, {
          base_revision: active.app.revision,
        }),
      ),
      "forbidden",
    );
  } finally {
    await opened.close();
  }
});

Deno.test("apps/registration#R2: absent app is not found on rename", async () => {
  const opened = await harness();
  try {
    // non-existent app
    const nonExistentId = "app_00000000000000000000000000";
    code(
      await opened.command(
        user,
        envelope("app.rename", "rename-absent", {
          app: nonExistentId,
          name: "New Name",
        }, {
          base_revision: "1",
        }),
      ),
      "not_found",
    );
  } finally {
    await opened.close();
  }
});

const APP_ONE = id("app", 1);
const APP_TWO = id("app", 2);

function appToRegister(app: string, slug = "usage"): Registration {
  return {
    id: app,
    slug,
    name: "Usage",
    description: "collect usage",
  };
}

function appRows(world: Parameters<typeof inspect>[0]) {
  return inspect(world, "select id, slug, status, run_enabled from apps");
}

Deno.test("apps/registration#R3: a chosen question option registers the preassigned app once and the second apply conflicts", async () => {
  const world = await openAppOptionWorld();
  try {
    const asked = await askRegister(world, appToRegister(APP_ONE));
    // 질문과 답만으로는 등록하지 않는다.
    assertEquals(appRows(world.server), []);
    await chooseOption(world, asked);
    assertEquals(appRows(world.server), []);
    const applied = await applyRegister(world, asked.question, asked.action);
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    // 미리 배정한 ID로 등록되고 실행은 꺼진 채다. 적용은 사람 결정이라 actor=user, run=null이다.
    assertEquals(appRows(world.server), [
      { id: APP_ONE, slug: "usage", status: "active", run_enabled: 0 },
    ]);
    const created = inspect(
      world.server,
      "select subject, actor, run from events where type = 'AppCreated'",
    );
    assertEquals(created, [{ subject: APP_ONE, actor: "user", run: null }]);
    assertEquals(count(world.server, EVIDENCE), 1);
    // 같은 선택지의 두 번째 적용은 conflict이고 앱도 일회 기록도 더하지 않는다.
    const again = await applyRegister(world, asked.question, asked.action);
    assertEquals(again.status, 409, JSON.stringify(again.body));
    assertEquals(count(world.server, APP_CREATED), 1);
    assertEquals(count(world.server, EVIDENCE), 1);
  } finally {
    await world.dispose();
  }
});

Deno.test("apps/registration#R3: a free answer, another option or a changed action registers nothing", async () => {
  const world = await openAppOptionWorld();
  try {
    // 자유 답은 사람이 고른 선택지가 아니다.
    const free = await askRegister(world, appToRegister(APP_ONE));
    await answerFree(world, free, "yes, register it");
    const freeApply = await applyRegister(world, free.question, free.action);
    assertEquals(freeApply.status, 403, JSON.stringify(freeApply.body));
    // 고정 action과 다른 앱(이름)을 같은 질문의 근거로 내밀 수 없다.
    const other = await askRegister(
      world,
      appToRegister(APP_TWO, "other"),
      "editor",
    );
    await chooseOption(world, other);
    const changed = {
      ...other.action,
      input: {
        kind: "inline",
        value: { ...appToRegister(APP_TWO, "other"), name: "Other Name" },
      },
    };
    const changedApply = await applyRegister(world, other.question, changed);
    assertEquals(changedApply.status, 403, JSON.stringify(changedApply.body));
    assertEquals(appRows(world.server), []);
    assertEquals(count(world.server, APP_CREATED), 0);
    assertEquals(count(world.server, EVIDENCE), 0);
  } finally {
    await world.dispose();
  }
});

Deno.test("apps/registration#R3: a stale basis conflicts, keeps the answer and leaves the option appliable", async () => {
  const world = await openAppOptionWorld();
  try {
    const first = await askRegister(world, appToRegister(APP_ONE));
    const second = await askRegister(world, appToRegister(APP_TWO), "editor");
    await chooseOption(world, first);
    await chooseOption(world, second);
    const done = await applyRegister(world, first.question, first.action);
    assertEquals(done.status, 200, JSON.stringify(done.body));
    // 두 번째 선택지의 slug는 그 사이 등록되었다. 달라진 대상과 이유를 알리고 등록하지 않는다.
    const stale = await applyRegister(world, second.question, second.action);
    assertEquals(stale.status, 409, JSON.stringify(stale.body));
    const details = (stale.body["error"] as {
      details?: { targets: string[]; reason: string };
    }).details;
    assertEquals(details?.targets, [APP_TWO]);
    assert((details?.reason ?? "").length > 0);
    assertEquals(appRows(world.server).map((row) => row["id"]), [APP_ONE]);
    // 실패한 적용은 일회 기록을 남기지 않아 다시 적용을 시도할 수 있다.
    assertEquals(count(world.server, EVIDENCE), 1);
    assertEquals(count(world.server, APP_CREATED), 1);
  } finally {
    await world.dispose();
  }
});

Deno.test("apps/registration#R3: a coding connection cannot choose the app id", async () => {
  const opened = await harness([user, coding]);
  try {
    code(
      await opened.command(
        coding,
        envelope("app.create", "create-id", {
          ...createInput("coded", "Coded"),
          id: APP_ONE,
        }),
      ),
      "forbidden",
    );
    assertEquals(rows(await opened.inspect("select id from apps", [])), []);
  } finally {
    await opened.close();
  }
});
