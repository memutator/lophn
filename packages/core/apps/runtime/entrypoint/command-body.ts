// invoke·cancel·status 본문의 순수 검증.
import type { Json, SignedConfirmProof, WireError } from "./wire.ts";
import { parseSignedConfirmProof } from "./wire.ts";
import { commandKey, exact, id, isJson, opaque, record } from "./wire-check.ts";

export type InvokeBody = {
  request_key: string;
  release?: string;
  command: string;
  input?: Json;
  proof?: SignedConfirmProof;
};

export type CommandReference = { request_key: string; invocation: string };

function fail(message: string): { ok: false; error: WireError } {
  return { ok: false, error: { message } };
}

export function parseInvokeBody(
  value: unknown,
): { ok: true; value: InvokeBody } | { ok: false; error: WireError } {
  const source = record(value);
  if (!source) return fail("invoke body must be an object");
  // 본문이 주장하는 actor·effect·caller는 연결의 값으로만 판단한다.
  delete source.actor;
  delete source.effect;
  delete source.caller;
  const unknown = exact(source, [
    "request_key",
    "release",
    "command",
    "input",
    "proof",
  ]);
  if (unknown) return fail(unknown);
  const requestKey = opaque(source.request_key, "opaque value");
  if (!requestKey) return fail("request_key is invalid");
  if (source.release !== undefined && !id(source.release, "rel")) {
    return fail("release is invalid");
  }
  const command = commandKey(source.command);
  if (!command) return fail("command is invalid");
  if (source.input !== undefined && !isJson(source.input)) {
    return fail("input is not JSON");
  }
  const proof = source.proof === undefined
    ? undefined
    : parseSignedConfirmProof(source.proof);
  if (source.proof !== undefined && !proof) return fail("proof is invalid");
  return {
    ok: true,
    value: {
      request_key: requestKey,
      ...(source.release === undefined
        ? {}
        : { release: source.release as string }),
      command,
      ...(source.input === undefined ? {} : { input: source.input as Json }),
      ...(proof ? { proof } : {}),
    },
  };
}

export function parseCommandReference(
  value: unknown,
): CommandReference | undefined {
  const source = record(value);
  if (!source || exact(source, ["request_key", "invocation"])) return;
  const requestKey = opaque(source.request_key, "opaque value");
  const invocation = id(source.invocation, "inv");
  if (!requestKey || !invocation) return;
  return { request_key: requestKey, invocation };
}
