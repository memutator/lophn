// 매 direct 요청의 로컬 검증. 본문 actor·effect·caller 주장은 권한 근거가 아니다.
import type { Clock } from "@lophn/base";
import { canonicalInputHash, validateInput } from "../../blueprint/mod.ts";
import type { Blueprint, CommandDeclaration } from "../../blueprint/mod.ts";
import { canonicalPayload, type VerifyKey, verifySigned } from "./signature.ts";
import {
  type AppConnection,
  type ConfirmProof,
  type InvocationCaller,
  parseAppConnection,
  parseConfirmProof,
  type SignedConfirmProof,
} from "./wire.ts";

export type ProcessIdentity = {
  app: string;
  release: string | null;
  bundleHash: string;
  mode: "live" | "preview" | "test";
  processNonce: string;
};

export type VerifiedCall = {
  connection: AppConnection;
  command: CommandDeclaration;
  input: unknown;
  inputHash: string;
  caller: InvocationCaller;
  proof?: ConfirmProof;
};

export type Rejection = {
  code:
    | "unauthorized"
    | "forbidden"
    | "invalid_input"
    | "conflict"
    | "unavailable";
  message: string;
  // 호출한 쪽이 다음 단계를 알 수 있는 안전한 사실. confirm 필요 여부만 싣는다.
  details?: Record<string, unknown>;
};

function reject(
  code: Rejection["code"],
  message: string,
  details?: Rejection["details"],
): Rejection {
  return { code, message, ...(details ? { details } : {}) };
}

export async function verifyConnection(
  key: VerifyKey,
  authorization: string | null,
  identity: ProcessIdentity,
  clock: Clock,
): Promise<
  { ok: true; connection: AppConnection } | { ok: false; error: Rejection }
> {
  if (!authorization) {
    return {
      ok: false,
      error: reject("unauthorized", "missing authorization"),
    };
  }
  let signed: { payload: unknown; signature: string };
  try {
    signed = JSON.parse(authorization) as {
      payload: unknown;
      signature: string;
    };
  } catch {
    return {
      ok: false,
      error: reject("unauthorized", "authorization is not signed JSON"),
    };
  }
  if (!signed || typeof signed.signature !== "string") {
    return {
      ok: false,
      error: reject("unauthorized", "authorization is not signed"),
    };
  }
  const connection = parseAppConnection(signed.payload);
  if (!connection) {
    return {
      ok: false,
      error: reject("unauthorized", "connection is invalid"),
    };
  }
  const authentic = await verifySigned(key, {
    payload: signed.payload,
    signature: signed.signature,
  }, () => canonicalPayload(signed.payload));
  if (!authentic) {
    return { ok: false, error: reject("unauthorized", "signature mismatch") };
  }
  if (connection.process_nonce !== identity.processNonce) {
    return {
      ok: false,
      error: reject("unauthorized", "process nonce mismatch"),
    };
  }
  if (connection.app !== identity.app) {
    return { ok: false, error: reject("unauthorized", "app mismatch") };
  }
  if (connection.bundle_hash !== identity.bundleHash) {
    return { ok: false, error: reject("conflict", "bundle mismatch") };
  }
  if (connection.release !== identity.release) {
    return { ok: false, error: reject("conflict", "release mismatch") };
  }
  if (connection.mode !== identity.mode) {
    return { ok: false, error: reject("conflict", "mode mismatch") };
  }
  if (connection.expires_at !== null && connection.expires_at <= clock.now()) {
    return { ok: false, error: reject("unauthorized", "connection expired") };
  }
  return { ok: true, connection };
}

export function projectCaller(connection: AppConnection): InvocationCaller {
  if (connection.caller === null) return { kind: "direct" };
  if (connection.caller.kind === "agent") {
    return {
      kind: "agent",
      run: connection.caller.run,
      tool_call: connection.caller.tool_call,
    };
  }
  return {
    kind: "app",
    app: connection.caller.app,
    release: connection.caller.release,
    parent_invocation: connection.caller.parent_invocation,
  };
}

export async function verifyCommandCall(deps: {
  blueprint: Blueprint;
  connection: AppConnection;
  identity: ProcessIdentity;
  command: string;
  input: unknown;
  proof: SignedConfirmProof | undefined;
  key: VerifyKey;
  clock: Clock;
  accepting: boolean;
}): Promise<
  { ok: true; value: VerifiedCall } | { ok: false; error: Rejection }
