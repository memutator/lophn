import { assert, assertEquals } from "@std/assert";
import type { Grant, GrantPermissionScope } from "../../contracts/apps/mod.ts";
import type { AppDeclarations } from "./declarations.ts";
import { buildGrantDisplay } from "./display.ts";
import { effectiveScope } from "./effective.ts";
import { LIMIT_KEYS } from "./flags.ts";
import type { ResolvedRequirement } from "./model.ts";

const A = "app_01h455vb4pex5v6nkc6gd5fdw1";
const B = "app_01h455vb4pex5v6nkc6gd5fdw2";
const C = "app_01h455vb4pex5v6nkc6gd5fdw3";
const HASH = "ab".repeat(32);

let counter = 0;
function grant(
  app: string,
  scope: GrantPermissionScope,
  status: "active" | "revoked" = "active",
): Grant {
  counter += 1;
  const suffix = counter.toString().padStart(2, "0");
  return {
    id: `grt_01h455vb4pex5v6nkc6gd5fd${suffix}`,
    app,
    kind: scope.kind,
    scope,
    approval: `apr_01h455vb4pex5v6nkc6gd5fd${suffix}`,
    status,
    created_by: "user",
    created_at: "2026-10-06T00:00:00.000Z",
    revoked_by: status === "revoked" ? "user" : null,
    revoked_at: status === "revoked" ? "2026-10-06T01:00:00.000Z" : null,
  };
}

function declarations(
  patch: Partial<AppDeclarations> = {},
): AppDeclarations {
  return {
    release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
    permissions: [],
    app_connections: [],
    commands: [],
    automations: [],
    ...patch,
  };
}

const NET = { host: "api.example.com", port: 443 };

function effective(
  app: string,
  declared: AppDeclarations | null,
  grants: Grant[],
  targets: Record<string, string[]> = {},
) {
  return effectiveScope({
    app,
    declarations: declared,
    grants,
    targetCommands: (target) => targets[target],
  });
}

Deno.test("apps/permissions#R1: 선언만 있는 접근은 실행 범위가 0이고 같은 범위 grant가 생기면 그 범위만 생긴다", () => {
  const declared = declarations({
    permissions: [
      { kind: "net.fetch", scope: NET, reason: "usage api" },
      { kind: "secret.use", scope: { name: "api-key" }, reason: "auth" },
    ],
  });
  assertEquals(effective(A, declared, []).access, []);
  const granted = effective(A, declared, [
    grant(A, { kind: "net.fetch", ...NET }),
  ]);
  assertEquals(granted.access, [{ kind: "net.fetch", scope: NET }]);
});

Deno.test("apps/permissions#R2: 선언하지 않은 옛 grant와 grant 밖 선언은 모두 실행 범위에서 빠진다", () => {
  const oldGrant = grant(A, {
    kind: "net.fetch",
    host: "old.example.com",
    port: 443,
  });
  const current = grant(A, { kind: "net.fetch", ...NET });
  const declared = declarations({
    permissions: [
      { kind: "net.fetch", scope: NET, reason: "usage api" },
      { kind: "document.save", scope: { key: "report" }, reason: "save" },
    ],
  });
  const scope = effective(A, declared, [oldGrant, current]);
  // 옛 grant(old.example.com)는 남았지만 쓸 수 없고, 선언만 한 document.save도 없다.
  assertEquals(scope.access, [{ kind: "net.fetch", scope: NET }]);
  // release가 없으면 grant가 있어도 실행 범위는 0이다.
  assertEquals(effective(A, null, [current]).access, []);
  // 회수한 grant와 다른 앱의 grant는 쓰지 않는다.
  assertEquals(
    effective(A, declared, [
      grant(A, { kind: "net.fetch", ...NET }, "revoked"),
      grant(B, { kind: "net.fetch", ...NET }),
    ]).access,
    [],
  );
});

Deno.test("apps/permissions#R3: 같은 host·port의 후속 release는 grant를 쓰고 새 host·port는 포함하지 않는다", () => {
  const existing = grant(A, { kind: "net.fetch", ...NET });
  const next = declarations({
    permissions: [
      { kind: "net.fetch", scope: NET, reason: "same as before" },
      {
        kind: "net.fetch",
        scope: { host: "api.example.com", port: 8443 },
        reason: "new port",
      },
      {
        kind: "net.fetch",
        scope: { host: "other.example.com", port: 443 },
        reason: "new host",
      },
    ],
  });
  assertEquals(effective(A, next, [existing]).access, [
    { kind: "net.fetch", scope: NET },
  ]);
});

