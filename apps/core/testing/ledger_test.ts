import { assertEquals } from "@std/assert";
import {
  code,
  credential,
  ctx,
  envelope,
  harness,
  nowMs,
  otherRun,
  readRoute,
  run,
  value,
} from "./ledger-support_test.ts";

Deno.test("platform/ledger#R1 R2 R3 R13 R14: public 예제로 실제 WAL writer/readers를 조립한다", async () => {
  const h = await harness();
  try {
    assertEquals(
      value(await h.inspect("pragma journal_mode"))[0].journal_mode,
      "wal",
    );
    assertEquals(value(await h.inspect("pragma query_only"))[0].query_only, 1n);
    const commands = await Promise.all([
      h.command(ctx, envelope("first")),
      h.command(ctx, envelope("second")),
    ]);
    assertEquals(
      commands.map((result) =>
        (value(result).result as { serial: number }).serial
      ),
      [1, 2],
    );
    assertEquals(value(commands[0]).first_seq, "1");
    assertEquals(value(commands[1]).last_seq, "2");
    assertEquals(value(await h.command(ctx, envelope("first"))).replayed, true);
    code(
      await h.command(ctx, envelope("first", { key: "changed" })),
      "conflict",
    );
    const result = value(await h.readResult(ctx, "first"));
    assertEquals(result?.principal, ctx.principal);
    for (let index = 0; index < 2; index++) {
      const read = value(await h.read(readRoute, ctx, {})) as Record<
        string,
        unknown
      >;
      assertEquals(read.keys, ["first", "second"]);
      assertEquals(read.as_of_seq, "2");
      assertEquals(read.next_cursor, null);
      assertEquals(read.port, "reader-local-port");
      assertEquals(read.sealed, true);
    }
    const sealed = value(
      await h.command(ctx, {
        ...envelope("finish"),
        command: "owner.finish",
        input: {},
      }),
    );
    assertEquals(sealed.result, { sealed: true });
  } finally {
    await h.close();
  }
});

Deno.test("platform/ledger#R3 R4 R22: Tx port/blob callback의 domain event result를 함께 rollback한다", async () => {
  const h = await harness();
  try {
    code(
      await h.command(
        ctx,
        envelope("failed", { key: "failed", blob: true, fail: true }),
      ),
      "conflict",
    );
    for (const table of ["owners", "events", "command_results", "blob_refs"]) {
      assertEquals(
        value(await h.inspect(`select count(*) as n from ${table}`))[0].n,
        0n,
      );
    }
    value(await h.command(ctx, envelope("blob", { key: "blob", blob: true })));
    assertEquals(
      value(await h.inspect("select owner_key, registered_seq from blob_refs")),
      [{ owner_key: "blob", registered_seq: 1n }],
    );
    assertEquals(
      value(
        await h.command(ctx, {
          ...envelope("finish"),
          command: "owner.finish",
          input: {},
        }),
      ).result,
      { sealed: true },
    );
    assertEquals(value(await h.inspect("select key from owners")), [{
      key: "blob",
    }]);
  } finally {
    await h.close();
  }
});

Deno.test("platform/ledger#R13 R14: submitted scope보다 현재 credential narrowing/revoke/binding/expiry를 따른다", async () => {
  const h = await harness();
  try {
    value(await h.command(ctx, envelope("one")));
    value(
      await h.setCredential({
        ...ctx,
        scope: { operations: ["owner.read"], targets: {} },
        conditions: { mode: "narrow" },
      }),
    );
    code(await h.command(ctx, envelope("one")), "forbidden");
    code(await h.readResult(ctx, "one"), "forbidden");
    assertEquals(
      (value(await h.read(readRoute, ctx, {})) as { mode: string }).mode,
      "narrow",
    );
    value(await h.revokeCredential(ctx.credential_ref));
    code(await h.read(readRoute, ctx, {}), "unauthorized");
    code(await h.command(ctx, envelope("one")), "unauthorized");
    value(await h.setCredential({ ...ctx, principal: "replacement" }));
    code(await h.command(ctx, envelope("new")), "forbidden");
    value(await h.setCredential({ ...ctx, actor: "machine" }));
    code(await h.read(readRoute, ctx, {}), "forbidden");
    value(
      await h.setCredential({
        ...ctx,
        expires_at: new Date(nowMs).toISOString(),
      }),
    );
    code(await h.command(ctx, envelope("new")), "unauthorized");
    const other = credential("user", "other");
    value(await h.setCredential(other));
    assertEquals(value(await h.readResult(other, "one")), null);
    value(await h.command(other, envelope("one", { key: "other" })));
    assertEquals(
      value(await h.inspect("select count(*) as n from command_results"))[0].n,
      2n,
    );
  } finally {
    await h.close();
  }
});

