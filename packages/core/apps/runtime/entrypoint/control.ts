// 플랫폼 제어 경로. activation commit 전 open은 거절한다.
import { SHUTDOWN_GRACE_MS } from "./limits.ts";
import {
  parseControlClose,
  parseControlOpen,
  parseControlProbe,
  parseControlShutdown,
} from "./wire.ts";
import type { RuntimeState } from "./state.ts";
import {
  handlerNames,
  requiredHandlerNames,
} from "../../../../protocol/apps/declaration/mod.ts";
import { readAppToolPort } from "../../invocations/context.ts";
import { ensureAppToolPort } from "./tool-port.ts";

type ControlResult =
  | { status: number; body: unknown }
  | { status: number; error: { code: string; message: string } };

function error(status: number, code: string, message: string): ControlResult {
  return { status, error: { code, message } };
}

// 보고의 `tools` 칸은 등록된 handler 이름이다(operation과 command를 합친다).
export function attestation(state: RuntimeState) {
  ensureAppToolPort();
  const port = readAppToolPort();
  return {
    release: state.identity.release,
    bundle_hash: state.identity.bundleHash,
    tools: port ? port.handlers().map((handler) => handler.name) : [],
    data_schema: state.dataSchema,
    process_nonce: state.identity.processNonce,
    connection_ok: true as const,
  };
}

// 이름 5개와 "and N more". 앱 process가 preview 쪽을 import하지 않아 launcher의 같은 규칙을 여기 둔다.
function listed(names: readonly string[]): string {
  const head = names.slice(0, 5).join(", ");
  return names.length > 5 ? `${head} and ${names.length - 5} more` : head;
}

// 선언과 등록된 handler의 차이. 둘 다 비면 맞는 것이다.
function handlerMismatch(state: RuntimeState): string {
  // 구독 handler는 등록하지 않아도 된다(화면만 구독하는 앱). 등록했으면 선언한 구독이어야 한다.
  const required = requiredHandlerNames(state.declaration);
  const allowed = handlerNames(state.declaration);
  const registered = attestation(state).tools;
  const missing = required.filter((name) => !registered.includes(name));
  const extra = registered.filter((name) => !allowed.includes(name));
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`declared without a handler: ${listed(missing)}`);
  }
  if (extra.length > 0) parts.push(`handler not declared: ${listed(extra)}`);
  return parts.join("; ");
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
    const mismatch = handlerMismatch(state);
    if (mismatch !== "") return error(409, "conflict", mismatch);
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
      state.identity.mode === "live" &&
      input.release !== state.identity.release
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
