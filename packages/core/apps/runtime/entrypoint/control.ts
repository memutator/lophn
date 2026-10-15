// 플랫폼 제어 경로. activation commit 전 open은 거절한다.
import { SHUTDOWN_GRACE_MS } from "./limits.ts";
import {
  parseControlClose,
  parseControlOpen,
  parseControlProbe,
  parseControlShutdown,
  parseControlViewClosed,
} from "./wire.ts";
import { closeView, type RuntimeState } from "./state.ts";
import type { AppConnection } from "./wire.ts";
import { readSchedulePort } from "../../invocations/mod.ts";
import { ensureSchedulePort } from "./schedule.ts";

export type ControlResult =
  | { status: number; body: unknown }
  | { status: number; error: { code: string; message: string } };

function error(status: number, code: string, message: string): ControlResult {
  return { status, error: { code, message } };
}

export function attestation(state: RuntimeState) {
  ensureSchedulePort();
  const port = readSchedulePort();
  return {
    release: state.identity.release,
    bundle_hash: state.identity.bundleHash,
    commands: port ? port.handlers().map((handler) => handler.command) : [],
    data_schema: state.dataSchema,
    process_nonce: state.identity.processNonce,
    connection_ok: true as const,
  };
}

export function commandsMatchBlueprint(state: RuntimeState): boolean {
  const declared = state.blueprint.commands.map((command) => command.key)
    .sort();
  const registered = [...attestation(state).commands].sort();
  return declared.length === registered.length &&
    declared.every((key, index) => key === registered[index]);
}

export function handleControl(
  state: RuntimeState,
  path: string,
  body: unknown,
  connection: AppConnection,
): ControlResult {
  if (connection.actor !== "machine") {
    return error(403, "forbidden", "control accepts the platform connection");
  }
  if (path.endsWith("/probe")) {
    const input = parseControlProbe(body);
    if (!input || input.process_nonce !== state.identity.processNonce) {
      return error(401, "unauthorized", "probe nonce mismatch");
    }
    if (!commandsMatchBlueprint(state)) {
      return error(
        409,
        "conflict",
        "registered commands differ from the blueprint",
      );
    }
    state.ready = true;
    return { status: 200, body: attestation(state) };
  }
  if (path.endsWith("/open")) {
    const input = parseControlOpen(body);
    if (!input || input.process_nonce !== state.identity.processNonce) {
      return error(401, "unauthorized", "open nonce mismatch");
    }
    if (!state.ready) return error(409, "conflict", "open before ready");
    if (
      state.identity.mode === "live" && input.release !== state.identity.release
    ) {
      return error(409, "conflict", "open release mismatch");
    }
    state.accepting = true;
    return { status: 200, body: { accepting: true } };
  }
  if (path.endsWith("/close")) {
    const input = parseControlClose(body);
    if (!input || input.process_nonce !== state.identity.processNonce) {
      return error(401, "unauthorized", "close nonce mismatch");
    }
    state.accepting = false;
    state.closed = true;
    return { status: 200, body: { closed: true } };
  }
  if (path.endsWith("/view-closed")) {
    const input = parseControlViewClosed(body);
    if (!input || input.process_nonce !== state.identity.processNonce) {
      return error(401, "unauthorized", "view-closed nonce mismatch");
    }
    // 다시 알려도 같다. 앱의 협조 없이 이 session의 context 조회와 주석 쓰기가 닫힌다.
    closeView(state, input.view_session);
    return { status: 200, body: { closed: true } };
  }
  if (path.endsWith("/shutdown")) {
    const input = parseControlShutdown(body, SHUTDOWN_GRACE_MS);
    if (!input || input.process_nonce !== state.identity.processNonce) {
      return error(400, "invalid_input", "shutdown grace mismatch");
    }
    state.accepting = false;
    state.closed = true;
    return { status: 200, body: { accepted: true } };
  }
  return error(404, "not_found", "unknown control path");
}
