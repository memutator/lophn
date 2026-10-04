// 앱 secret 사용의 grant 검사(platform/secrets#R10)와 flow
// manage-app-permissions의 secret 단계 통합. 인증은 플랫폼이 붙이고
// 원값은 어느 호출자에게도 가지 않는다.

import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../contracts/platform/mod.ts";
import { LEDGER_SCHEMA_STEPS, openLedger } from "../ledger/mod.ts";
import { applyMigrations } from "../backup-and-migration/mod.ts";
import { createIdSource, manualClock, seededRandom } from "../../base/mod.ts";
import { createFakeKeychain } from "./adapters/fake-keychain.ts";
import { createSecretAttach } from "./attach.ts";
import type { SecretReferenceLookup } from "./attach.ts";
import { SECRET_SCHEMA_STEPS } from "./schema.ts";

const APP = "app_00000000000000000000000000";
const VALUE = "app-secret-value";
const NAME = "app.service.token";

const START = Date.parse("2026-01-01T00:00:00.000Z");

const destination = {
  kind: "https" as const,
  origin: "https://app.example",
};

// 앱 secret 전송 context. actor는 machine이고 process·task가 고정된다.
function appContext(
  over: Partial<AuthenticatedContext> = {},
): AuthenticatedContext {
  return {
    principal: `app:${APP}`,
    actor: "machine",
    scope: { operations: ["secret.send"], targets: {} },
    conditions: { process: "app-runtime-1", task: "app-ops" },
    credential_ref: "app-cred",
    ...over,
  };
}

function references(sealedRef = "sealed-1"): SecretReferenceLookup {
  return {
    current: () =>
      Promise.resolve(ok({
        name: NAME,
        sealedRef,
        revision: 1,
        purpose: "app_secret" as const,
        destination,
      })),
  };
}

// 현재 grant 판정. apps가 구현하는 SecretAllowance port의 테스트 대역이다.
// 같은 grant의 read·write·external command를 네 호출 경로에서 판정하는 모양이다.
type Grant = { name: string; destinations: readonly string[] };

function grantAllowance(
  grants: readonly Grant[],
): (request: {
  context: AuthenticatedContext;
  name: string;
  purpose: string;
  destination: unknown;
}) => Result<void> {
  return (request) => {
    // 현재 grant만 본다. 목적지가 grant 범위 안에 있을 때만 ok다.
    const granted = grants.find((grant) =>
      grant.name === request.name &&
      grant.destinations.includes(
        (request.destination as { origin: string } | null)?.origin ?? "",
      )
    );
    return granted ? ok(undefined) : err({
      code: "forbidden",
      message: "현재 grant가 이 secret 전송을 허용하지 않는다",
    });
  };
}

Deno.test("platform/secrets#R10: 현재 grant의 secret 전송은 caller 종류와 무관하게 허용된다", async () => {
  const keychain = createFakeKeychain();
  const saved = await keychain.store({
    name: NAME,
    purpose: "app_secret",
    owner: NAME,
    value: new TextEncoder().encode(VALUE),
  });
  assert(saved.ok);
  // 같은 grant로 네 caller(사람 화면·agent·automation·다른 앱)를 좇는 경로.
  // 플랫폼 경계는 context process·task만 검사하고 caller 종류는 보지 않는다.
  const callers = [
    ["human-screen", appContext()],
    [
      "agent",
      appContext({ conditions: { process: "agent-runtime", task: "app-ops" } }),
    ],
    [
      "automation",
      appContext({
        conditions: { process: "automation-clock", task: "app-ops" },
      }),
    ],
    [
      "other-app",
      appContext({ conditions: { process: "app-runtime-2", task: "app-ops" } }),
    ],
  ] as const;
  for (const [caller, context] of callers) {
    const attach = createSecretAttach({
      keychain,
      references: references(saved.value),
      allowance: grantAllowance([{
        name: NAME,
        destinations: [destination.origin],
      }]),
      processes: () => true,
    });
    let seen = "";
    const sent = await attach.send(
      {
        context,
        use: {
          sealed_ref: saved.value,
          revision: 1,
          purpose: "app_secret",
          destination,
        },
        operation: "webhook.call",
        body: {},
      },
      (value) => {
        seen = typeof value === "string"
          ? value
          : new TextDecoder().decode(value);
        return Promise.resolve(ok({ sent: true }));
      },
    );
    assert(sent.ok, `${caller}: ${sent.ok ? "" : JSON.stringify(sent.error)}`);
    assertEquals(seen, VALUE);
    // 원값은 결과에 없다.
    assertFalse(JSON.stringify(sent.value).includes(VALUE));
  }
});

