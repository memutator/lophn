import assert from "node:assert/strict";
import { test } from "node:test";
import { ok, sha256Hex } from "../../../base/mod.ts";
import {
  createKnownSecretRegistry,
  REDACTION_REPLACEMENT,
} from "../../../base/redaction/mod.ts";
import { recordMessage } from "../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { CommandEnvelope } from "../../storage/ledger/mod.ts";
import { createMessageBodyPreparer } from "./message-body.ts";

// provider가 준 글에 섞여 온 credential과 알려진 secret 값이다. 둘 다 저장 전에 가려져야 한다.
const PATTERN_SECRET = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
const KNOWN_SECRET = "known-secret-value-9f3d";

test("저장하는 reasoning 글은 redaction을 거친다", async () => {
  const preparedBodies: string[] = [];
  const registry = createKnownSecretRegistry();
  registry.register([KNOWN_SECRET]);
  const prepare = createMessageBodyPreparer({
    relay: () => ({
      live: () => false,
      async prepare(call) {
        const bytes = new Uint8Array(
          await new Response(call.bytes).arrayBuffer(),
        );
        preparedBodies.push(new TextDecoder().decode(bytes));
        return ok({
          preparation: "prep-1",
          principal: call.principal,
          purpose: call.purpose,
          hash: await sha256Hex(bytes),
          size_bytes: bytes.length,
        });
      },
    }),
    known: () => ({
      ready: true,
      match: (text) => registry.match(text),
      prefixFrom: (text) => registry.prefixFrom(text),
    }),
  });
  const context: AuthenticatedContext = {
    principal: "machine:reasoning-core",
    actor: "machine",
    scope: { operations: [], targets: {} },
    conditions: {},
    credential_ref: "machine:reasoning-core",
  };
  const envelope: CommandEnvelope = {
    command: recordMessage.name,
    input: {
      id: "msg_0aaaaaaaaaaaaaaaaaaaaaaaaa",
      session: "ses_0aaaaaaaaaaaaaaaaaaaaaaaaa",
      turn: "trn_0aaaaaaaaaaaaaaaaaaaaaaaaa",
      content: {
        schema_version: 1,
        parts: [
          {
            kind: "reasoning",
            text: `I checked ${PATTERN_SECRET} and ${KNOWN_SECRET}.`,
            duration_ms: 1200,
          },
          { kind: "text", text: "Done." },
        ],
      },
    },
    idempotency_key: "idk-1",
    compare: {},
    prepared: [],
  };

  const prepared = await prepare(context, envelope);
  assert.ok(prepared.ok);
  const content = (prepared.value.input as {
    content: { parts: { kind: string; text: string; duration_ms?: unknown }[] };
  }).content;
  assert.deepStrictEqual(content.parts.length, 2);
  const reasoning = content.parts[0];
  assert.deepStrictEqual(reasoning.kind, "reasoning");
  assert.deepStrictEqual(reasoning.duration_ms, 1200);
  assert.ok(reasoning.text.includes(REDACTION_REPLACEMENT));
  assert.ok(!reasoning.text.includes(PATTERN_SECRET));
  assert.ok(!reasoning.text.includes(KNOWN_SECRET));
  assert.deepStrictEqual(content.parts[1], { kind: "text", text: "Done." });
  // 준비 통로로 간 bytes에도 두 값이 없다. blob에는 redaction한 글만 들어간다.
  assert.deepStrictEqual(preparedBodies.length, 1);
  assert.ok(!preparedBodies[0].includes(PATTERN_SECRET));
  assert.ok(!preparedBodies[0].includes(KNOWN_SECRET));
});
