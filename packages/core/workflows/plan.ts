import type { AgentAddress } from "../../protocol/lophn-agent/mod.ts";
import type { RemoteAddress } from "../../protocol/lophn-agent/calls.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type { WorkflowRemote } from "./ports.ts";
import type {
  HandoffPlan,
  InstanceStep,
  Participant,
  SessionChoice,
  WorkflowInstance,
} from "../../protocol/workflows/mod.ts";

// 상태를 읽은 값으로 HandoffPlan을 만드는 순수 함수다. command는 tx 안에서 blob을 만들 수 없어서
// 본문과 받는 곳을 앞에서 정해 받은 대로 넣는다.

type NotHanded = NonNullable<HandoffPlan["unresolved"]>;
type Remote = Pick<WorkflowRemote, "computer" | "workspace" | "isPrivate">;
type Resolved =
  | { address: AgentAddress }
  | {
      remote: {
        machine: Id<"mch">;
        computer: string;
        agent: string;
        workspace: Extract<RemoteAddress, { workspace: unknown }>["workspace"];
      };
    }
  | NotHanded;

const unresolved = (
  reason: NotHanded["reason"],
  message: string,
): NotHanded => ({
  reason,
  message,
});

// 참가자는 늘 주소가 된다. workspace가 없으면 instance의 project다.
// harness agent는 이름이 있는 agent라 `{ agent }` 참가자로 받는다(Router가 harness queue로 보낸다).
// human은 with의 참가자가 받는다.
function addressOf(
  participant: Participant,
  project: string,
  remote: Remote,
): Resolved {
  if ("kind" in participant) {
    return unresolved("no_with", "a human step needs a with participant");
  }
  // 다른 컴퓨터의 참가자. 넘길 때마다 명단과 정책으로 푼다.
  if (participant.on !== undefined) {
    if (remote.isPrivate(project as Id<"prj">)) {
      return unresolved(
        "unresolved",
        "a private workspace does not hand steps to another computer",
      );
    }
    const computer = remote.computer(participant.on);
    if (!computer.ok) {
      return unresolved("unknown_computer", computer.error.message);
    }
    const workspace = remote.workspace(
      participant.workspace,
      project as Id<"prj">,
    );
    if (!workspace.ok) return unresolved("unresolved", workspace.error.message);
    return {
      remote: {
        machine: computer.value.machine,
        computer: computer.value.computer,
        agent: participant.agent,
        workspace: workspace.value,
      },
    };
  }
  return {
    address: {
      agent: participant.agent,
      workspace: participant.workspace ?? { project },
    },
  };
}

export function planHandoff(input: {
  instance: Pick<WorkflowInstance, "id" | "project" | "participants" | "steps">;
  step: string;
  cause: HandoffPlan["cause"];
  // 요청한 값. 시작은 null이다.
  session: SessionChoice | null;
  received: string;
  // 시작 시 검증된 선언적 입력. 첫 step hand-off 본문에 Inputs: 섹션으로 주입한다.
  inputs?: Record<string, unknown>;
  // 그 참가자가 이 instance에서 마지막으로 step 메시지를 받은 session(다른 컴퓨터의 참가자면 그 컴퓨터의 session).
  sameSession(participant: string): string | null;
  remote: Remote;
}): HandoffPlan {
  const { instance, step: name, cause, session, received, inputs } = input;
  const base = { step: name, cause, session };
  const fail = (problem: NotHanded): HandoffPlan => ({
    ...base,
    participant: null,
    human_turn: false,
    delivery: null,
    unresolved: problem,
  });

  const step = instance.steps.find((s) => s.name === name);
  if (step === undefined) {
    return fail(unresolved("unknown_step", "the step does not exist"));
  }
  const by = instance.participants[step.by];
  if (by === undefined) {
    return fail(unresolved("unknown_participant", "the step's by is unknown"));
  }
  // 사람 step은 with 참가자의 agent session에 넘기고 사람이 그 session에서 일한다.
  const human = "kind" in by && by.kind === "human";
  let key = step.by;
  let participant = by;
  if (human) {
    if (step.with === null) {
      return fail(unresolved("no_with", "a human step needs a with"));
    }
    const helper = instance.participants[step.with];
    if (helper === undefined) {
      return fail(
        unresolved("unknown_participant", "the step's with is unknown"),
      );
    }
    key = step.with;
    participant = helper;
  }
  const resolved = addressOf(participant, instance.project, input.remote);
  if ("reason" in resolved) return fail(resolved);

  const same = session === "same" ? input.sameSession(key) : null;
  const body = stepBody({ step, received, inputs });
  const participantOpen = "kind" in participant ? undefined : participant.open;
  const open = step.open ?? participantOpen ?? (human ? "tab" : undefined);
  if ("remote" in resolved) {
    const { machine, computer, agent, workspace } = resolved.remote;
    // 글 크기는 redaction 뒤에 Router의 sendStep이 본다(not_handed 줄이 된다).
    return {
      ...base,
      participant: key,
      human_turn: human,
      ...(open !== undefined ? { open } : {}),
      delivery: {
        remote: {
          machine,
          computer,
          address:
            same === null
              ? { agent, workspace }
              : { agent, workspace, session: same, fallback: "new" },
        },
        body,
      },
      unresolved: null,
    };
  }
  return {
    ...base,
    participant: key,
    human_turn: human,
    ...(open !== undefined ? { open } : {}),
    delivery: {
      to:
        same === null
          ? resolved.address
          : { ...resolved.address, session: same, fallback: "new" },
      body,
    },
    unresolved: null,
  };
}

