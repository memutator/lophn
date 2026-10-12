// grants.list의 read handler를 실제 grants·apps 표(실제 schema)의 SQLite snapshot에서 부른다.
// reader Worker의 port는 고정 값이라 선언 port를 snapshot에 주입한 것과 등록하지 않은 것을 나눠 본다.
import { assert, assertEquals } from "@std/assert";
import {
  type Grant,
  grantsList,
  grantsListOutputSchema,
} from "../../protocol/apps/mod.ts";
import type { RequestContext } from "../../protocol/platform/mod.ts";
import type { AppDeclarations } from "./declarations.ts";
import { createGrantsReads } from "./reads.ts";
import { insertGrant } from "./store.ts";
import { createGrantSnapshot, seedDeclarations } from "./testing/mod.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER = "app_01h455vb4pex5v6nkc6gd5fdw2";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const CTX = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1:user",
  scope: { operations: ["grants.list"], targets: {} },
  conditions: {},
} as unknown as RequestContext;

const declarations: AppDeclarations = {
  release: REL,
  permissions: [
    {
      kind: "fs.read",
      scope: { path: "/srv/reports", recursive: true },
      reason: "read reports",
    },
    {
      kind: "net.fetch",
      scope: { host: "api.example.com", port: 443 },
      reason: "upload",
    },
    { kind: "secret.use", scope: { name: "api-key" }, reason: "auth" },
  ],
  app_connections: [],
  commands: [],
  automations: [],
};

function world(options: { withDeclarations: boolean; declared?: boolean }) {
  const opened = createGrantSnapshot({
    withDeclarations: options.withDeclarations,
  });
  for (const [index, id] of [APP, OTHER].entries()) {
    opened.db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version,
         source_path, active_release, run_enabled, revision, status)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, 0, '1', 'active')`,
    ).run(id, `app-${index}`, `App ${index}`, "an app");
  }
  if (options.declared !== false) {
    seedDeclarations(opened.db, APP, declarations);
  }
  return opened;
}

function netGrant(
  suffix: string,
  app: string,
  host: string,
  status: Grant["status"] = "active",
): Grant {
  return {
    id: `grt_01h455vb4pex5v6nkc6gd5fd${suffix}`,
    app,
    kind: "net.fetch",
    scope: { kind: "net.fetch", host, port: 443 },
    approval: `apr_01h455vb4pex5v6nkc6gd5fd${suffix}`,
    status,
    created_by: "user",
    created_at: "2026-10-06T00:00:00.000Z",
    revoked_by: status === "revoked" ? "user" : null,
    revoked_at: status === "revoked" ? "2026-10-06T01:00:00.000Z" : null,
  };
}

function put(opened: ReturnType<typeof world>, grant: Grant): void {
  insertGrant({
    sql: {
      run: (sql, params) =>
        opened.db.prepare(sql).run(...(params as never[])) as never,
      get: () => undefined,
      all: () => [],
    },
  }, grant);
}

function list(
  opened: ReturnType<typeof world>,
  input: Record<string, unknown>,
) {
  const result = createGrantsReads().list.handle(
    opened.snapshot,
    CTX,
    grantsList.input.parse(input),
  );
  assert(result.ok, result.ok ? "" : JSON.stringify(result.error));
  // 출력은 contract schema를 그대로 지난다.
  return grantsListOutputSchema.parse(result.value);
}

Deno.test("apps/permissions#R24 apps/permissions#R25: 앱을 지정하면 현재 선언의 요구·조합 경고·한계 key가 표시 자료로 붙는다", () => {
  const opened = world({ withDeclarations: true });
  try {
    put(opened, netGrant("01", APP, "api.example.com"));
    const page = list(opened, { app: APP });
    assertEquals(page.grants.length, 1);
    const display = page.display;
    assert(display);
    assertEquals(display.app, APP);
    assertEquals(display.release, REL);
    assertEquals(
      display.requirements.map((r) => [r.kind, r.reason, r.granted]),
      [
        ["fs.read", "read reports", false],
        ["net.fetch", "upload", true],
        ["secret.use", "auth", false],
      ],
    );
    assertEquals(display.requirements[0].scope, {
      path: "/srv/reports",
      recursive: true,
    });
    assertEquals(display.combination_warnings, [{
      key: "permissions.warning.file-read-and-network",
      kinds: ["fs.read", "net.fetch"],
    }]);
    assert(display.limit_keys.includes("permissions.limit.not-isolated"));
    assert(display.limit_keys.includes("permissions.limit.cpu"));
    // 표시 자료를 만든다고 grant가 생기지 않는다.
    assertEquals(
      opened.snapshot.sql.all("SELECT id FROM grants", []).length,
      1,
    );
  } finally {
    opened.close();
  }
});

Deno.test("apps/permissions#R1: 회수한 grant는 표시 자료의 granted가 아니다", () => {
  const opened = world({ withDeclarations: true });
  try {
    put(opened, netGrant("01", APP, "api.example.com", "revoked"));
    const page = list(opened, { app: APP, status: "revoked" });
    assertEquals(page.grants.length, 1);
    assertEquals(
      page.display?.requirements.find((r) => r.kind === "net.fetch")?.granted,
      false,
    );
  } finally {
    opened.close();
  }
});

Deno.test("apps/permissions#R24: 앱을 지정하지 않았거나 현재 선언을 모르면 표시 자료는 null이다", () => {
  const opened = world({ withDeclarations: true });
  const unknown = world({ withDeclarations: false });
  const noRelease = world({ withDeclarations: true, declared: false });
  try {
    put(opened, netGrant("01", APP, "api.example.com"));
    assertEquals(list(opened, {}).display, null);
    // 다른 앱은 현재 release 선언이 없다.
    assertEquals(list(opened, { app: OTHER }).display, null);
    // 선언을 내는 주체가 등록되지 않은 core(port 없음)는 선언을 모르는 것이다.
    assertEquals(list(unknown, { app: APP }).display, null);
    assertEquals(list(noRelease, { app: APP }).display, null);
  } finally {
    opened.close();
    unknown.close();
    noRelease.close();
  }
});
