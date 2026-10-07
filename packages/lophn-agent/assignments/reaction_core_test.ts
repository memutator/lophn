// AppCreated 반응과 구독자 cursor의 같은 transaction 확정(R1)을 direct connection으로
// 본다. createLedgerHarness는 구독자 gate를 만들지 않아 reaction-field command가
// unavailable로 거절되므로, gate를 만드는 등록 executor 경로(applyMigrations + runCommand)를
// 그대로 부른다. 반응 engine은 packages/lophn-agent/assignments/reaction.ts의 실제 것을 쓴다.
import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import {
  canonicalize,
  err,
  type LophnError,
  manualClock,
  ok,
} from "../../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../../packages/contracts/platform/mod.ts";
import { applyMigrations } from "../../../packages/platform/backup-and-migration/mod.ts";
import {
  createSubscriberGate,
  LEDGER_SCHEMA_STEPS,
  openConnection,
  runCommand,
} from "../../../packages/platform/ledger/mod.ts";
import { advanceSubscriberCursorCommand } from "../../../packages/platform/ledger/commands.ts";
import { presetSchemaSteps } from "../../../packages/lophn-agent/presets/mod.ts";
import { createPresetCommands } from "../../../packages/lophn-agent/presets/mod.ts";
import { presetValidateDeps } from "../../../packages/lophn-agent/assignments/registration_test.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
} from "../../../packages/lophn-agent/assignments/mod.ts";
import {
  ASSIGNMENT_SUBSCRIBER,
} from "../../../packages/contracts/lophn-agent/mod.ts";
import {
  assignmentEngine,
  assignmentMachineContext,
} from "../../../packages/lophn-agent/assignments/reaction.ts";

const NOW = Date.UTC(2026, 0, 1);
const NOW_TEXT = "2026-01-01T00:00:00.000Z";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const PRESET = "pst_01arz3ndektsv4rrffq69g5fav";

function definitionHash(definition: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(definition), "utf8").digest(
    "hex",
  );
}

function presetDefinitionJson(kind: string) {
  return {
    kind,
    name: "Review",
    origin: "product",
    prompt: "a".repeat(64),
    capability: {
      bundles: [{ name: "read-only", revision: 1 }],
      tools: [],
    },
    context: [{ kind: "all", target: null, section: null }],
    mcp: { servers: [], tools: [] },
    safe_tools: [],
    skills: [],
    model: null,
    organizing_model: null,
    instructions: [],
  };
}