Deno.test("platform/ledger#R3 R11 R13 R14: 다섯 actor의 exact scope/current conditions/effective run을 보존한다", async () => {
  const h = await harness();
  try {
    for (
      const actor of [
        "user",
        "machine",
        "coding_agent:cac_01jgfjjz008000000000000000",
        "agent:asg_01jgfjjz008000000000000000",
        "app:app_01jgfjjz008000000000000000",
      ]
    ) {
      const current = {
        ...credential(actor),
        conditions: { run, mode: "current", task: "exact" },
        scope: { ...ctx.scope, targets: { task: "exact" } },
      };
      value(await h.setCredential(current));
      assertEquals(
        (value(await h.read(readRoute, current, {})) as { run: string }).run,
        run,
      );
      const claim = {
        ...current,
        scope: ctx.scope,
        conditions: { run, mode: "stale", task: "stale" },
      };
      const success = value(
        await h.command(claim, envelope(actor.replaceAll(":", "-"))),
      );
      assertEquals(
        success.result as {
          serial: number;
          actor: string;
          run: string;
          mode: string;
        },
        {
          serial: (success.result as { serial: number }).serial,
          actor,
          run,
          mode: "current",
        },
      );
      code(
        await h.command(claim, {
          ...envelope(`wrong-${actor}`),
          run: otherRun,
        }),
        "forbidden",
      );
      code(
        await h.read(readRoute, { ...claim, run: otherRun }, {}),
        "forbidden",
      );
      assertEquals(
        (value(await h.read(readRoute, claim, {})) as { actor: string }).actor,
        actor,
      );
      value(
        await h.setCredential({ ...current, conditions: { mode: "unbound" } }),
      );
      code(await h.command(claim, envelope(`stale-run-${actor}`)), "forbidden");
      code(await h.read(readRoute, claim, {}), "forbidden");
    }
    assertEquals(value(await h.inspect("select distinct run from events")), [{
      run,
    }]);
  } finally {
    await h.close();
  }
});

Deno.test("platform/ledger#R8: manual clock와 seeded ids는 별도 harness에서도 결정적이다", async () => {
  const first = await harness();
  const second = await harness();
  try {
    value(await first.command(ctx, envelope("same")));
    value(await second.command(ctx, envelope("same")));
    const firstEvent = value(
      await first.inspect("select payload, at from events"),
    );
    assertEquals(
      firstEvent,
      value(await second.inspect("select payload, at from events")),
    );
    assertEquals(firstEvent[0].at, new Date(nowMs).toISOString());
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

Deno.test("platform/ledger#R10 R20: write probe는 immutable REPLACE를 거절하고 성공도 rollback한다", async () => {
  const h = await harness();
  try {
    value(await h.command(ctx, envelope("kept")));
    const before = value(await h.inspect("select * from events"));
    code(
      await h.probeWrite(
        "insert or replace into events select * from events where seq = 1",
      ),
      "invalid_input",
    );
    code(
      await h.probeWrite(
        "replace into command_results select * from command_results",
      ),
      "invalid_input",
    );
    code(
      await h.probeWrite(
        "replace into schema_migrations select * from schema_migrations where version = 1",
      ),
      "invalid_input",
    );
    value(await h.probeWrite("insert into owners values (?)", ["probe"]));
    assertEquals(value(await h.inspect("select key from owners")), [{
      key: "kept",
    }]);
    assertEquals(value(await h.inspect("select * from events")), before);
    code(await h.probeWrite("commit"), "invalid_input");
    code(
      await h.command(ctx, {
        ...envelope("unregistered"),
        command: "not.registered",
      }),
      "invalid_input",
    );
  } finally {
    await h.close();
  }
});
