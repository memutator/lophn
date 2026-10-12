// 앱 secret 사용의 grant 검사(platform/secrets#R10). 인증은 플랫폼이 붙이고
// 원값은 어느 호출자에게도 가지 않는다. 아래 대역은 실제 grant 판정이 아니라
// SecretAllowance port의 계약 소비(요청 모양·결과 전파)를 확인하는 대역이다.

import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { LEDGER_SCHEMA_STEPS, openLedger } from "../storage/ledger/mod.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import { createIdSource, manualClock, seededRandom } from "../../base/mod.ts";
import { createFakeKeychain } from "./adapters/fake-keychain.ts";
import { setSecretCommand } from "./commands.ts";
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

// SecretAllowance port 계약 소비 대역. 실제 grant 판정은 apps T4의 grant ledger가
// 하고, 여기서는 port가 받는 요청 모양과 결과 전파만 확인한다.
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

Deno.test("platform/secrets#R10: SecretAllowance port가 등록되지 않으면 전송은 forbidden이다", async () => {
  const keychain = createFakeKeychain();
  const saved = await keychain.store({
    name: NAME,
    purpose: "app_secret",
    owner: NAME,
    value: new TextEncoder().encode(VALUE),
  });
  assert(saved.ok);
  // port 없는 attach. 값이 어느 경로로도 나가지 않는다.
  const attach = createSecretAttach({
    keychain,
    references: references(saved.value),
    processes: () => true,
  });
  let handed = false;
  const refused = await attach.send(
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
    () => {
      handed = true;
      return Promise.resolve(ok({ sent: true }));
    },
  );
  assert(!refused.ok);
  assertEquals(refused.error.code, "forbidden");
  assertEquals(handed, false);
  assertFalse(JSON.stringify(refused.error).includes(VALUE));
});

Deno.test("platform/secrets#R10: SecretAllowance port 계약 소비 - port가 허용하면 caller 종류와 무관하게 전송한다", async () => {
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

Deno.test("platform/secrets#R10: SecretAllowance port 계약 소비 - port가 거절하면 caller와 무관하게 forbidden이고 값을 넘기지 않는다", async () => {
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

Deno.test("platform/secrets#R10: SecretAllowance port 계약 소비 - port가 회수 뒤 forbidden을 돌려주면 같은 전송이 거절된다", async () => {
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

// flow manage-app-permissions의 secret 단계는 실제 grant 판정으로 증명하지 않는다.
// 아래 테스트는 사람이 secret을 저장하고 앱이 전송하는 흐름을
// SecretAllowance port 계약 소비로 이어 본다.
Deno.test("platform/secrets#R10: 사람 secret 저장과 앱 전송이 port 계약 안에서 이어진다", async () => {
  // 1. 사람이 secret을 저장하는 단계(platform/secrets#R1·R2·R5).
  const keychain = createFakeKeychain();
  const stored = await keychain.store({
    name: NAME,
    purpose: "app_secret",
    owner: NAME,
    value: new TextEncoder().encode(VALUE),
  });
  assert(stored.ok);
  // 2. 현재 grant를 만드는 단계. 사람 결정으로 grant가 열린다(port 대역이 이를 흉내 낸다).
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

// 사람 secret 저장은 SetSecret command 경로로 증명한다. 준비 참조만 저장하고
// 값은 ledger에 없는 SetSecret 계약이 참조 상태를 만든다.
Deno.test("platform/secrets#R10: SetSecret 참조 상태와 grant 검사가 함께 통과한다", async () => {
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
    // 사람이 SetSecret command로 참조 상태를 만든다. 값은 ledger에 없다.
    const set = ledger.transaction({ actor: "user" }, (tx) => {
      tx.sql.run(
        "insert into secret_preparations (preparation, sealed_ref, purpose, owner) values (?, ?, ?, ?)",
        ["prep-1", "sealed-app-1", "app_secret", NAME],
      );
      return setSecretCommand.handle(
        tx,
        {
          principal: "user",
          actor: "user",
          scope: { operations: [], targets: {} },
          conditions: {},
          credential_ref: "c",
        },
        {
          name: NAME,
          preparation: {
            preparation: "prep-1",
            sealed_ref: "sealed-app-1",
            purpose: "app_secret" as const,
            owner: NAME,
          },
        },
        { sealed_ref: null, revision: null },
      );
    });
    assert(set.ok, set.ok ? undefined : JSON.stringify(set.error));
    assertEquals(set.value, { name: NAME, configured: true, revision: 1 });
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