function formatInputValue(value: unknown): string {
  if (typeof value === "string") {
    return value.includes("\n")
      ? `\n  ${value.split("\n").join("\n  ")}`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    )
  ) {
    return value.map(String).join(", ");
  }
  return JSON.stringify(value);
}

// inputs·report data 안의 모든 문자열(객체 key·value, 중첩 배열·객체)을 재귀적으로 redaction한다.
// 한 문자열이라도 null(redaction 미완료)이 나오면 fail-closed로 ok: false를 돌려준다.
export function redactJsonValues(
  value: unknown,
  redact: (text: string) => string | null,
): { ok: true; value: unknown } | { ok: false } {
  if (typeof value === "string") {
    const done = redact(value);
    return done === null ? { ok: false } : { ok: true, value: done };
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const done = redactJsonValues(item, redact);
      if (!done.ok) return done;
      out.push(done.value);
    }
    return { ok: true, value: out };
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const safeKey = redact(k);
      if (safeKey === null) return { ok: false };
      const safeVal = redactJsonValues(v, redact);
      if (!safeVal.ok) return safeVal;
      out[safeKey] = safeVal.value;
    }
    return { ok: true, value: out };
  }
  return { ok: true, value };
}

// 고정 영어 label이라 받는 쪽 이력의 글이 바뀌지 않는다.
export function stepBody({
  step,
  received,
  inputs,
}: {
  step: InstanceStep;
  received: string;
  inputs?: Record<string, unknown>;
}): string {
  const lines = [step.prompt, ""];
  if (inputs !== undefined && Object.keys(inputs).length > 0) {
    lines.push("Inputs:");
    for (const [key, value] of Object.entries(inputs)) {
      lines.push(`- ${key}: ${formatInputValue(value)}`);
    }
    lines.push("");
  }
  if (step.in !== "") lines.push(`Receives: ${step.in}`);
  lines.push("Received:", received);
  if (step.out !== "") lines.push(`Produces: ${step.out}`);
  if (step.next.length > 0) {
    lines.push(`Next candidates: ${step.next.join(", ")}`);
  }
  return lines.join("\n");
}

// [Retry]가 기록된 같은 session에 보내는 짧은 이어가기 안내다. 새 session으로 처음부터 돌리지 않는다.
export function retryContinueBody(
  step: InstanceStep | null,
  stepName: string,
): string {
  const lines = [
    `Continue step "${stepName}" from where you left off and report your result using \`workflow report\` when done.`,
  ];
  if (step !== null) {
    if (step.out !== "") lines.push(`Produces: ${step.out}`);
    if (step.next.length > 0) {
      lines.push(`Next candidates: ${step.next.join(", ")}`);
    }
  }
  return lines.join("\n");
}
