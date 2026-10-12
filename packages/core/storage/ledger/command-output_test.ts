import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import {
  type CommandDefinition,
  defineCommand,
  defineEvent,
} from "../../../protocol/server/mod.ts";
import { deps, fileLedger, looseFixtureCase, user } from "./command-harness.ts";
import { defineSyncCommand } from "./handler.ts";
import type { LedgerConnection } from "./sqlite.ts";
import { LOOSE_NOTE_MODES, LOOSE_VALID_MODES } from "./test-commands.ts";
import { openWriter, runCommand } from "./writer.ts";

const fixture = new URL("./writer-fixture.ts", import.meta.url);

const probed = defineEvent("ProbeRecorded", {
  subject: z.string(),
  payload: z.object({ value: z.string() }),
});

function probeRoute<S extends z.ZodType>(output: S) {
  return defineCommand({
    resource: "probe",
    method: "record",
    name: "RecordProbe",
    input: z.object({}),
    output,
    compare: z.object({}),
    actors: ["user"],
    errors: ["internal", "invalid_input", "conflict"],
  });
}

const ctx = { ...user(), scope: { operations: ["RecordProbe"], targets: {} } };

function envelope(key: string) {
  return {
    command: "RecordProbe",
    input: {},
    compare: {},
    idempotency_key: key,
    prepared: [] as string[],
  };
}

function count(connection: LedgerConnection, table: string): unknown {
  return connection.sql.get(`select count(*) as n from ${table}`, [])?.["n"];
}

type Case = { label: string; output: z.ZodType; raw: () => unknown };

// schema strip·transform·-0 정규화가 raw 비JSON이나 다른 JSON을 성공으로 바꾸지 못한다.
const cases: Case[] = [
  {
    label: "strip-function",
    output: z.object({ value: z.string() }),
    raw: () => ok({ value: "valid", unsafe: () => "not JSON" }),
  },
  {
    label: "strip-symbol",
    output: z.object({ value: z.string() }),
    raw: () => ok({ value: "valid", unsafe: Symbol("x") }),
  },
  {
    label: "optional-undefined",
    output: z.object({ value: z.string(), extra: z.string().optional() }),
    raw: () => ok({ value: "valid", extra: undefined }),
  },
  {
    label: "minus-zero",
    output: z.object({ value: z.number().refine((v) => Object.is(v, -0)) }),
    raw: () => ok({ value: -0 }),
  },
  {
    label: "transform",
    output: z.object({ value: z.string().transform((v) => v.length) }),
    raw: () => ok({ value: "abc" }),
  },
  {
    label: "date",
    output: z.object({ value: z.unknown() }),
    raw: () => ok({ value: new Date(0) }),
  },
  {
    label: "number-zero",
    output: z.object({ value: z.number() }),
    raw: () => ok({ value: -0 }),
  },
  {
    label: "strip-zero",
    output: z.object({ value: z.string() }),
    raw: () => ok({ value: "valid", dropped: -0 }),
  },
  {
    label: "details-zero",
    output: z.object({ value: z.string() }),
    raw: () =>
      err({ code: "conflict", message: "거절", details: { count: -0 } }),
  },
  {
    label: "error-strip-zero",
    output: z.object({ value: z.string() }),
    raw: () => err({ code: "conflict", message: "거절", dropped: -0 }),
  },
  {
    label: "details-strip",
    output: z.object({ value: z.string() }),
    raw: () => err({ code: "conflict", message: "거절", hint: () => "x" }),
  },
  {
    label: "details-undefined",
    output: z.object({ value: z.string() }),
    raw: () =>
      err({ code: "conflict", message: "거절", details: { why: undefined } }),
  },
];

Deno.test("platform/ledger#R3: 직접 정의·wrapper handler의 raw 비JSON·정규화 불일치 output·details는 internal+rollback이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-output-" });
  const { connection } = await fileLedger(dir);
  for (const { label, output, raw } of cases) {
    const route = probeRoute(output);
    const direct: CommandDefinition = {
      route,
      handle(tx) {
        tx.emit(probed, `probe:${label}`, { value: label });
        return raw() as never;
      },
    };
    const wrapped = defineSyncCommand(route, (tx) => {
      tx.emit(probed, `probe:${label}`, { value: label });
      return raw() as never;
    });
    for (
      const [kind, definition] of [["direct", direct], [
        "wrapped",
        wrapped,
      ]] as const
    ) {
      const result = await runCommand(
        connection,
        deps(),
        [definition],
        ctx,
        envelope(`${kind}-${label}`),
      );
      assert(!result.ok, `${kind} ${label}`);
      if (!result.ok) assertEquals(result.error.code, "internal", label);
    }
  }
  assertEquals(count(connection, "events"), 0n);
  assertEquals(count(connection, "command_results"), 0n);
  // schema가 JSON 값의 남는 key만 지우면 지운 JSON이 그대로 저장·송신된다.
  const valid: CommandDefinition = {
    route: probeRoute(z.object({ value: z.string() })),
    handle(tx) {
      tx.emit(probed, "probe:valid", { value: "valid" });
      return ok({ value: "valid", note: "dropped" }) as never;
    },
  };
  const kept = await runCommand(
    connection,
    deps(),
    [valid],
    ctx,
    envelope("valid"),
  );
  assert(kept.ok);
  if (kept.ok) assertEquals(kept.value.result, { value: "valid" });
  const stored = connection.sql.get("select result from command_results", []);
  assertEquals(stored?.["result"], '{"value":"valid"}');
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R3: 실제 Worker의 strip·undefined·-0·transform·details 비JSON은 internal이고 다음 command는 되며 정상 strip·+0은 저장값과 같다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-output-" });
  const { path, connection } = await fileLedger(dir);
  connection.close();
  const writer = openWriter(path, fixture);
  const valid: readonly string[] = LOOSE_VALID_MODES;
  const sent = new Map<string, unknown>();
  for (const mode of LOOSE_NOTE_MODES.filter((m) => !valid.includes(m))) {
    const result = await writer.command(
      user(),
      looseFixtureCase(mode, mode, `loose-${mode}`),
    );
    assert(!result.ok, mode);
    if (!result.ok) assertEquals(result.error.code, "internal", mode);
    // 같은 Worker의 다음 command는 계속 된다.
    const next = await writer.command(
      user(),
      looseFixtureCase(`after-${mode}`, "ok", `after-${mode}`),
    );
    assert(next.ok, `after ${mode}`);
    if (next.ok) sent.set(`after-${mode}`, next.value.result);
  }
  for (const mode of LOOSE_VALID_MODES) {
    const result = await writer.command(
      user(),
      looseFixtureCase(mode, mode, `loose-${mode}`),
    );
    assert(result.ok, mode);
    if (result.ok) sent.set(`loose-${mode}`, result.value.result);
  }
  await writer.close();
  const strip = sent.get("loose-strip-extra") as Record<string, unknown>;
  assertEquals(Object.keys(strip).sort(), ["name", "seq"]);
  const zero = sent.get("loose-plus-zero") as Record<string, unknown>;
  assert(Object.is(zero["count"], 0));
  const { connection: reader } = await fileLedger(dir);
  for (const [key, result] of sent) {
    const row = reader.sql.get(
      "select result from command_results where idempotency_key = ?",
      [key],
    );
    assertEquals(JSON.parse(String(row?.["result"])), result, key);
  }
  assertEquals(count(reader, "events"), BigInt(sent.size));
  assertEquals(count(reader, "command_results"), BigInt(sent.size));
  reader.close();
  await Deno.remove(dir, { recursive: true });
});