Deno.test("platform/secrets#R10: grant가 없으면 caller와 무관하게 거절하고 값을 넘기지 않는다", async () => {
  const keychain = createFakeKeychain();
  const saved = await keychain.store({
    name: NAME,
    purpose: "app_secret",
    owner: NAME,
    value: new TextEncoder().encode(VALUE),
  });
  assert(saved.ok);
  const attach = createSecretAttach({
    keychain,
    references: references(saved.value),
    // 현재 grant가 없는 상태.
    allowance: grantAllowance([]),
    processes: () => true,
  });
  for (
    const context of [
      appContext(),
      appContext({ conditions: { process: "agent-runtime", task: "app-ops" } }),
      appContext({
        conditions: { process: "automation-clock", task: "app-ops" },
      }),
    ]
  ) {
    let handed = false;
    const refused = await attach.send(
      {
        context,
        use: {
          sealed_ref: saved.value,
          revision: 1,
          purpose: "app_secret",
          destination,
        },
        operation: "webhook.call",
        body: {},
      },
      () => {
        handed = true;
        return Promise.resolve(ok({ sent: true }));
      },
    );
    assert(!refused.ok);
    assertEquals(refused.error.code, "forbidden");
    assertEquals(handed, false);
    assertFalse(JSON.stringify(refused.error).includes(VALUE));
  }
});

Deno.test("platform/secrets#R10: grant 회수 뒤 같은 전송은 forbidden이고 callback 메모리에서만 값이 산다", async () => {
  const keychain = createFakeKeychain();
  const saved = await keychain.store({
    name: NAME,
    purpose: "app_secret",
    owner: NAME,
    value: new TextEncoder().encode(VALUE),
  });
  assert(saved.ok);
  // 회수 전: grant가 있다.
  let grants: readonly Grant[] = [{
    name: NAME,
    destinations: [destination.origin],
  }];
  const attach = createSecretAttach({
    keychain,
    references: references(saved.value),
    allowance: (request) => {
      const granted = grants.find((grant) =>
        grant.name === request.name &&
        grant.destinations.includes(
          (request.destination as { origin: string } | null)?.origin ?? "",
        )
      );
      return granted ? ok(undefined) : err({
        code: "forbidden",
        message: "현재 grant가 이 secret 전송을 허용하지 않는다",
      });
    },
    processes: () => true,
  });
  const before = await attach.send(
    {
      context: appContext(),
      use: {
        sealed_ref: saved.value,
        revision: 1,
        purpose: "app_secret",
        destination,
      },
      operation: "webhook.call",
      body: {},
    },
    () => Promise.resolve(ok({ sent: true })),
  );
  assert(before.ok);
  // 회수: 현재 grant에서 지운다. 같은 전송이 이제 거절된다.
  grants = [];
  const after = await attach.send(
    {
      context: appContext(),
      use: {
        sealed_ref: saved.value,
        revision: 1,
        purpose: "app_secret",
        destination,
      },
      operation: "webhook.call",
      body: {},
    },
    () => Promise.resolve(ok({ sent: true })),
  );
  assert(!after.ok);
  assertEquals(after.error.code, "forbidden");
});

Deno.test("platform/secrets#R10: 32 bytes가 아닌 참조와 Purposes가 다른 사용은 허용하지 않는다", async () => {
  const keychain = createFakeKeychain();
  const saved = await keychain.store({
    name: NAME,
    purpose: "app_secret",
    owner: NAME,
    value: new TextEncoder().encode(VALUE),
  });
  assert(saved.ok);
  // purpose가 다른 사용(goal이 app_secret이 아닌 provider_credential)은
  // 참조의 purpose가 다르므로 forbidden이다.
  const attach = createSecretAttach({
    keychain,
    references: references(saved.value),
    allowance: grantAllowance([{
      name: NAME,
      destinations: [destination.origin],
    }]),
    processes: () => true,
  });
  const mismatched = await attach.send(
    {
      context: appContext(),
      use: {
        sealed_ref: saved.value,
        revision: 1,
        purpose: "provider_credential",
        destination,
      },
      operation: "webhook.call",
      body: {},
    },
    () => Promise.resolve(ok({ sent: true })),
  );
  assert(!mismatched.ok);
  assertEquals(mismatched.error.code, "forbidden");
});

