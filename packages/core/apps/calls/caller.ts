import { err, ok, type Result } from "../../../base/mod.ts";
import type { ToolCallInput } from "../../../protocol/apps/calls/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AgentId, Place } from "../../../protocol/lophn-agent/places.ts";
import type { CallerDirectory } from "../ports.ts";
import type { Flight } from "./intake.ts";

// previewOnly는 route 입력이 아니라 core 안 호출자만 켠다(preview로만 가는 credential).
export type CallAuth = {
  actor: "user" | "agent" | "app" | "program" | "flow";
  app?: Id<"app">;
  // actor가 program일 때만 있다. route는 이 자격을 만들지 못하고 core 안 run 연산만 만든다.
  program?: {
    job: Id<"job">;
    job_run: Id<"jbr">;
  };
  // actor가 flow일 때만 있다. program과 같이 route는 만들지 못하고 core 안 run 연산만 만든다.
  flow?: {
    instance: Id<"wfi">;
    agent: AgentId;
    place: Place | null;
  };
  previewOnly?: true;
};

// 본문 주장 가운데 core가 직접 확인한 것만 남긴다.
export type VerifiedCaller =
  | { kind: "person" }
  | {
      kind: "agent";
      agent: AgentId;
      place: Place | null;
      session: Id<"ses">;
      turn: Id<"trn">;
      toolCall: Id<"tcl">;
    }
  | { kind: "app"; app: Id<"app">; parent: Flight }
  | { kind: "program"; job: Id<"job">; job_run: Id<"jbr"> }
  | {
      kind: "flow";
      instance: Id<"wfi">;
      agent: AgentId;
      place: Place | null;
    };

type CallerChecks = {
  callers: CallerDirectory;
  activeRelease(app: Id<"app">): Result<Id<"rel"> | null>;
  flight(id: Id<"inv">): Flight | undefined;
};

const KIND_OF_ACTOR = {
  user: "person",
  agent: "agent",
  app: "app",
  program: "program",
  flow: "flow",
} as const;

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

export function verifyCaller(
  input: ToolCallInput,
  auth: CallAuth,
  checks: CallerChecks,
): Result<VerifiedCaller> {
  const caller = input.caller;
  if (KIND_OF_ACTOR[auth.actor] !== caller.kind) {
    return forbidden("caller kind does not match the credential");
  }
  if (caller.kind === "person") return ok({ kind: "person" });

  if (caller.kind === "agent") {
    const target = input.target;
    // preview는 그 앱 place의 session만 부른다(아래 판정).
    if (
      target.mode !== "preview" &&
      (target.mode !== "live" || target.release !== null)
    ) {
      return err({
        code: "invalid_input",
        message:
          "agent calls target the live active release or its own preview",
      });
    }
    const found = checks.callers.agentToolCall(
      caller.session as Id<"ses">,
      caller.turn as Id<"trn">,
      caller.tool_call as Id<"tcl">,
    );
    if (!found.ok) return found;
    if (found.value === null) return forbidden("unknown tool call");
    if (
      target.mode === "preview" &&
      !(
        found.value.place?.kind === "app" && found.value.place.id === target.app
      )
    ) {
      return forbidden("only a session in the app's place calls its preview");
    }
    return ok({
      kind: "agent",
      agent: found.value.agent,
      place: found.value.place,
      session: caller.session as Id<"ses">,
      turn: caller.turn as Id<"trn">,
      toolCall: caller.tool_call as Id<"tcl">,
    });
  }

  if (caller.kind === "program") {
    if (input.target.mode !== "live" || input.target.release !== null) {
      return err({
        code: "invalid_input",
        message: "program calls target the live active release",
      });
    }
    // 본문은 주장일 뿐이라 core가 만든 자격과 맞춰 본다.
    const { program } = auth;
    if (
      program === undefined ||
      program.job !== caller.job ||
      program.job_run !== caller.job_run
    ) {
      return forbidden("job run does not match the credential");
    }
    return ok({
      kind: "program",
      job: program.job,
      job_run: program.job_run,
    });
  }

  if (caller.kind === "flow") {
    if (input.target.mode !== "live" || input.target.release !== null) {
      return err({
        code: "invalid_input",
        message: "flow calls target the live active release",
      });
    }
    const { flow } = auth;
    if (flow === undefined || flow.instance !== caller.instance) {
      return forbidden("workflow instance does not match the credential");
    }
    return ok({
      kind: "flow",
      instance: flow.instance,
      agent: flow.agent,
      place: flow.place,
    });
  }

  if (input.target.mode !== "live" || input.target.release !== null) {
    return err({
      code: "invalid_input",
      message: "app calls target the live active release",
    });
  }
  const app = caller.app as Id<"app">;
  if (auth.app !== app) return forbidden("app does not match the credential");
  const active = checks.activeRelease(app);
  if (!active.ok) return active;
  if (active.value !== caller.release) {
    return forbidden("release is not the active release");
  }
  const parent =
    caller.parent_invocation === null
      ? undefined
      : checks.flight(caller.parent_invocation as Id<"inv">);
  if (!parent || parent.app !== app || parent.release !== caller.release) {
    return forbidden("unknown parent invocation");
  }
  return ok({ kind: "app", app, parent });
}
