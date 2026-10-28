import type { AgentAddress } from "../../protocol/lophn-agent/mod.ts";
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
type Resolved = { address: AgentAddress } | NotHanded;

const unresolved = (
  reason: NotHanded["reason"],
  message: string,
): NotHanded => ({
  reason,
  message,
});

// 참가자는 늘 주소가 된다. place가 없으면 instance의 project다.
// harness는 받기만 하고 넘기지 못하고, human은 with의 참가자가 받는다.
function addressOf(participant: Participant, project: string): Resolved {
  if ("kind" in participant) {
    return participant.kind === "harness"
      ? unresolved("harness", "a harness participant is not handed a step")
      : unresolved("no_with", "a human step needs a with participant");
  }
  return {
    address: {
      agent: participant.agent,
      place: participant.place ?? { project },
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
  // 그 참가자가 이 instance에서 마지막으로 step 메시지를 받은 session.
  sameSession(participant: string): string | null;
}): HandoffPlan {
  const { instance, step: name, cause, session, received } = input;
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
  const resolved = addressOf(participant, instance.project);
  if (!("address" in resolved)) return fail(resolved);

  const same = session === "same" ? input.sameSession(key) : null;
  return {
    ...base,
    participant: key,
    human_turn: human,
    delivery: {
      to:
        same === null
          ? resolved.address
          : { ...resolved.address, session: same, fallback: "new" },
      body: stepBody({ step, received }),
    },
    unresolved: null,
  };
}

// 고정 영어 label이라 받는 쪽 이력의 글이 바뀌지 않는다.
export function stepBody({
  step,
  received,
}: {
  step: InstanceStep;
  received: string;
}): string {
  const lines = [step.prompt, ""];
  if (step.in !== "") lines.push(`Receives: ${step.in}`);
  lines.push("Received:", received);
  if (step.out !== "") lines.push(`Produces: ${step.out}`);
  if (step.next.length > 0) {
    lines.push(`Next candidates: ${step.next.join(", ")}`);
  }
  return lines.join("\n");
}
