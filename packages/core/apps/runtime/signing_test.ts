import { assert, assertEquals } from "@std/assert";
import {
  signedConfirmProofSchema,
  signedConnectionSchema,
} from "../../../protocol/apps/mod.ts";
import { createCoreSigner } from "./signing.ts";
import { canonicalPayload, decodeVerifyKey } from "./entrypoint/signature.ts";
import { verifyConnection } from "./entrypoint/verify.ts";
import {
  APP,
  clockAt,
  connection,
  HASH,
  NONCE,
  REL,
} from "./entrypoint/testing.ts";

const proof = {
  invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
  process_nonce: NONCE,
  release: REL,
  command: "usage.purge",
  input_hash: HASH,
  caller: { kind: "direct" as const },
  expires_at: "2026-10-04T00:02:00.000Z",
};

Deno.test("apps/runtime#R11 apps/invocations#R8: core가 시작마다 만든 Ed25519 key의 서명은 앱이 공개 key로만 검증하고 다른 key와 바뀐 payload는 거절한다", async () => {
  const signer = await createCoreSigner();
  const other = await createCoreSigner();
  assert(signer.verifyKey !== other.verifyKey);
  const key = decodeVerifyKey(signer.verifyKey);
  assert(key);

  const envelope = await signer.signConfirmProof(proof);
  assert(signedConfirmProofSchema.safeParse(envelope).success);
  assertEquals(
    await key.verify(canonicalPayload(envelope.payload), envelope.signature),
    true,
  );
  assertEquals(
    await key.verify(
      canonicalPayload({ ...proof, command: "usage.save" }),
      envelope.signature,
    ),
    false,
  );
  const foreign = await other.signConfirmProof(proof);
  assertEquals(
    await key.verify(canonicalPayload(proof), foreign.signature),
    false,
  );
  // key 순서가 달라도 같은 payload는 같은 서명이다.
  const reordered = Object.fromEntries(Object.entries(proof).reverse());
  assertEquals(
    await key.verify(canonicalPayload(reordered), envelope.signature),
    true,
  );
});

Deno.test("apps/runtime#R11: core가 서명한 AppConnection을 앱이 검증하고 다른 key의 서명은 거절한다", async () => {
  const signer = await createCoreSigner();
  const other = await createCoreSigner();
  const key = decodeVerifyKey(signer.verifyKey);
  assert(key);
  const identity = {
    app: APP,
    release: REL,
    bundleHash: HASH,
    mode: "live" as const,
    processNonce: NONCE,
  };
  const signed = await signer.signConnection(connection() as never);
  assert(signedConnectionSchema.safeParse(signed).success);
  const accepted = await verifyConnection(
    key,
    JSON.stringify(signed),
    identity,
    clockAt(),
  );
  assertEquals(accepted.ok, true);
  const forged = await other.signConnection(connection() as never);
  const refused = await verifyConnection(
    key,
    JSON.stringify(forged),
    identity,
    clockAt(),
  );
  assertEquals(refused.ok, false);
});
