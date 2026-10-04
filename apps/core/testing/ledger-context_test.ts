import { assertEquals } from "@std/assert";
import { createLedgerHarness } from "./ledger.ts";
import {
  code,
  ctx,
  envelope,
  fixture,
  harness,
  readRoute,
  run,
  value,
} from "./ledger-support_test.ts";

Deno.test("platform/ledger#R3 platform/ledger#R11 platform/ledger#R22: blob callback은 handler·이전 callback mutation 밖의 current context를 받는다", async () => {
  const current = {
    ...ctx,
    scope: { operations: ["context.create"], targets: {} },
    conditions: { mode: "current", run },
  };
  const h = value(
    await createLedgerHarness({
      registrationModules: [
        new URL("./context-registration_test.ts", import.meta.url),
      ],
      credentials: [current],
    }),
  );
  const command = (key: string, mutate: boolean) => ({
    ...envelope(key),
    command: "context.create",
    input: { mutate },
  });
  try {
    code(await h.command(current, command("mutating", true)), "forbidden");
    for (
      const table of ["contexts", "context_refs", "events", "command_results"]
    ) {
      assertEquals(
        value(await h.inspect(`select count(*) as n from ${table}`))[0].n,
        0n,
      );
    }
    value(await h.command(current, command("kept", false)));
    assertEquals(
      value(await h.inspect("select value from context_refs order by value")),
      [
        { value: "first" },
        { value: "second" },
      ],
    );
    assertEquals(value(await h.inspect("select actor, run from events")), [{
      actor: "user",
      run,
    }]);
    assertEquals(
      value(await h.inspect("select principal from command_results")),
      [{ principal: current.principal }],
    );
  } finally {
    await h.close();
  }
});

Deno.test("platform/ledger#R11 platform/ledger#R14: unbound read의 명시 run은 유지하고 current run이 있으면 일치를 검사한다", async () => {
  const h = await harness();
  try {
    assertEquals(
      (value(await h.read(readRoute, { ...ctx, run }, {})) as { run: string })
        .run,
      run,
    );
    value(await h.setCredential({ ...ctx, conditions: { run } }));
    assertEquals(
      (value(await h.read(readRoute, ctx, {})) as { run: string }).run,
      run,
    );
    code(
      await h.read(
        readRoute,
        { ...ctx, run: "run_01jgfjjz008000000000000001" },
        {},
      ),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});

Deno.test("platform/identity#R3 platform/ledger#R13 platform/ledger#R14: current target own key restriction과 issued snapshot을 보존한다", async () => {
  const h = value(
    await createLedgerHarness({
      registrationModules: [fixture],
      credentials: [ctx],
    }),
  );
  const nested = { task: ["exact"] };
  const targets = JSON.parse('{"__proto__":{"task":["exact"]}}');
  targets.__proto__ = nested;
  const restricted = { ...ctx, scope: { ...ctx.scope, targets } };
  try {
    const changed = h.setCredential(restricted);
    nested.task.push("wider");
    delete targets.__proto__;
    value(await changed);
    code(await h.command(ctx, envelope("denied")), "forbidden");
    code(await h.read(readRoute, ctx, {}), "forbidden");
    assertEquals(
      value(await h.inspect("select count(*) as n from events"))[0].n,
      0n,
    );
    value(await h.setCredential(ctx));
    value(await h.command(ctx, envelope("kept")));
  } finally {
    await h.close();
  }
});
