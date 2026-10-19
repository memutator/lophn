// 플랫폼 제어 경로. activation commit 전 open은 거절한다.
import { SHUTDOWN_GRACE_MS } from "./limits.ts";
import {
  parseControlClose,
  parseControlOpen,
  parseControlProbe,
  parseControlShutdown,
} from "./wire.ts";
import type { RuntimeState } from "./state.ts";
import { readAppToolPort } from "../../invocations/context.ts";
import { ensureAppToolPort } from "./tool-port.ts";

type ControlResult =
  | { status: number; body: unknown }
  | { status: number; error: { code: string; message: string } };

function error(status: number, code: string, message: string): ControlResult {
  return { status, error: { code, message } };
}

// 보고의 `tools` 칸은 등록된 tool key다.
export function attestation(state: RuntimeState) {
  ensureAppToolPort();
  const port = readAppToolPort();
  return {
    release: state.identity.release,
    bundle_hash: state.identity.bundleHash,
    tools: port ? port.handlers().map((handler) => handler.tool) : [],
    data_schema: state.dataSchema,
    process_nonce: state.identity.processNonce,
    connection_ok: true as const,
  };
}

function appToolsMatchBlueprint(state: RuntimeState): boolean {
  const declared = state.blueprint.tools.map((tool) => tool.name).sort();
  const registered = [...attestation(state).tools].sort();
  return declared.length === registered.length &&
    declared.every((key, index) => key === registered[index]);
}

export function handleControl(
  state: RuntimeState,
  path: string,
  body: unknown,
): ControlResult {
  if (path.endsWith("/probe")) {
    const input = parseControlProbe(body);
    if (!input || input.process_nonce !== state.identity.processNonce) {
      return error(401, "unauthorized", "probe nonce mismatch");
    }
    if (!appToolsMatchBlueprint(state)) {
      return error(
        409,
        "conflict",
        "registered tool differ from the blueprint",
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
