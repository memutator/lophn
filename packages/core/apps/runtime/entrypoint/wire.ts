// control socket·시작 입력의 순수 검증. protocol/apps의 calls/process-wire와 channel-values의
// Zod schema와 같은 판정이어야 하고, 앱 프로세스는 Zod를 싣지 않는다.
import type { Json } from "./wire-check.ts";
import {
  appToolKey,
  BASE64,
  exact,
  id,
  isJson,
  record,
  text,
} from "./wire-check.ts";

export type { Json };
type RuntimeMode = "live" | "preview";
type InvocationEffect = "read" | "write" | "external";

// protocol/apps/calls/caller.ts와 같다.
type InvocationCaller =
  | { kind: "person"; view_session: string }
  | { kind: "agent"; session: string; turn: string; tool_call: string }
  | {
    kind: "app";
    app: string;
    release: string;
    parent_invocation: string | null;
  }
  | { kind: "program"; job: string; job_run: string };

function caller(value: unknown): InvocationCaller | undefined {
  const source = record(value);
  if (!source) return;
  switch (source.kind) {
    case "person": {
      if (exact(source, ["kind", "view_session"])) return;
      const view = text(source.view_session);
      return view ? { kind: "person", view_session: view } : undefined;
    }
    case "agent": {
      if (exact(source, ["kind", "session", "turn", "tool_call"])) return;
      const session = id(source.session, "ses");
      const turn = id(source.turn, "trn");
      const toolCall = id(source.tool_call, "tcl");
      if (!session || !turn || !toolCall) return;
      return { kind: "agent", session, turn, tool_call: toolCall };
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
    case "program": {
      if (exact(source, ["kind", "job", "job_run"])) return;
      const job = id(source.job, "job");
      const jobRun = id(source.job_run, "jbr");
      if (!job || !jobRun) return;
      return { kind: "program", job, job_run: jobRun };
    }
    default:
      return;
  }
}

export type ProcessCall = {
  invocation: string;
  tool: string;
  input?: Json;
  context: {
    app: string;
    release: string | null;
    mode: RuntimeMode;
    effect: InvocationEffect;
    caller: InvocationCaller | null;
  };
};

// processCallRequestSchema와 같다.
export function parseProcessCall(value: unknown): ProcessCall | undefined {
  const source = record(value);
  if (
    !source || exact(source, ["invocation", "tool", "input", "context"], [
      "invocation",
      "tool",
      "context",
    ])
  ) return;
  const invocation = id(source.invocation, "inv");
  const tool = appToolKey(source.tool);
  if (!invocation || !tool) return;
  if (source.input !== undefined && !isJson(source.input)) return;
  const context = record(source.context);
  if (
    !context ||
    exact(context, [
      "app",
      "release",
      "mode",
      "effect",
      "caller",
    ])
  ) return;
  const app = id(context.app, "app");
  const release = context.release === null ? null : id(context.release, "rel");
  const mode = context.mode === "live" || context.mode === "preview"
    ? context.mode
    : undefined;
  const effect = context.effect === "read" || context.effect === "write" ||
      context.effect === "external"
    ? context.effect
    : undefined;
  const from = context.caller === null ? null : caller(context.caller);
  if (
    !app || release === undefined || !mode ||
    !effect || from === undefined
  ) return;
  return {
    invocation,
    tool,
    ...(source.input === undefined ? {} : { input: source.input }),
    context: { app, release, mode, effect, caller: from },
  };
}

// processApplyRequestSchema와 같다.
export function parseProcessApply(
  value: unknown,
): { changesets: string[] } | undefined {
  const source = record(value);
  if (!source || exact(source, ["changesets"])) return;
  const list = source.changesets;
  if (
    !Array.isArray(list) ||
    !list.every((item) => typeof item === "string" && BASE64.test(item))
  ) return;
  return { changesets: list as string[] };
}

type ControlProbe = { process_nonce: string };
type ControlOpen = { process_nonce: string; release: string | null };
type ControlClose = { process_nonce: string; reason: string };
type ControlShutdown = { process_nonce: string; grace_ms: number };

export function parseControlProbe(value: unknown): ControlProbe | undefined {
  const source = record(value);
  if (!source || exact(source, ["process_nonce"])) return;
  const nonce = text(source.process_nonce);
  return nonce ? { process_nonce: nonce } : undefined;
}

export function parseControlOpen(value: unknown): ControlOpen | undefined {
  const source = record(value);
  if (!source || exact(source, ["process_nonce", "release"])) return;
  const nonce = text(source.process_nonce);
  // 준비 전 bundle의 preview에는 release가 없다. null은 live 자식의 release 검사에서 불일치로 거절된다.
  const release = source.release === null ? null : id(source.release, "rel");
  if (!nonce || release === undefined) return;
  return { process_nonce: nonce, release };
}

export function parseControlClose(value: unknown): ControlClose | undefined {
  const source = record(value);
  if (!source || exact(source, ["process_nonce", "reason"])) return;
  const nonce = text(source.process_nonce);
  if (!nonce || typeof source.reason !== "string" || source.reason === "") {
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
  const nonce = text(source.process_nonce);
  if (!nonce || source.grace_ms !== graceMs) return;
  return { process_nonce: nonce, grace_ms: graceMs };
}
