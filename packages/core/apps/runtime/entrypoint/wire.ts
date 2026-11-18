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

// protocol/remote/requester.ts와 같다.
type Requester =
  | { kind: "screen" }
  | { kind: "terminal" }
  | { kind: "agent"; agent: string; session: string | null; name: string }
  | { kind: "app"; app: string };

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
  | { kind: "program"; job: string; job_run: string }
  | { kind: "flow"; instance: string }
  | {
      kind: "event";
      publisher: string;
      event: string;
      publication: string;
      trace_id: string;
      chain: string[];
      parent_invocation: string | null;
      machine?: string;
    }
  | { kind: "remote"; machine: string; device: string; requester: Requester };

function requester(value: unknown): Requester | undefined {
  const source = record(value);
  if (!source) return;
  switch (source.kind) {
    case "screen":
    case "terminal":
      if (exact(source, ["kind"])) return;
      return { kind: source.kind };
    case "agent": {
      if (exact(source, ["kind", "agent", "session", "name"])) return;
      const agent = text(source.agent);
      const session =
        source.session === null ? null : id(source.session, "ses");
      const name = text(source.name);
      if (!agent || session === undefined || !name || name.length > 64) return;
      return { kind: "agent", agent, session, name };
    }
    case "app": {
      if (exact(source, ["kind", "app"])) return;
      const app = id(source.app, "app");
      return app ? { kind: "app", app } : undefined;
    }
    default:
      return;
  }
}

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
      const parent =
        source.parent_invocation === null
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
    case "flow": {
      if (exact(source, ["kind", "instance"])) return;
      const instance = id(source.instance, "wfi");
      return instance ? { kind: "flow", instance } : undefined;
    }
    case "event": {
      if (
        exact(
          source,
          [
            "kind",
            "publisher",
            "event",
            "publication",
            "trace_id",
            "chain",
            "parent_invocation",
            "machine",
          ],
          [
            "kind",
            "publisher",
            "event",
            "publication",
            "trace_id",
            "chain",
            "parent_invocation",
          ],
        )
      ) {
        return;
      }
      const machine =
        source.machine === undefined ? undefined : id(source.machine, "mch");
      const publisher =
        source.publisher === "lophn" ? "lophn" : id(source.publisher, "app");
      const event = text(source.event);
      const publication = id(source.publication, "pub");
      const trace = text(source.trace_id);
      const parent =
        source.parent_invocation === null
          ? null
          : id(source.parent_invocation, "inv");
      const chain = Array.isArray(source.chain)
        ? source.chain.map((item) => id(item, "app"))
        : undefined;
      if (
        chain === undefined ||
        chain.some((item) => item === undefined) ||
        !publisher ||
        !event ||
        !publication ||
        !trace ||
        !/^[0-9a-f]{32}$/.test(trace) ||
        parent === undefined ||
        (source.machine !== undefined && machine === undefined)
      ) {
        return;
      }
      return {
        kind: "event",
        publisher,
        event,
        publication,
        trace_id: trace,
        chain: chain as string[],
        parent_invocation: parent,
        ...(machine === undefined ? {} : { machine }),
      };
    }
    case "remote": {
      if (exact(source, ["kind", "machine", "device", "requester"])) return;
      const machine = id(source.machine, "mch");
      const device = id(source.device, "dev");
      const by = requester(source.requester);
      if (!machine || !device || !by) return;
      return { kind: "remote", machine, device, requester: by };
    }
    default:
      return;
  }
}

export type ProcessCall = {
  invocation: string;
  kind: "operation" | "command";
  name: string;
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
    !source ||
    exact(
      source,
      ["invocation", "kind", "name", "input", "context"],
      ["invocation", "kind", "name", "context"],
    )
  )
    return;
  const invocation = id(source.invocation, "inv");
  const name = appToolKey(source.name);
  const kind =
    source.kind === "operation" || source.kind === "command"
      ? source.kind
      : undefined;
  if (!invocation || !name || !kind) return;
  if (source.input !== undefined && !isJson(source.input)) return;
  const context = record(source.context);
  if (
    !context ||
    exact(context, ["app", "release", "mode", "effect", "caller"])
  )
    return;
  const app = id(context.app, "app");
  const release = context.release === null ? null : id(context.release, "rel");
  const mode =
    context.mode === "live" || context.mode === "preview"
      ? context.mode
      : undefined;
  const effect =
    context.effect === "read" ||
    context.effect === "write" ||
    context.effect === "external"
      ? context.effect
      : undefined;
  const from = context.caller === null ? null : caller(context.caller);
  if (!app || release === undefined || !mode || !effect || from === undefined)
    return;
  return {
    invocation,
    kind,
    name,
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
  )
    return;
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
