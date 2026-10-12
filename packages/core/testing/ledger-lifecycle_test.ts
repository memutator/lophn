import { assert, assertEquals } from "@std/assert";
import { createLedgerHarness } from "./ledger.ts";
import {
  code,
  ctx,
  envelope,
  fixture,
  harness,
  readRoute,
  value,
} from "./ledger-support_test.ts";

Deno.test("platform/ledger#R20 R21: duplicate/invalid registration은 partial startup 뒤 안전하게 닫힌다", async () => {
  for (const kind of ["command", "path", "read", "schema", "blob", "invalid"]) {
    const duplicate = new URL(
      `./invalid-registration_test.ts?kind=${kind}`,
      import.meta.url,
    );
    code(
      await createLedgerHarness({
        registrationModules: [fixture, duplicate],
        credentials: [ctx],
      }),
      "unavailable",
    );
  }
  for (const kind of ["clock", "ids"]) {
    const singleton = new URL(
      `./invalid-registration_test.ts?kind=${kind}`,
      import.meta.url,
    );
    code(
      await createLedgerHarness({
        registrationModules: [singleton, singleton],
      }),
      "unavailable",
    );
  }
  const partial = new URL(
    "./invalid-registration_test.ts?kind=reader-startup",
    import.meta.url,
  );
  code(
    await createLedgerHarness({
      registrationModules: [fixture, partial],
      credentials: [ctx],
    }),
    "unavailable",
  );
  const missing = new URL("./missing-registration_test.ts", import.meta.url);
  code(
    await createLedgerHarness({ registrationModules: [missing] }),
    "unavailable",
  );
});

Deno.test("platform/ledger#R16 R21: structured clone 실패·pending close를 유한하게 settle한다", async () => {
  const h = await harness();
  code(
    await h.command(ctx, envelope("clone", { key: () => 1 })),
    "invalid_input",
  );
  const pending = Array.from(
    { length: 70 },
    (_, index) => h.command(ctx, envelope(`pending-${index}`)),
  );
  for (const capped of pending.slice(64)) code(await capped, "unavailable");
  const closing = h.close();
  assertEquals(h.close(), closing);
  const settled = await Promise.all(pending);
  assertEquals(settled.length, 70);
  assert(
    settled.every((result) => result.ok || result.error.code === "unavailable"),
  );
  await closing;
  code(await h.inspect("select * from owners"), "unavailable");
});

Deno.test("platform/ledger#R13 R16: cap에서도 credential revoke가 실제 writer reply 뒤 barrier를 지킨다", async () => {
  const h = await harness();
  try {
    const pending = Array.from(
      { length: 64 },
      (_, index) => h.command(ctx, envelope(`queued-${index}`)),
    );
    const revoked = h.revokeCredential(ctx.credential_ref);
    const after = h.command(ctx, envelope("after-revoke"));
    const settled = await Promise.all(pending);
    assert(settled.every((result) => result.ok));
    value(await revoked);
    code(await after, "unavailable");
    code(await h.command(ctx, envelope("later")), "unauthorized");
    code(await h.read(readRoute, ctx, {}), "unauthorized");
  } finally {
    await h.close();
  }
});

Deno.test("platform/ledger#R14 R16 R21: reader deadline은 sibling/pending과 파일을 정리한다", async () => {
  const blocked = new URL(
    "./invalid-registration_test.ts?kind=reader-timeout",
    import.meta.url,
  );
  const h = value(
    await createLedgerHarness({
      registrationModules: [fixture, blocked],
      credentials: [ctx],
    }),
  );
  const file = String(value(await h.inspect("pragma database_list"))[0].file);
  const first = h.read({ resource: "blocked", method: "read" }, ctx, {});
  const second = h.read({ resource: "blocked", method: "read" }, ctx, {});
  code(await first, "unavailable");
  code(await second, "unavailable");
  await h.close();
  let missing = false;
  try {
    await Deno.stat(file);
  } catch (error) {
    missing = error instanceof Deno.errors.NotFound;
  }
  assert(missing);
});

Deno.test("platform/ledger#R21: close가 실제 파일 directory를 삭제한다", async () => {
  const h = await harness();
  const file = String(value(await h.inspect("pragma database_list"))[0].file);
  assert((await Deno.stat(file)).isFile);
  await h.close();
  let missing = false;
  try {
    await Deno.stat(file.slice(0, file.lastIndexOf("/")));
  } catch (error) {
    missing = error instanceof Deno.errors.NotFound;
  }
  assert(missing);
  await h.close();
});

Deno.test("platform/ledger#R21: 실제 Worker error가 pending 요청과 sibling Worker를 닫는다", async () => {
  const h = await harness();
  const crashed = h.command(ctx, {
    ...envelope("crash"),
    command: "owner.crash",
    input: {},
  });
  const pending = h.command(ctx, envelope("after-crash"));
  code(await crashed, "unavailable");
  code(await pending, "unavailable");
  code(await h.read(readRoute, ctx, {}), "unavailable");
  await h.close();
});
