// direct socket·시작 입력의 순수 검증. contracts Zod schema와 같은 판정이어야 하고,
// 앱 프로세스는 Zod를 싣지 않는다. 대표 사례 대조는 wire_test.ts가 한다.

import type { Json, WireError } from "./wire-check.ts";

export type { Json, WireError };
export type RuntimeMode = "live" | "preview" | "test";
export type ScreenSize = "full" | "panel" | "card";

import {
  AT,
  commandKey,
  exact,
  id,
  opaque,
  record,
  screenKey,
  SHA,
  stringList,
  text,
  unique,
} from "./wire-check.ts";

const SCREEN_SIZES = new Set<ScreenSize>(["full", "panel", "card"]);

function screenSizes(
  value: unknown,
  screens: readonly string[],
): Record<string, ScreenSize[]> | undefined {
  const source = record(value);
  if (!source) return;
  const output: Record<string, ScreenSize[]> = {};
  for (const key of Object.keys(source)) {
    if (!screenKey(key) || !screens.includes(key)) return;
    const sizes = source[key];
    if (
      !Array.isArray(sizes) || sizes.length === 0 ||
      !sizes.every((size) =>
        typeof size === "string" && SCREEN_SIZES.has(size as ScreenSize)
      ) || !unique(sizes as string[])
    ) return;
    output[key] = sizes as ScreenSize[];
  }
  return output;
}

export type CallOrigin =
  | {
    kind: "app";
    app: string;
    release: string;
    process_nonce: string;
    grant: string;
    parent_invocation: string | null;
    path: string[];
  }
  | { kind: "agent"; run: string; tool_call: string };

function callOrigin(value: unknown): CallOrigin | undefined {
  const source = record(value);
  if (!source) return;
  if (source.kind === "agent") {
    if (exact(source, ["kind", "run", "tool_call"])) return;
    const run = id(source.run, "run");
    const toolCall = id(source.tool_call, "tcl");
    if (!run || !toolCall) return;
    return { kind: "agent", run, tool_call: toolCall };
  }
  if (source.kind !== "app") return;
  if (
    exact(source, [
      "kind",
      "app",
      "release",
      "process_nonce",
      "grant",
      "parent_invocation",
      "path",
    ])
  ) return;
  const app = id(source.app, "app");
  const release = id(source.release, "rel");
  const nonce = text(source.process_nonce, "process nonce");
  const grant = id(source.grant, "grt");
  const parent = source.parent_invocation === null
    ? null
    : id(source.parent_invocation, "inv");
  const path = stringList(source.path, (entry) => id(entry, "app"));
  if (
    !app || !release || !nonce || !grant || parent === undefined || !path ||
    path.length > 7 || (path.length > 0 && path.at(-1) !== app)
  ) return;
  return {
    kind: "app",
    app,
    release,
    process_nonce: nonce,
    grant,
    parent_invocation: parent,
    path,
  };
}

export type InvocationCaller =
  | { kind: "direct" }
  | { kind: "automation"; key: string }
  | {
    kind: "app";
    app: string;
    release: string;
    parent_invocation: string | null;
  }
  | { kind: "agent"; run: string; tool_call: string }
  | { kind: "system" };

function invocationCaller(value: unknown): InvocationCaller | undefined {
  const source = record(value);
  if (!source || typeof source.kind !== "string") return;
  switch (source.kind) {
    case "direct":
      return exact(source, ["kind"]) ? undefined : { kind: "direct" };
    case "system":
      return exact(source, ["kind"]) ? undefined : { kind: "system" };
    case "automation": {
      if (exact(source, ["kind", "key"])) return;
      const key = commandKey(source.key);
      return key ? { kind: "automation", key } : undefined;
    }
    case "app": {
      if (exact(source, ["kind", "app", "release", "parent_invocation"])) {
        return;
      }
      const app = id(source.app, "app");
      const release = id(source.release, "rel");
      const parent = source.parent_invocation === null
        ? null
        : id(source.parent_invocation, "inv");
      if (!app || !release || parent === undefined) return;
      return { kind: "app", app, release, parent_invocation: parent };
    }
    case "agent": {
      if (exact(source, ["kind", "run", "tool_call"])) return;
      const run = id(source.run, "run");
      const toolCall = id(source.tool_call, "tcl");
      if (!run || !toolCall) return;
      return { kind: "agent", run, tool_call: toolCall };
    }
    default:
      return;
  }
}

export type AppConnection = {
  app: string;
  release: string | null;
  bundle_hash: string;
  mode: "live" | "preview" | "test";
  process_nonce: string;
  actor: string;
  credential_ref: string;
  screens: string[];
  screen_sizes: Record<string, ScreenSize[]>;
  caller: CallOrigin | null;
  commands: string[];
  expires_at: string | null;
};

const ACTOR =
  /^(?:user|machine|coding_agent:cac_[0-7][0-9a-hjkmnp-tv-z]{25}|agent:asg_[0-7][0-9a-hjkmnp-tv-z]{25}|app:app_[0-7][0-9a-hjkmnp-tv-z]{25})$/;