Deno.test("apps/permissions#R5 apps/permissions#R2: fs.write grant는 fs.read 요구를 허락하지 않는다", () => {
  const scope = { path: "/data/reports", recursive: true };
  const declared = declarations({
    permissions: [{ kind: "fs.read", scope, reason: "read reports" }],
  });
  assertEquals(
    effective(A, declared, [grant(A, { kind: "fs.write", ...scope })]).access,
    [],
  );
});

Deno.test("apps/permissions#R26: app.call grant는 (caller, target, commands) 방향이고 새 command·B→A·A→C는 포함하지 않는다", () => {
  const callerDeclared = declarations({
    app_connections: [
      { app: B, commands: ["report.read", "report.list", "report.export"] },
    ],
  });
  const grants = [
    grant(A, {
      kind: "app.call",
      app: B,
      commands: ["report.list", "report.read"],
    }),
  ];
  const targets = { [B]: ["report.read", "report.list", "report.export"] };
  assertEquals(effective(A, callerDeclared, grants, targets).app_calls, [
    { app: B, commands: ["report.list", "report.read"] },
  ]);
  // report.export는 선언·target 모두 있지만 grant에 없다.
  assert(
    !effective(A, callerDeclared, grants, targets).app_calls[0].commands
      .includes("report.export"),
  );
  // 반대 방향: B가 A를 부르겠다고 선언해도 grant의 방향은 A→B 하나다.
  const reverse = declarations({
    app_connections: [{ app: A, commands: ["report.read"] }],
  });
  assertEquals(
    effective(B, reverse, grants, { [A]: ["report.read"] }).app_calls,
    [],
  );
  // A→C는 허락한 적이 없다.
  const toC = declarations({
    app_connections: [{ app: C, commands: ["report.read"] }],
  });
  assertEquals(
    effective(A, toC, grants, { [C]: ["report.read"] }).app_calls,
    [],
  );
  // target이 command를 지우면 호출 범위에서 빠진다.
  assertEquals(
    effective(A, callerDeclared, grants, { [B]: ["report.read"] }).app_calls,
    [{ app: B, commands: ["report.read"] }],
  );
});

Deno.test("apps/permissions#R27: agent.commands는 기본 닫힘이고 app.call·fs·net grant와 별개다", () => {
  const declared = declarations({
    commands: ["task.add", "task.list"],
    app_connections: [{ app: B, commands: ["report.read"] }],
    permissions: [{ kind: "net.fetch", scope: NET, reason: "api" }],
  });
  const others = [
    grant(A, { kind: "app.call", app: B, commands: ["report.read"] }),
    grant(A, { kind: "net.fetch", ...NET }),
  ];
  assertEquals(
    effective(A, declared, others, { [B]: ["report.read"] }).agent_commands,
    [],
  );
  const opened = [
    ...others,
    grant(A, { kind: "agent.commands", commands: ["task.list"] }),
  ];
  assertEquals(
    effective(A, declared, opened, { [B]: ["report.read"] }).agent_commands,
    ["task.list"],
  );
  // 현재 blueprint에서 없어진 command는 옛 grant에 남아 있어도 열리지 않는다.
  assertEquals(
    effective(
      A,
      declarations({ commands: ["task.add"] }),
      [grant(A, { kind: "agent.commands", commands: ["task.list"] })],
    ).agent_commands,
    [],
  );
});