Deno.test("lophn-agent/assignments#R1: AppCreated 반응의 assignment·event·cursor가 같은 transaction에 확정된다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "asg-r1-rxn-" });
  const path = `${dir}/ledger.db`;
  try {
    const clock = manualClock(NOW);
    const applied = await applyMigrations(
      path,
      [...LEDGER_SCHEMA_STEPS, ...presetSchemaSteps, ...assignmentSchemaSteps],
      { clock },
    );
    assert(applied.ok, applied.ok ? "" : JSON.stringify(applied.error));
    const opened = openConnection(path);
    assert(opened.ok, "open");
    const connection = opened.value;

    const gate = createSubscriberGate([{
      name: ASSIGNMENT_SUBSCRIBER,
      authorize: (ctx) =>
        ok(ctx.principal === "machine:lophn-agent-assignments"),
    }]);
    assert(gate.ok, "gate");
    const subscriberGate = gate.value;

    const machineCtx: AuthenticatedContext = assignmentMachineContext({
      actor: "machine",
      principal: "machine:lophn-agent-assignments",
      credential_ref: "machine:lophn-agent-assignments",
      scope: {
        operations: ["RegisterDefaultPreset", "ListEvents"],
        targets: {},
      },
      conditions: {},
    });

    const deps = {
      clock,
      ids: {
        newId: () => "doc_01arz3ndektsv4rrffq69g5fav",
      },
      ports: [],
      registerBlobRef: () =>
        err<LophnError>({ code: "unavailable", message: "blob 없음" }),
      call: () =>
        err<LophnError>({ code: "unavailable", message: "dispatch 없음" }),
      subscriberGate,
      checkCredential: (ctx: AuthenticatedContext) => ok(ctx),
    };

    const seeded = await runCommand(
      connection,
      deps,
      [createPresetCommands(presetValidateDeps()).registerDefault],
      machineCtx,
      {
        command: "RegisterDefaultPreset",
        input: {
          id: PRESET,
          definition: presetDefinitionJson("app_engineer"),
          definition_hash: definitionHash(
            presetDefinitionJson("app_engineer") as Record<string, unknown>,
          ),
        },
        idempotency_key: "seed-preset",
        compare: {},
        prepared: [],
      },
    );
    assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));

    // AppCreated source event를 events 표에 직접 심는다(apps 등록 command는 core 경계다).
    connection.sql.run(
      "insert into events (type, subject, actor, payload, at) values (?, ?, ?, ?, ?)",
      [
        "AppCreated",
        APP,
        "user",
        JSON.stringify({
          slug: "usage",
          name: "Usage",
          description: "앱 한 개",
        }),
        NOW_TEXT,
      ],
    );
    const appSeq = String(
      connection.sql.get(
        "select seq from events where type = 'AppCreated' and subject = ?",
        [APP],
      )!["seq"],
    );

    // 실제 reaction engine이다(packages/lophn-agent/assignments/reaction.ts).
    const commands = createAssignmentCommands();
    const engine = assignmentEngine({
      backend: {
        read: (_ctx, scan) => {
          const rows = scan.inclusive && BigInt(scan.position) > 0n
            ? connection.sql.all(
              `select seq, type, subject, payload from events
               where seq >= ? order by seq asc limit ?`,
              [BigInt(scan.position), scan.limit ?? 256],
            )
            : connection.sql.all(
              `select seq, type, subject, payload from events
               where seq > ? order by seq asc limit ?`,
              [BigInt(scan.position), scan.limit ?? 256],
            );
          const head = connection.sql.get(
            "select coalesce(max(seq), 0) as seq from events",
            [],
          );
          return Promise.resolve(ok({
            events: (rows ?? []).map((row) => ({
              seq: String(row["seq"]),
              type: String(row["type"]),
              subject: row["subject"] === null ? null : String(row["subject"]),
              actor: "user",
              run: null,
              payload: JSON.parse(String(row["payload"])),
              at: NOW_TEXT,
            })),
            scanned_through_seq: String(head?.["seq"] ?? "0"),
            head_seq: String(head?.["seq"] ?? "0"),
          }));
        },
      },
      command: (ctx, envelope) =>
        runCommand(
          connection,
          deps,
          [
            commands.createAppEngineer,
            advanceSubscriberCursorCommand,
          ],
          ctx,
          envelope as never,
        ).then((result) => result as never),
      machine: machineCtx,
      // cursor는 기록된 subscriber cursor부터다(notifications의 cursor callback과
      // 같은 모양). compare는 이 기록과 같아야 conflict가 나지 않는다(R1).
      cursor: () => Promise.resolve(cursorOf()),
      preset: { preset: PRESET, preset_revision: 1 },
    });

    // cursor는 아직 없다.
    const cursorOf = () => {
      const row = connection.sql.get(
        "select cast(processed_through_seq as text) as s from subscriber_cursors where subscriber = ?",
        [ASSIGNMENT_SUBSCRIBER],
      );
      return row === undefined ? "0" : String(row["s"]);
    };
    assertEquals(cursorOf(), "0");

    // 반응 하나가 assignment·event·cursor를 같은 transaction에 확정한다(R1).
    // cursor는 아직 없으므로 engine은 "0"부터 읽는다. PresetCreated는 계기가
    // 아니라 cursor만 올리고, AppCreated에서 assignment를 같은 transaction에
    // 확정한다.
    const stepped = await engine.step();
    assert(stepped.ok, stepped.ok ? "" : JSON.stringify(stepped.error));
    assertEquals(stepped.value, appSeq);
    assertEquals(cursorOf(), appSeq);
    const rows = connection.sql.all(
      "select id, scope_id from assignments",
      [],
    );
    assertEquals(rows?.length, 1);
    assertEquals(
      String(rows![0]["id"]),
      `asg_${appSeq.padStart(26, "0").slice(-26)}`,
    );
    assertEquals(String(rows![0]["scope_id"]), APP);
    // 반응 event도 같은 transaction에 확정됐다.
    assert(
      connection.sql.get(
        "select seq from events where type = 'AssignmentCreated' and subject = ?",
        [`asg_${appSeq.padStart(26, "0").slice(-26)}`],
      ) !== undefined,
    );

    // engine처럼 같은 input을 다른 key로 다시 보내도 중복이 없다(R1).
    const direct = await runCommand(
      connection,
      deps,
      [commands.createAppEngineer],
      machineCtx,
      {
        command: "CreateAppEngineerAssignment",
        input: {
          id: `asg_${BigInt(appSeq).toString(10).padStart(26, "0").slice(-26)}`,
          app_created_seq: appSeq,
          app: APP,
          preset: PRESET,
          preset_revision: 1,
          processed_through_seq: appSeq,
          subscriber: ASSIGNMENT_SUBSCRIBER,
        },
        idempotency_key: "direct-rxn",
        compare: { processed_through_seq: appSeq },
        prepared: [],
      },
    );
    assert(direct.ok, direct.ok ? "" : JSON.stringify(direct.error));
    assertEquals(
      BigInt(String(
        connection.sql.get(
          "select count(*) as n from assignments",
          [],
        )?.["n"],
      )),
      1n,
    );

    // 같은 cursor부터 다시 읽어도 재전달에 중복이 없다(R1).
    const again = await assignmentEngine({
      backend: {
        read: () =>
          Promise.resolve(
            ok({
              events: [],
              scanned_through_seq: appSeq,
              head_seq: appSeq,
            }),
          ),
      },
      command: (ctx, envelope) =>
        runCommand(
          connection,
          deps,
          [commands.createAppEngineer, advanceSubscriberCursorCommand],
          ctx,
          envelope as never,
        )
          .then((result) => result as never),
      machine: machineCtx,
      cursor: () => Promise.resolve(cursorOf()),
      preset: { preset: PRESET, preset_revision: 1 },
    }).step();
    assert(again.ok, again.ok ? "" : JSON.stringify(again.error));
    const count = connection.sql.get(
      "select count(*) as n from assignments",
      [],
    );
    assertEquals(BigInt(String(count?.["n"])), 1n);

    connection.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