> {
  const declared = deps.blueprint.commands.find((command) =>
    command.key === deps.command
  );
  if (!declared) {
    return {
      ok: false,
      error: reject("invalid_input", "command is not declared"),
    };
  }
  if (!deps.connection.commands.includes(deps.command)) {
    return {
      ok: false,
      error: reject("forbidden", "command is outside the connection"),
    };
  }
  if (
    !deps.accepting &&
    (declared.effect === "write" || declared.effect === "external")
  ) {
    return {
      ok: false,
      error: reject("unavailable", "writes are closed until open"),
    };
  }
  // 생략된 입력은 선언 default로 채운 빈 객체에서 시작한다.
  const supplied = deps.input === undefined && declared.input?.type === "object"
    ? {}
    : deps.input;
  const validated = validateInput(declared.input, supplied);
  if (!validated.ok) {
    return {
      ok: false,
      error: reject("invalid_input", validated.error.message),
    };
  }
  const hashed = await canonicalInputHash(declared.input, supplied);
  if (!hashed.ok) {
    return { ok: false, error: reject("invalid_input", hashed.error.message) };
  }
  const caller = projectCaller(deps.connection);
  if (declared.confirm && deps.identity.mode === "preview") {
    // preview에는 사람의 approval도 proof도 없다. confirm 명령의 실제 handler는 proof가 있어도
    // 돌리지 않고, 대역 확인의 성공을 실행 성공으로 보이지 않는다.
    return {
      ok: false,
      error: reject("forbidden", "confirm commands are not run in preview"),
    };
  }
  if (declared.confirm) {
    const checked = await verifyProof({
      proof: deps.proof,
      key: deps.key,
      identity: deps.identity,
      command: deps.command,
      inputHash: hashed.value,
      caller,
      clock: deps.clock,
    });
    if (!checked.ok) return checked;
    return {
      ok: true,
      value: {
        connection: deps.connection,
        command: declared,
        input: validated.value,
        inputHash: hashed.value,
        caller,
        proof: checked.value,
      },
    };
  }
  if (deps.proof) {
    return { ok: false, error: reject("invalid_input", "proof is not used") };
  }
  return {
    ok: true,
    value: {
      connection: deps.connection,
      command: declared,
      input: validated.value,
      inputHash: hashed.value,
      caller,
    },
  };
}

async function verifyProof(deps: {
  proof: SignedConfirmProof | undefined;
  key: VerifyKey;
  identity: ProcessIdentity;
  command: string;
  inputHash: string;
  caller: InvocationCaller;
  clock: Clock;
}): Promise<
  { ok: true; value: ConfirmProof } | { ok: false; error: Rejection }
> {
  if (!deps.proof) {
    return {
      ok: false,
      error: reject("forbidden", "confirm command needs a proof", {
        confirm_required: true,
      }),
    };
  }
  // 서명은 core가 한 번 접수한 진술이라는 근거다. 위조·변조는 다른 검사보다 먼저 거절한다.
  const authentic = await verifySigned(
    deps.key,
    deps.proof,
    (payload) => canonicalPayload(payload),
  );
  if (!authentic) {
    return {
      ok: false,
      error: reject("unauthorized", "proof signature mismatch"),
    };
  }
  const parsed = parseConfirmProof(deps.proof.payload);
  if (!parsed) {
    return { ok: false, error: reject("unauthorized", "proof is invalid") };
  }
  if (parsed.process_nonce !== deps.identity.processNonce) {
    return { ok: false, error: reject("conflict", "proof process mismatch") };
  }
  if (
    parsed.release !== deps.identity.release || parsed.command !== deps.command
  ) {
    return { ok: false, error: reject("conflict", "proof target mismatch") };
  }
  if (parsed.input_hash !== deps.inputHash) {
    return { ok: false, error: reject("conflict", "proof input mismatch") };
  }
  if (JSON.stringify(parsed.caller) !== JSON.stringify(deps.caller)) {
    return { ok: false, error: reject("forbidden", "proof caller mismatch") };
  }
  if (parsed.expires_at <= deps.clock.now()) {
    return { ok: false, error: reject("unauthorized", "proof expired") };
  }
  return { ok: true, value: parsed };
}

export function verifyScreen(deps: {
  connection: AppConnection;
  screen: string;
  size: "full" | "panel" | "card";
  blueprint: Blueprint;
}): Rejection | undefined {
  if (!deps.connection.screens.includes(deps.screen)) {
    return reject("forbidden", "screen is outside the connection");
  }
  const declared = deps.blueprint.screens.find((screen) =>
    screen.key === deps.screen
  );
  if (!declared || !declared.sizes.includes(deps.size)) {
    return reject("invalid_input", "screen size is not declared");
  }
  const allowed = deps.connection.screen_sizes[deps.screen];
  if (allowed && !allowed.includes(deps.size)) {
    return reject("forbidden", "screen size is outside the connection");
  }
  return;
}
