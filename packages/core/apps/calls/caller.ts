import { err, ok, type Result } from "../../../base/mod.ts";
import type { AppApiCallInput } from "../../../protocol/apps/calls/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AgentRef, Place } from "../../../protocol/lophn-agent/places.ts";
import type { CallerDirectory } from "../ports.ts";
import type { Flight } from "./intake.ts";

export type CallAuth = { actor: "user" | "agent" | "app"; app?: Id<"app"> };

// 본문 주장 가운데 core가 직접 확인한 것만 남긴다.
export type VerifiedCaller =
  | { kind: "person" }
  | {
    kind: "agent";
    agent: AgentRef;
    place: Place | null;
    session: Id<"ses">;
    turn: Id<"trn">;
    toolCall: Id<"tcl">;
  }
  | { kind: "app"; app: Id<"app">; parent: Flight };

export type CallerChecks = {
  callers: CallerDirectory;
  activeRelease(app: Id<"app">): Result<Id<"rel"> | null>;
  flight(id: Id<"inv">): Flight | undefined;
};

const KIND_OF_ACTOR = { user: "person", agent: "agent", app: "app" } as const;

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

export function verifyCaller(
  input: AppApiCallInput,
  auth: CallAuth,
  checks: CallerChecks,
): Result<VerifiedCaller> {
  const caller = input.caller;
  if (KIND_OF_ACTOR[auth.actor] !== caller.kind) {
    return forbidden("caller kind does not match the credential");
  }
  if (caller.kind === "person") return ok({ kind: "person" });

  if (input.target.mode !== "live" || input.target.release !== null) {
    return err({
      code: "invalid_input",
      message: "agent and app calls target the live active release",
    });
  }

  if (caller.kind === "agent") {
    const found = checks.callers.agentToolCall(
      caller.session as Id<"ses">,
      caller.turn as Id<"trn">,
      caller.tool_call as Id<"tcl">,
    );
    if (!found.ok) return found;
    if (found.value === null) return forbidden("unknown tool call");
    return ok({
      kind: "agent",
      agent: found.value.agent,
      place: found.value.place,
      session: caller.session as Id<"ses">,
      turn: caller.turn as Id<"trn">,
      toolCall: caller.tool_call as Id<"tcl">,
    });
  }

  const app = caller.app as Id<"app">;
  if (auth.app !== app) return forbidden("app does not match the credential");
  const active = checks.activeRelease(app);
  if (!active.ok) return active;
  if (active.value !== caller.release) {
    return forbidden("release is not the active release");
  }
  const parent = caller.parent_invocation === null
    ? undefined
    : checks.flight(caller.parent_invocation as Id<"inv">);
  if (!parent || parent.app !== app || parent.release !== caller.release) {
    return forbidden("unknown parent invocation");
  }
  return ok({ kind: "app", app, parent });
}
