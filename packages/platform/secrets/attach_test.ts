import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import type { SecretPreparation } from "../../protocol/platform/mod.ts";
import { createFakeKeychain } from "./adapters/fake-keychain.ts";
import { createSecretAttach } from "./attach.ts";
import { createSecretRefresh } from "./refresh.ts";
import {
  alive,
  context,
  fakeTx,
  granted,
  ownerCommand,
  references,
  refreshInput,
  storeValue,
  submission,
  text,
  use,
  VALUE,
  work,
} from "./attach-fixture.ts";

Deno.test("platform/secrets#R5: 허용된 전송은 callback 메모리에만 값을 넘기고 결과에는 값이 없다", async () => {
  const keychain = createFakeKeychain();
  const saved = await storeValue(keychain);
  assert(saved.ok);
  const attach = createSecretAttach({
    keychain,
    references: references(use({ sealed_ref: saved.value })),
    allowance: granted,
    processes: alive,
  });
  let seen = "";
  const sent = await attach.send(
    {
      context: context(["secret.send"]),
      use: use({ sealed_ref: saved.value }),
      operation: "model.call",
      body: { prompt: "safe" },
    },
    (value) => {
      seen = text(value);
      return Promise.resolve(ok({ sent: true }));
    },
  );
  assert(sent.ok);
  assertEquals(sent.value, { sent: true });
  assertEquals(seen, VALUE);
  assert(!JSON.stringify(sent.value).includes(VALUE));
});

Deno.test("platform/secrets#R5 platform/security#R9: redirect의 다른 host에는 인증을 넘기지 않는다", async () => {
  const keychain = createFakeKeychain();
  const saved = await storeValue(keychain);
  assert(saved.ok);
  const attach = createSecretAttach({
    keychain,
    references: references(use({ sealed_ref: saved.value })),
    allowance: granted,
    processes: alive,
  });
  let called = false;
  const redirected = await attach.send(
    {
      context: context(["secret.send"]),
      use: use({
        sealed_ref: saved.value,
        destination: { kind: "https", origin: "https://other.example" },
      }),
      operation: "model.call",
      body: {},
    },
    () => {
      called = true;
      return Promise.resolve(ok({ sent: true }));
    },
  );
  assert(!redirected.ok);
  assertEquals(redirected.error.code, "forbidden");
  assertEquals(called, false);
  assert(!JSON.stringify(redirected.error).includes(VALUE));
});

Deno.test("platform/security#R9: 같은 host redirect는 다시 검사해 통과하고 범위 밖 body는 나가지 않는다", async () => {
  const keychain = createFakeKeychain();
  const saved = await storeValue(keychain);
  assert(saved.ok);
  const current = use({ sealed_ref: saved.value });
  const attach = createSecretAttach({
    keychain,
    references: references(current),
    allowance: granted,
    processes: alive,
  });
  const again = await attach.send(
    {
      context: context(["secret.send"]),
      use: current,
      operation: "model.call",
      body: { prompt: "safe" },
    },
    () => Promise.resolve(ok({ sent: true })),
  );
  assert(again.ok);
});

Deno.test("platform/secrets#R5: 외부 MCP 고정 연결도 다른 연결에는 인증을 넘기지 않는다", async () => {
  const keychain = createFakeKeychain();
  const saved = await storeValue(keychain);
  assert(saved.ok);
  const current = use({
    sealed_ref: saved.value,
    purpose: "external_mcp_credential",
    destination: {
      kind: "mcp",
      server_connection: "mcp-a",
      transport: "https",
    },
  });
  const attach = createSecretAttach({
    keychain,
    references: references(current),
    allowance: granted,
    processes: alive,
  });
  const moved = await attach.send(
    {
      context: context(["secret.send"]),
      use: {
        ...current,
        destination: {
          kind: "mcp",
          server_connection: "mcp-b",
          transport: "https",
        },
      },
      operation: "mcp.call",
      body: {},
    },
    () => Promise.resolve(ok({ sent: true })),
  );
  assert(!moved.ok);
  assertEquals(moved.error.code, "forbidden");
});

Deno.test("platform/secrets#R5: 죽은 process·다른 scope·오래된 판은 값을 받지 못한다", async () => {
  const keychain = createFakeKeychain();
  const saved = await storeValue(keychain);
  assert(saved.ok);
  const current = use({ sealed_ref: saved.value });
  const dead = createSecretAttach({
    keychain,
    references: references(current),
    allowance: granted,
    processes: () => false,
  });
  const ended = await dead.send(
    {
      context: context(["secret.send"]),
      use: current,
      operation: "x",
      body: {},
    },
    () => Promise.resolve(ok({ sent: true })),
  );
  assert(!ended.ok);
  assertEquals(ended.error.code, "forbidden");

  const narrow = createSecretAttach({
    keychain,
    references: references(current),
    allowance: granted,
    processes: alive,
  });
  const borrowed = await narrow.send(
    {
      context: { ...context(["secret.send"]), actor: "agent", conditions: {} },
      use: current,
      operation: "x",
      body: {},
    },
    () => Promise.resolve(ok({ sent: true })),
  );
  assert(!borrowed.ok);
  assertEquals(borrowed.error.code, "forbidden");

  const stale = await narrow.send(
    {
      context: context(["secret.send"]),
      use: { ...current, revision: 9 },
      operation: "x",
      body: {},
    },
    () => Promise.resolve(ok({ sent: true })),
  );
  assert(!stale.ok);
  assertEquals(stale.error.code, "conflict");
});