export function parseAppConnection(value: unknown): AppConnection | undefined {
  const source = record(value);
  if (!source) return;
  if (
    exact(source, [
      "app",
      "release",
      "bundle_hash",
      "mode",
      "process_nonce",
      "actor",
      "credential_ref",
      "screens",
      "screen_sizes",
      "caller",
      "commands",
      "expires_at",
    ])
  ) return;
  const app = id(source.app, "app");
  const release = source.release === null ? null : id(source.release, "rel");
  const bundle =
    typeof source.bundle_hash === "string" && SHA.test(source.bundle_hash)
      ? source.bundle_hash
      : undefined;
  const mode = source.mode === "live" || source.mode === "preview" ||
      source.mode === "test"
    ? source.mode
    : undefined;
  const nonce = text(source.process_nonce, "process nonce");
  const actor = typeof source.actor === "string" && ACTOR.test(source.actor)
    ? source.actor
    : undefined;
  const credential = opaque(source.credential_ref, "opaque value");
  const screens = stringList(source.screens, screenKey);
  const commands = stringList(source.commands, commandKey);
  const expires = source.expires_at === null
    ? null
    : typeof source.expires_at === "string" && AT.test(source.expires_at)
    ? source.expires_at
    : undefined;
  const caller = source.caller === null ? null : callOrigin(source.caller);
  if (
    !app || release === undefined || !bundle || !mode || !nonce || !actor ||
    !credential || !screens || !commands || expires === undefined ||
    caller === undefined || (mode === "live" && release === null)
  ) return;
  const sizes = screenSizes(source.screen_sizes, screens);
  if (!sizes) return;
  return {
    app,
    release,
    bundle_hash: bundle,
    mode,
    process_nonce: nonce,
    actor,
    credential_ref: credential,
    screens,
    screen_sizes: sizes,
    caller,
    commands,
    expires_at: expires,
  };
}

export type ConfirmProof = {
  invocation: string;
  process_nonce: string;
  release: string;
  command: string;
  input_hash: string;
  caller: InvocationCaller;
  expires_at: string;
};

export function parseConfirmProof(value: unknown): ConfirmProof | undefined {
  const source = record(value);
  if (!source) return;
  if (
    exact(source, [
      "invocation",
      "process_nonce",
      "release",
      "command",
      "input_hash",
      "caller",
      "expires_at",
    ])
  ) return;
  const invocation = id(source.invocation, "inv");
  const nonce = text(source.process_nonce, "process nonce");
  const release = id(source.release, "rel");
  const command = commandKey(source.command);
  const hash =
    typeof source.input_hash === "string" && SHA.test(source.input_hash)
      ? source.input_hash
      : undefined;
  const caller = invocationCaller(source.caller);
  const expires =
    typeof source.expires_at === "string" && AT.test(source.expires_at)
      ? source.expires_at
      : undefined;
  if (
    !invocation || !nonce || !release || !command || !hash || !caller ||
    !expires
  ) {
    return;
  }
  return {
    invocation,
    process_nonce: nonce,
    release,
    command,
    input_hash: hash,
    caller,
    expires_at: expires,
  };
}

export function parseScreenPath(
  pathname: string,
): { screen: string; path: string } | undefined {
  if (!pathname.startsWith("/screens/")) return;
  const rest = pathname.slice("/screens/".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return;
  const screen = decodeURIComponent(rest.slice(0, slash));
  const path = rest.slice(slash + 1).split("/").map(decodeURIComponent).join(
    "/",
  );
  if (!screenKey(screen) || !screenAssetPath(path)) return;
  return { screen, path };
}

export function screenAssetPath(value: string): boolean {
  return value.length > 0 && !value.includes("\\") &&
    !value.split("/").includes("..") && !value.includes(":") &&
    !value.startsWith("//");
}

export type ControlProbe = { process_nonce: string };
export type ControlOpen = { process_nonce: string; release: string };
export type ControlClose = { process_nonce: string; reason: string };
export type ControlShutdown = { process_nonce: string; grace_ms: number };

function controlNonce(source: Record<string, unknown>): string | undefined {
  return text(source.process_nonce, "process nonce");
}

export function parseControlProbe(value: unknown): ControlProbe | undefined {
  const source = record(value);
  if (!source || exact(source, ["process_nonce"])) return;
  const nonce = controlNonce(source);
  return nonce ? { process_nonce: nonce } : undefined;
}

export function parseControlOpen(value: unknown): ControlOpen | undefined {
  const source = record(value);
  if (!source || exact(source, ["process_nonce", "release"])) return;
  const nonce = controlNonce(source);
  const release = id(source.release, "rel");
  if (!nonce || !release) return;
  return { process_nonce: nonce, release };
}

export function parseControlClose(value: unknown): ControlClose | undefined {
  const source = record(value);
  if (!source || exact(source, ["process_nonce", "reason"])) return;
  const nonce = controlNonce(source);
  if (
    !nonce || typeof source.reason !== "string" || source.reason.length === 0
  ) {
    return;
  }
  return { process_nonce: nonce, reason: source.reason };
}

export function parseControlShutdown(
  value: unknown,
  graceMs: number,
): ControlShutdown | undefined {
  const source = record(value);
  if (!source || exact(source, ["process_nonce", "grace_ms"])) return;
  const nonce = controlNonce(source);
  if (!nonce || source.grace_ms !== graceMs) return;
  return { process_nonce: nonce, grace_ms: graceMs };
}

export type ScreenQuery = { size: ScreenSize; view_session: string };

export function parseScreenQuery(
  params: URLSearchParams,
): ScreenQuery | undefined {
  const size = params.get("size");
  const view = params.get("view_session");
  if (
    !size || !SCREEN_SIZES.has(size as ScreenSize) || !view ||
    !opaque(view, "opaque value")
  ) {
    return;
  }
  return { size: size as ScreenSize, view_session: view };
}

export function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