Deno.test("apps/automations#R13: automation.run grant는 현재 external 선언과 정확히 같을 때만 쓴다", () => {
  const when = { kind: "interval", interval_ms: 3_600_000 } as const;
  const declared = declarations({
    automations: [{
      key: "sync",
      command: "usage.sync",
      external: true,
      input_hash: HASH,
      when,
    }],
  });
  const exact = grant(A, {
    kind: "automation.run",
    automation: "sync",
    command: "usage.sync",
    input_hash: HASH,
    when,
  });
  assertEquals(effective(A, declared, [exact]).automations.length, 1);
  const otherInput = grant(A, {
    kind: "automation.run",
    automation: "sync",
    command: "usage.sync",
    input_hash: "cd".repeat(32),
    when,
  });
  assertEquals(effective(A, declared, [otherInput]).automations, []);
  // 끄면(revoke) 다음 계산부터 빠진다.
  assertEquals(
    effective(A, declared, [{
      ...exact,
      status: "revoked",
      revoked_by: "user",
      revoked_at: "2026-10-06T02:00:00.000Z",
    }])
      .automations,
    [],
  );
});

function fsRequirement(
  kind: "fs.read" | "fs.write",
  path: string,
  outsideLinks: string[] = [],
): ResolvedRequirement {
  return {
    kind,
    scope: { path, recursive: true, outsideLinks },
    reason: "files",
  };
}

Deno.test("apps/permissions#R24: fs.read와 net.fetch를 함께 요구하면 조합 경고가 표시 자료에 붙고 grant는 자동으로 생기지 않는다", () => {
  const requirements: ResolvedRequirement[] = [
    fsRequirement("fs.read", "/data/reports"),
    { kind: "net.fetch", scope: NET, reason: "upload" },
  ];
  const grants: Grant[] = [];
  const display = buildGrantDisplay({
    app: A,
    release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
    requirements,
    grants,
  });
  assertEquals(display.combination_warnings, [{
    key: "permissions.warning.file-read-and-network",
    kinds: ["fs.read", "net.fetch"],
  }]);
  assertEquals(display.requirements.map((r) => r.reason), ["files", "upload"]);
  // 표시 자료를 만드는 것은 grant를 만들지 않는다. 승인 전 실행 범위는 0이다.
  assertEquals(grants.length, 0);
  assert(display.requirements.every((r) => !r.granted));
  const declared = declarations({
    permissions: requirements.map((r) => ({
      kind: r.kind,
      scope: r.kind === "net.fetch"
        ? r.scope
        : { path: "/data/reports", recursive: true },
      reason: r.reason,
    })) as AppDeclarations["permissions"],
  });
  assertEquals(effective(A, declared, grants).access, []);
  // fs.read만 요구하면 조합 경고는 없다.
  assertEquals(
    buildGrantDisplay({
      app: A,
      release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
      requirements: [fsRequirement("fs.read", "/data/reports")],
      grants,
    }).combination_warnings,
    [],
  );
});

Deno.test("apps/permissions#R6: 폴더 밖을 가리키는 link는 요구별 경고와 대상으로 표시 자료에 붙는다", () => {
  const display = buildGrantDisplay({
    app: A,
    release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
    requirements: [
      fsRequirement("fs.read", "/data/reports", ["/data/reports/link"]),
    ],
    grants: [],
  });
  assertEquals(display.requirements[0].warnings, [
    "permissions.warning.outside-link",
  ]);
  assertEquals(display.requirements[0].outside_links, ["/data/reports/link"]);
});

Deno.test("apps/permissions#R25: 표시 자료는 Deno 한계 문구 key 전체를 담는다", () => {
  const display = buildGrantDisplay({
    app: A,
    release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
    requirements: [],
    grants: [],
  });
  assertEquals(display.limit_keys, LIMIT_KEYS);
  for (
    const key of [
      "permissions.limit.not-isolated",
      "permissions.limit.granted-path-secrets",
      "permissions.limit.symlink-changes",
      "permissions.limit.cpu",
      "permissions.limit.rss",
      "permissions.limit.disk",
    ]
  ) {
    assert(display.limit_keys.includes(key as never));
  }
});

Deno.test("apps/permissions#R1: 같은 정규 scope의 active grant가 있으면 표시 자료가 granted로 표시한다", () => {
  const display = buildGrantDisplay({
    app: A,
    release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
    requirements: [
      { kind: "net.fetch", scope: NET, reason: "api" },
      { kind: "secret.use", scope: { name: "api-key" }, reason: "auth" },
    ],
    grants: [grant(A, { kind: "net.fetch", ...NET })],
  });
  assertEquals(
    display.requirements.map((r) => [r.kind, r.granted]),
    [["net.fetch", true], ["secret.use", false]],
  );
});
