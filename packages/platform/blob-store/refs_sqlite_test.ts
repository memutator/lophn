// blob 참조 등록이 실제 ledger transaction에 같이 실리는지(platform/blob-store#R4).

import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { manualClock } from "../../base/mod.ts";
import { BLOB_PREPARATION_TTL_MS } from "../../contracts/platform/mod.ts";
import type {
  AuthenticatedContext,
  CommandDefinition,
  Sql,
} from "../../contracts/platform/mod.ts";
import {
  defineBlobField,
  defineCommand,
} from "../../contracts/platform/mod.ts";
import { applyMigrations } from "../backup-and-migration/mod.ts";
import { executeCommand } from "../ledger/executor.ts";
import { LEDGER_SCHEMA_STEPS } from "../ledger/schema.ts";
import { openConnection } from "../ledger/sqlite.ts";
import { createPreparationRegistry } from "./registry.ts";
import { createBlobRegistrar } from "./register.ts";

const HASH = "a".repeat(64);
const FIELD = defineBlobField({
  owner_kind: "document_version",
  field: "file",
  retention: { kind: "permanent" },
  general_read: true,
});

const attach = defineCommand({
  resource: "documents",
  method: "attach_blob",
  name: "AttachBlob",
  input: z.object({ owner_key: z.string() }),
  output: z.object({ hash: z.string() }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden"],
});

function ctx(): AuthenticatedContext {
  return {
    principal: "user-1",
    actor: "user",
    scope: { operations: ["AttachBlob"], targets: {} },
    conditions: {},
    credential_ref: "cred-1",
  };
}

Deno.test("platform/blob-store#R4: 영구 참조는 소유 변경과 같은 transaction에 등록되고 rollback되면 남지 않는다", async () => {
  const path = await Deno.makeTempFile({ suffix: ".db" });
  const clock = manualClock(Date.parse("2026-01-01T00:00:00.000Z"));
  const migrated = await applyMigrations(path, LEDGER_SCHEMA_STEPS, { clock });
  assert(migrated.ok);
  const opened = openConnection(path);
  assert(opened.ok);
  try {
    const preparations = createPreparationRegistry();
    preparations.register({
      preparation: "prep-1",
      principal: "user-1",
      purpose: "document_file",
      hash: HASH,
      size_bytes: 4,
    }, clock.nowMs());
    let current: { sql: Sql } | undefined;
    let calls = 0;
    const inputSeen = () => calls > 1;
    const register = (reference: unknown) => {
      const tx = current;
      if (!tx) {
        return {
          ok: false as const,
          error: { code: "unavailable" as const, message: "tx 없음" },
        };
      }
      return createBlobRegistrar({
        preparations,
        fields: [FIELD],
        nowMs: () =>
          clock.nowMs() + (inputSeen() ? BLOB_PREPARATION_TTL_MS : 0),
        current: () => ctx(),
      })(tx.sql, reference as never);
    };
    const commands = new Map<string, CommandDefinition>([[attach.name, {
      route: attach,
      handle(
        tx: {
          sql: Sql;
          emit(event: unknown, subject: string, payload: unknown): string;
        },
        _ctx: AuthenticatedContext,
        input: { owner_key: string },
      ) {
        calls += 1;
        const seq = tx.emit(
          { type: "BlobAttached", payload: z.object({ hash: z.string() }) },
          input.owner_key,
          { hash: HASH },
        );
        const registered = register({
          owner_kind: FIELD.owner_kind,
          owner_key: input.owner_key,
          field: FIELD.field,
          registered_seq: seq,
          source: {
            kind: "prepared",
            blob: {
              preparation: "prep-1",
              principal: "user-1",
              purpose: "document_file",
              hash: HASH,
              size_bytes: 4,
            },
          },
        });
        if (!registered.ok) return registered;
        return { ok: true as const, value: { hash: HASH } };
      },
    }]]);
    const done = await executeCommand(
      opened.value,
      {
        clock,
        ids: { newId: () => "evt_1" },
        ports: [],
        registerBlobRef: () => ({
          ok: false,
          error: { code: "unavailable", message: "미사용" },
        }),
        call: () => ({
          ok: false,
          error: { code: "unavailable", message: "미사용" },
        }),
        checkCredential: (current) => ({ ok: true, value: current }),
        onTx: (tx) => {
          current = tx;
        },
      },
      commands,
      ctx(),
      {
        command: attach.name,
        input: { owner_key: "document:ver_1" },
        idempotency_key: "attach-1",
        compare: {},
        prepared: [],
      },
    );
    assert(done.ok, JSON.stringify(done));
    const row = opened.value.sql.get(
      `select hash from blob_refs where owner_key = ?`,
      ["document:ver_1"],
    );
    assertEquals(row?.["hash"], HASH);

    // 등록이 거절되면 같은 transaction의 소유 변경도 남지 않는다.
    const rejected = await executeCommand(
      opened.value,
      {
        clock,
        ids: { newId: () => "evt_2" },
        ports: [],
        registerBlobRef: () => ({
          ok: false,
          error: { code: "unavailable", message: "미사용" },
        }),
        call: () => ({
          ok: false,
          error: { code: "unavailable", message: "미사용" },
        }),
        checkCredential: (current) => ({ ok: true, value: current }),
        onTx: (tx) => {
          current = tx;
        },
      },
      commands,
      ctx(),
      {
        command: attach.name,
        input: { owner_key: "document:ver_2" },
        idempotency_key: "attach-2",
        compare: {},
        prepared: [],
      },
    );
    assert(!rejected.ok);
    const gone = opened.value.sql.get(
      `select hash from blob_refs where owner_key = ?`,
      ["document:ver_2"],
    );
    assertEquals(gone, undefined);
    const events = opened.value.sql.get(
      `select count(*) as n from events where subject = ?`,
      ["document:ver_2"],
    );
    assertEquals(Number(events?.["n"]), 0);
  } finally {
    opened.value.close();
    await Deno.remove(path);
  }
});

void (null as unknown as Sql);