Deno.test("platform/secrets#R3: agent가 받는 갱신 거절에는 이름·사용처·이유만 있고 원문 요청 경로가 없다", async () => {
  const refresh = createSecretRefresh({
    work: work(),
    submit: submission(),
    allowance: granted,
    processes: alive,
    transaction: (run) => Promise.resolve(run(fakeTx())),
  });
  const rejected = await refresh.store(
    refreshInput({
      context: {
        ...context(["secret.store-refresh"]),
        actor: "agent",
        conditions: {},
      },
    }),
    () => Promise.resolve(VALUE),
  );
  assert(!rejected.ok);
  assertEquals(rejected.error.code, "forbidden");
  const body = JSON.stringify(rejected.error);
  assert(!body.includes(VALUE));
  assert(!("value" in (rejected.error as object)));
});

Deno.test("platform/secrets#R11: 갱신 성공은 값 없는 준비와 CAS만 제출하고 새 참조를 돌려준다", async () => {
  const keychain = createFakeKeychain();
  let submitted: { input: unknown; compare: unknown } | undefined;
  const command = ownerCommand();
  const refresh = createSecretRefresh({
    work: work(keychain),
    submit: submission(command),
    allowance: granted,
    processes: alive,
    transaction: (run) => {
      const tx = fakeTx((route, input, compare) => {
        submitted = { input, compare };
        assertEquals(route.name, command.route.name);
        const preparation = (input as { preparation: SecretPreparation })
          .preparation;
        return ok({
          sealed_ref: preparation.sealed_ref,
          revision: 2,
          configured: true as const,
        });
      });
      return Promise.resolve(run(tx));
    },
  });
  const stored = await refresh.store(
    refreshInput(),
    () => Promise.resolve(VALUE),
  );
  assert(stored.ok);
  assertEquals(stored.value.configured, true);
  assertEquals(stored.value.revision, 2);
  assert(submitted !== undefined);
  assertEquals(submitted!.compare, { sealed_ref: "sealed-1", revision: 1 });
  assert(!JSON.stringify(submitted).includes(VALUE));
  assert(!JSON.stringify(stored.value).includes(VALUE));
  assertEquals(keychain.stored.size, 1);
});

Deno.test("platform/secrets#R11: 제출이 실패하면 이전 참조를 유지하고 준비한 값을 고아로 정리한다", async () => {
  const keychain = createFakeKeychain();
  const refresh = createSecretRefresh({
    work: work(keychain),
    submit: submission(),
    allowance: granted,
    processes: alive,
    transaction: (run) =>
      Promise.resolve(
        run(fakeTx(() => err({ code: "conflict", message: "판이 다르다" }))),
      ),
  });
  const failed = await refresh.store(
    refreshInput(),
    () => Promise.resolve("rotated-token"),
  );
  assert(!failed.ok);
  assertEquals(failed.error.code, "conflict");
  assertEquals(keychain.stored.size, 0);
  assert(!JSON.stringify(failed.error).includes("rotated-token"));
});

Deno.test("platform/secrets#R11: 오래된 판의 갱신 제출은 keychain을 바꾸지 않는다", async () => {
  const keychain = createFakeKeychain();
  const refresh = createSecretRefresh({
    work: work(keychain),
    submit: submission(),
    allowance: granted,
    processes: alive,
    transaction: () =>
      Promise.resolve(ok({ sealed_ref: "x", revision: 3, configured: true })),
  });
  const stale = await refresh.store(
    refreshInput({ revision: 4 }),
    () => Promise.resolve(VALUE),
  );
  assert(!stale.ok);
  assertEquals(stale.error.code, "conflict");
  assertEquals(keychain.stored.size, 0);
});

Deno.test("platform/secrets#R10 platform/secrets#R11: SecretAllowance port가 등록되지 않으면 전송·갱신은 forbidden이다", async () => {
  const keychain = createFakeKeychain();
  const saved = await storeValue(keychain);
  assert(saved.ok);
  const attach = createSecretAttach({
    keychain,
    references: references(use({ sealed_ref: saved.value })),
    processes: alive,
  });
  let handed = false;
  const refused = await attach.send(
    {
      context: context(["secret.send"]),
      use: use({ sealed_ref: saved.value }),
      operation: "model.call",
      body: { prompt: "safe" },
    },
    () => {
      handed = true;
      return Promise.resolve(ok({ sent: true }));
    },
  );
  assert(!refused.ok);
  assertEquals(refused.error.code, "forbidden");
  assertEquals(handed, false);
  const refresh = createSecretRefresh({
    work: work(keychain),
    submit: submission(),
    processes: alive,
    transaction: (run) => Promise.resolve(run(fakeTx())),
  });
  let taken = false;
  const denied = await refresh.store(
    refreshInput(),
    () => {
      taken = true;
      return Promise.resolve(VALUE);
    },
  );
  assert(!denied.ok);
  assertEquals(denied.error.code, "forbidden");
  assertEquals(taken, false);
  assertEquals(keychain.stored.size, 1);
});
