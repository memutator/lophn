import { assertEquals } from "@std/assert";
import type {
  Grant,
  GrantPermissionScope,
} from "../../../protocol/apps/mod.ts";
import { effectiveScope } from "../permissions/mod.ts";
import { pairScope, resolveCall } from "./resolve.ts";

const A = "app_01h455vb4pex5v6nkc6gd5fd01";
const B = "app_01h455vb4pex5v6nkc6gd5fd02";
const C = "app_01h455vb4pex5v6nkc6gd5fd03";

let count = 0;
function grant(
  app: string,
  scope: GrantPermissionScope,
  status: "active" | "revoked" = "active",
): Grant {
  count += 1;
  const n = String(count).padStart(2, "0");
  return {
    id: `grt_01h455vb4pex5v6nkc6gd5fd${n}`,
    app,
    kind: scope.kind,
    scope,
    approval: `apr_01h455vb4pex5v6nkc6gd5fd${n}`,
    status,
    created_by: "user",
    created_at: "2026-10-06T00:00:00.000Z",
    revoked_by: status === "revoked" ? "user" : null,
    revoked_at: status === "revoked" ? "2026-10-06T01:00:00.000Z" : null,
  };
}

const call = (app: string, commands: string[]): GrantPermissionScope => ({
  kind: "app.call",
  app,
  commands,
});

Deno.test("apps/connections#R1: A에서 B의 두 command를 허락하면 그 둘만 부르고 B에서 A와 A에서 C는 열리지 않는다", () => {
  const grants = [grant(A, call(B, ["read", "save"]))];
  const declared = [{ app: B, commands: ["read", "save", "admin"] }];
  assertEquals(pairScope({ source: A, target: B, declared, grants }), [
    "read",
    "save",
  ]);
  const input = {
    source: A,
    target: B,
    declared,
    grants,
    targetCommands: ["read", "save", "admin"],
  };
  assertEquals(
    resolveCall({ ...input, requested: ["read", "save"] }).kind,
    "scoped",
  );
  // 선언했어도 grant가 없는 command는 부르지 못한다.
  assertEquals(resolveCall({ ...input, requested: ["admin"] }).kind, "denied");
  // 반대 방향 B→A는 B 자신의 선언·grant가 없으니 앱 쌍 자체가 없다.
  assertEquals(
    resolveCall({
      source: B,
      target: A,
      declared: [],
      grants,
      targetCommands: ["read"],
      requested: ["read"],
    }),
    { kind: "absent" },
  );
  // A→C는 선언도 grant도 없다.
  assertEquals(
    resolveCall({
      source: A,
      target: C,
      declared,
      grants,
      targetCommands: ["read"],
      requested: ["read"],
    }),
    { kind: "absent" },
  );
  // 다른 앱 쌍 grant나 회수된 grant는 범위를 넓히지 않는다.
  assertEquals(
    pairScope({
      source: A,
      target: B,
      declared,
      grants: [
        grant(A, call(C, ["read"])),
        grant(A, call(B, ["admin"]), "revoked"),
        grant(B, call(B, ["admin"])),
      ],
    }),
    [],
  );
  // 자기 앱은 대상이 될 수 없다.
  assertEquals(
    pairScope({
      source: A,
      target: A,
      declared: [{ app: A, commands: ["read"] }],
      grants: [grant(A, call(A, ["read"]))],
    }),
    [],
  );
});

Deno.test("apps/connections#R2: 호출 범위는 source 선언 ∩ active app.call grant ∩ target 현재 command이고 새 command는 옛 grant로 안 열린다", () => {
  const grants = [grant(A, call(B, ["read"]))];
  const base = {
    source: A,
    target: B,
    grants,
    targetCommands: ["read", "save"],
  };
  // 같은 범위의 새 release 선언은 그대로 호출된다.
  const same = resolveCall({
    ...base,
    declared: [{ app: B, commands: ["read"] }],
    requested: ["read"],
  });
  assertEquals(same.kind, "scoped");
  // 새 command를 더한 선언도 옛 grant에는 없으니 부르지 못한다.
  const widened = [{ app: B, commands: ["read", "save"] }];
  assertEquals(
    resolveCall({ ...base, declared: widened, requested: ["save"] }).kind,
    "denied",
  );
  assertEquals(
    resolveCall({ ...base, declared: widened, requested: ["read"] }).kind,
    "scoped",
  );
  // 선언에서 뺀 command는 grant가 남아도 부르지 못한다.
  assertEquals(
    resolveCall({
      ...base,
      declared: [{ app: B, commands: ["save"] }],
      requested: ["read"],
    }).kind,
    "absent",
  );
  // target에서 사라진 command도 부르지 못한다.
  assertEquals(
    resolveCall({
      ...base,
      declared: widened,
      targetCommands: ["save"],
      requested: ["read"],
    }).kind,
    "denied",
  );
  // 회수하면 범위가 없다.
  assertEquals(
    resolveCall({
      ...base,
      grants: [grant(A, call(B, ["read"]), "revoked")],
      declared: widened,
      requested: ["read"],
    }),
    { kind: "absent" },
  );
});

Deno.test("apps/connections#R2: grant가 둘로 나뉘어도 합친 범위이고 origin grant는 요청을 가장 많이 덮는 것이다", () => {
  const first = grant(A, call(B, ["read"]));
  const second = grant(A, call(B, ["save", "admin"]));
  const input = {
    source: A,
    target: B,
    declared: [{ app: B, commands: ["read", "save", "admin"] }],
    grants: [first, second],
    targetCommands: ["read", "save", "admin"],
  };
  assertEquals(resolveCall({ ...input, requested: ["read"] }), {
    kind: "scoped",
    commands: ["read"],
    grant: first.id,
  });
  assertEquals(resolveCall({ ...input, requested: ["save", "admin"] }), {
    kind: "scoped",
    commands: ["admin", "save"],
    grant: second.id,
  });
  // 빈 요청은 범위를 만들지 않는다.
  assertEquals(resolveCall({ ...input, requested: [] }).kind, "denied");
});

Deno.test("apps/connections#R2: 순수 범위 계산은 permissions의 effectiveScope.app_calls와 같다", () => {
  const grants = [
    grant(A, call(B, ["read", "save"])),
    grant(A, call(C, ["read"])),
    grant(A, call(B, ["admin"]), "revoked"),
  ];
  const declared = [
    { app: B, commands: ["read", "admin"] },
    { app: C, commands: ["read"] },
  ];
  const targets: Record<string, string[]> = {
    [B]: ["read", "save", "admin"],
    [C]: [],
  };
  const effective = effectiveScope({
    app: A,
    declarations: {
      release: "rel_01h455vb4pex5v6nkc6gd5fd01",
      permissions: [],
      app_connections: declared,
      commands: [],
      automations: [],
    },
    grants,
    targetCommands: (app) => targets[app],
  }).app_calls;
  for (const target of [B, C]) {
    const callable = pairScope({ source: A, target, declared, grants })
      .filter((command) => targets[target].includes(command));
    const expected = effective.find((entry) => entry.app === target);
    assertEquals(callable, expected?.commands ?? []);
  }
});
