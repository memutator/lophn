import { manualClock, sha256Hex } from "@lophn/base";
import { canonicalPayload } from "./signature.ts";
import { type Blueprint, validateBlueprint } from "../../blueprint/mod.ts";
import type { RegisteredHandler } from "../../invocations/mod.ts";
import { ensureSchedulePort } from "./schedule.ts";

export const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
export const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
export const HASH = "ab".repeat(32);
export const NONCE = "nonce-1";
export const AT = "2026-10-04T00:00:00.000Z";

export function clockAt(at = AT) {
  return manualClock(Date.parse(at));
}

function command(
  key: string,
  effect: "read" | "write" | "external",
  extra: Record<string, unknown> = {},
) {
  return {
    key,
    label: key,
    description: `${key} purpose`,
    effect,
    confirm: false,
    input: null,
    revert: effect === "write"
      ? { supported: true, command: "undo" }
      : { supported: false },
    ...extra,
  };
}

export function blueprint(): Blueprint {
  const parsed = validateBlueprint({
    name: "Usage",
    description: "Reads usage",
    screens: [{
      key: "usage",
      label: "Usage",
      path: "/usage",
      sizes: ["full", "panel"],
    }],
    commands: [
      command("undo", "write", { revert: { supported: false } }),
      command("usage.read", "read", {
        input: {
          type: "object",
          properties: { limit: { type: "integer", default: 10, minimum: 1 } },
          additionalProperties: false,
        },
      }),
      command("usage.save", "write"),
      command("usage.batch", "write"),
    ],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

// 테스트 서명은 sha256 64hex를 base64url 자리(86)로 맞춘다.
// 실제 Ed25519 검증은 decodeVerifyKey가 하고, 테스트는 shaKey를 주입한다.
export async function sign(payload: unknown): Promise<string> {
  const digest = await sha256Hex(canonicalPayload(payload));
  return JSON.stringify({
    payload,
    signature: digest + "A".repeat(22),
  });
}

export function shaKey() {
  return {
    verify: async (payload: string, signature: string) =>
      signature === (await sha256Hex(payload)) + "A".repeat(22),
  };
}

export function connection(overrides: Record<string, unknown> = {}) {
  return {
    app: APP,
    release: REL,
    bundle_hash: HASH,
    mode: "live",
    process_nonce: NONCE,
    actor: "user",
    credential_ref: "cred-1",
    screens: ["usage"],
    screen_sizes: { usage: ["full", "panel"] },
    caller: null,
    commands: ["usage.read", "usage.save", "usage.batch"],
    expires_at: "2026-10-04T00:01:00.000Z",
    ...overrides,
  };
}

// 테스트가 SDK package를 import하지 않고 같은 port 심볼에 handler를 올린다.
// port 자체는 cap-schedule module load가 설치한다.
export function installHandlers(handlers: RegisteredHandler[]): {
  current: () => unknown;
} {
  const port = ensureSchedulePort();
  const known = new Set(port.handlers().map((handler) => handler.command));
  for (const handler of handlers) {
    if (!known.has(handler.command)) port.register(handler);
  }
  return { current: () => port.current() };
}

export const VERIFY_KEY = "A".repeat(43);

export function startLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: APP,
    release: REL,
    bundle_hash: HASH,
    mode: "live",
    process_nonce: NONCE,
    broker_socket: "/tmp/b.sock",
    direct_socket: "/tmp/a.sock",
    data_path: "/tmp/data",
    broker_credential: "child-cred",
    verify_key: VERIFY_KEY,
    ...overrides,
  }) + "\n";
}