// flow manage-app-permissions의 secret 단계 통합. 사람이 secret을 저장하고
// 앱이 현재 grant 안에서 전송하는 흐름을 ledger와 함께 본다.
Deno.test("platform/secrets#R10 flow manage-app-permissions: 사람 secret 저장과 앱 전송이 현재 grant 안에서 이어진다", async () => {
  // 1. 사람이 secret을 저장하는 단계(platform/secrets#R1·R2·R5).
  const keychain = createFakeKeychain();
  const stored = await keychain.store({
    name: NAME,
    purpose: "app_secret",
    owner: NAME,
    value: new TextEncoder().encode(VALUE),
  });
  assert(stored.ok);
  // 2. 현재 grant를 만드는 단계. 사람 결정으로 grant가 열린다.
  let grants: Grant[] = [{ name: NAME, destinations: [destination.origin] }];
  // 3. 앱이 현재 grant 안에서 secret을 전송하는 단계.
  const attach = createSecretAttach({
    keychain,
    references: references(stored.value),
    allowance: (request) => {
      const granted = grants.find((grant) =>
        grant.name === request.name &&
        grant.destinations.includes(
          (request.destination as { origin: string } | null)?.origin ?? "",
        )
      );
      return granted ? ok(undefined) : err({
        code: "forbidden",
        message: "현재 grant가 이 secret 전송을 허용하지 않는다",
      });
    },
    processes: () => true,
  });
  const sent = await attach.send(
    {
      context: appContext(),
      use: {
        sealed_ref: stored.value,
        revision: 1,
        purpose: "app_secret",
        destination,
      },
      operation: "webhook.call",
      body: {},
    },
    (value) => {
      // 전송 직전에만 인증을 붙인다. 값은 callback 메모리에서만 산다.
      assert(
        typeof value === "string"
          ? value === VALUE
          : new TextDecoder().decode(value) === VALUE,
      );
      return Promise.resolve(ok({ sent: true }));
    },
  );
  assert(sent.ok, sent.ok ? undefined : JSON.stringify(sent.error));
  assertFalse(JSON.stringify(sent).includes(VALUE));
  // 4. secret grant 회수 단계: 다음 호출부터 막는다.
  grants = [];
  const blocked = await attach.send(
    {
      context: appContext(),
      use: {
        sealed_ref: stored.value,
        revision: 1,
        purpose: "app_secret",
        destination,
      },
      operation: "webhook.call",
      body: {},
    },
    () => Promise.resolve(ok({ sent: true })),
  );
  assert(!blocked.ok);
  assertEquals(blocked.error.code, "forbidden");
});

// R10 확인의 read·write·external command 네 경로: 같은 grant로 LEDGER에
// 저장된 값을 read하는 경로는 setSecretCommand로 만든 참조에서만 통과한다.
Deno.test("platform/secrets#R10 flow manage-app-permissions: ledger 저장 참조와 grant 검사가 함께 통과한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "app-secret-flow-" });
  try {
    const path = `${dir}/ledger.db`;
    const applied = await applyMigrations(
      path,
      [...LEDGER_SCHEMA_STEPS, ...SECRET_SCHEMA_STEPS],
      { clock: manualClock(START) },
    );
    assert(applied.ok);
    const opened = openLedger(path, {
      clock: manualClock(START),
      ids: createIdSource({
        clock: manualClock(START),
        random: seededRandom(1),
      }),
      registerBlobRef: () => err({ code: "unavailable", message: "blob 없음" }),
      call: () => err({ code: "unavailable", message: "dispatch 없음" }),
    });
    assert(opened.ok);
    const ledger = opened.value;
    // 사람이 SetSecret으로 저장한 참조 상태만 확인한다. 값은 ledger에 없다.
    const seeded = () =>
      ledger.transaction({ actor: "user" }, (tx) => {
        tx.sql.run(
          "insert into secret_preparations (preparation, sealed_ref, purpose, owner) values (?, ?, ?, ?)",
          ["prep-1", "sealed-app-1", "app_secret", NAME],
        );
        tx.sql.run(
          "insert into secrets (name, sealed_ref, revision) values (?, ?, ?)",
          [NAME, "sealed-app-1", 1],
        );
        return ok(undefined);
      });
    assert(seeded());
    const statusRows = ledger.transaction({ actor: "user" }, (tx) => {
      const rows = tx.sql.all(
        "select name, sealed_ref, revision from secrets",
        [],
      );
      return ok(Array.isArray(rows) ? rows : []);
    });
    assert(statusRows.ok);
    const rows = statusRows.value as { name: unknown; sealed_ref: unknown }[];
    assertEquals(rows.length, 1);
    assertEquals(String(rows[0]["name"]), NAME);
    // 값은 ledger에 없다. 참조·판만 있다.
    assertEquals(String(rows[0]["sealed_ref"] ?? ""), "sealed-app-1");
    ledger.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
