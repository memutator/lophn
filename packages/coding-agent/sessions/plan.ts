// LaunchPlan을 만든다(coding-agent/sessions#R1–R5, R10, harnesses#R5, T38). plan은 spawn이 아니다.
// shell main이 클릭을 검증하며 다시 읽어 넘긴 ticket·connection 사실과 catalog·현재 감지로 executable·
// 분리 argv·env·첫 prompt·전달 방식을 정하고 shell terminal host가 그대로 연다. 순수 함수이고 감지·파일
// 읽기는 호출자가 인자로 준다(architecture). 실행 직전 사실이 달라졌으면 다른 harness로 바꾸거나 다시
// 감지·재발급하지 않고 conflict·unavailable과 다음 행동으로 끝낸다(R4, harnesses#R5). resume·재시작·자동
// 재전송은 이 plan에 없다(R10).
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  type CodingAgentLaunchPlan,
  codingAgentLaunchPlanSchema,
  type HarnessDetection,
  LOPHN_CONNECTION,
  OWN_TERMINAL_METHOD,
  PROMPT_DELIVERY_DEADLINE_MS,
  type PromptDelivery,
  type SessionGuide,
  type SessionPlanFacts,
  type SessionPlanInput,
} from "../../contracts/coding-agent/mod.ts";
import {
  catalogOf,
  type HarnessDefinition,
  versionAtLeast,
} from "../harnesses/mod.ts";
import {
  ENV_DELETE,
  ENV_SAFE_OVERLAY,
  isBatchShim,
  PROMPT_ADAPTERS,
  type PromptAdapter,
  TERMINAL_TUI,
} from "./model.ts";
import { firstPromptOf } from "./prompt.ts";

export type PlanContext = {
  // 저장한(또는 처음 본) 감지 결과다. 선택 harness의 것이고 없으면 null이다.
  detection: HarnessDetection | null;
  // 지금 PATH·catalog 위치에서 다시 본 실행 파일이다. 감지 뒤 옮겨졌는지 본다. 보지 못했으면 null이다.
  current: { selected: string | null } | null;
  // 시험이 끼우는 adapter 표다. 없으면 배포 표를 쓴다.
  adapters?: readonly PromptAdapter[];
};

export type PlanOutcome =
  | { kind: "plan"; plan: CodingAgentLaunchPlan }
  | { kind: "guide"; guide: SessionGuide };

function refuse(
  code: LophnError["code"],
  message: string,
  next: string[],
  guide?: SessionGuide,
): Result<never> {
  return err({
    code,
    message,
    details: { next, ...(guide === undefined ? {} : { guide }) },
  });
}

// 자기 터미널 안내다(R1). lophn은 process를 열지 않고 사람이 직접 시작한다.
export function guideOf(
  input: Pick<SessionPlanInput, "ticket" | "harness_id">,
  facts: SessionPlanFacts | undefined,
): SessionGuide {
  const definition = input.harness_id === undefined
    ? undefined
    : catalogOf(input.harness_id);
  return {
    method: OWN_TERMINAL_METHOD,
    ticket: input.ticket,
    harness_id: input.harness_id ?? null,
    first_prompt: firstPromptOf(input.ticket, facts),
    steps: [
      `${
        definition?.label ?? "쓰던 harness"
      }를 앱 source 폴더의 자기 터미널에서 연다`,
      "아래 first_prompt를 붙여 넣어 시작한다",
      "agent가 MCP lophn_ticket으로 ticket을 읽고 claim·작업·보고한다. lophn은 이 시작을 기록하지 않는다",
    ],
  };
}

// 제품 version이 catalog 정책을 만족하는지 본다(R4). 이유가 있으면 지원하지 않는다.
function versionRefusal(
  definition: HarnessDefinition,
  detection: HarnessDetection,
): string | null {
  const policy = definition.version_policy;
  if (policy.policy === "unknown") return null;
  const version = detection.version;
  if (version.result !== "verified" || version.value === null) {
    return `${definition.label}의 version을 확인하지 못했다`;
  }
  if (policy.policy === "minimum") {
    const minimum = policy.minimum_version;
    return minimum !== null && !versionAtLeast(version.value, minimum)
      ? `${definition.label} ${version.value}는 지원하는 최소 ${minimum}보다 낮다`
      : null;
  }
  return policy.tested_versions.includes(version.value)
    ? null
    : `${definition.label} ${version.value}는 검증한 version이 아니다`;
}

const START_STATES: readonly string[] = ["ready", "check_failed"];

function ticketRefusal(facts: SessionPlanFacts): Result<never> | null {
  if (facts.connection_state !== "active") {
    return refuse("conflict", "연결이 회수되어 시작하지 않는다", [
      "연결을 다시 만들고 harness를 설치한 뒤 시작한다. 자동 재발급은 없다",
    ]);
  }
  if (
    facts.connection_scope.kind === "app" &&
    facts.connection_scope.app !== facts.ticket_app
  ) {
    return refuse(
      "conflict",
      "연결의 범위가 이 ticket의 앱을 포함하지 않는다",
      [
        "이 앱을 허용하는 연결을 고르거나 만든다",
      ],
    );
  }
  if (facts.screen_state === "in_progress") {
    return refuse("conflict", "이 ticket은 이미 다른 연결이 맡아 작업 중이다", [
      "claim이 풀린 뒤 다시 시작한다",
    ]);
  }
  if (facts.screen_state === "needs_confirmation") {
    return refuse("conflict", "이 ticket은 사람의 확인이 필요하다", [
      "확인할 항목을 정리해 ticket을 준비된 상태로 만든 뒤 시작한다",
    ]);
  }
  if (!START_STATES.includes(facts.screen_state)) {
    return refuse(
      "conflict",
      `이 ticket은 시작할 수 있는 상태가 아니다(${facts.screen_state})`,
      ["ticket 상태를 확인한다"],
    );
  }
  return null;
}

export function launchPlanOf(
  input: SessionPlanInput,
  context: PlanContext,
): Result<PlanOutcome> {
  const facts = input.facts;
  if (input.method === OWN_TERMINAL_METHOD) {
    return ok({ kind: "guide", guide: guideOf(input, facts) });
  }
  if (input.method !== TERMINAL_TUI) {
    return err({
      code: "invalid_input",
      message: `지원하지 않는 시작 방식이다: ${input.method}`,
      details: { next: [`${TERMINAL_TUI} 또는 ${OWN_TERMINAL_METHOD}만 쓴다`] },
    });
  }
  const guide = guideOf(input, facts);
  if (facts === undefined) {
    return refuse("unavailable", "ticket·연결의 현재 상태를 확인한 값이 없다", [
      "shell이 ticket과 연결을 다시 읽어 넘긴 뒤에만 시작한다",
    ]);
  }
  const refused = ticketRefusal(facts);
  if (refused !== null) return refused;
  if (input.harness_id === undefined) {
    return refuse("invalid_input", "시작할 harness가 정해지지 않았다", [
      "사람이 harness를 고른다. 다른 제품으로 자동 대체하지 않는다",
    ]);
  }
  const harness = input.harness_id;
  if (input.project === undefined || input.folder_ref === undefined) {
    return refuse(
      "unavailable",
      "이 앱의 연결 source가 속한 등록 project 폴더가 없다. 임의 폴더로 열지 않는다",
      [
        "앱 source를 project에 연결하고 등록 폴더를 고른다",
        "또는 자기 터미널에서 직접 시작한다",
      ],
      guide,
    );
  }
  const definition = catalogOf(harness);
  if (definition === undefined) {
    return err({ code: "invalid_input", message: "알 수 없는 harness다" });
  }
  const adapter = (context.adapters ?? PROMPT_ADAPTERS).find((item) =>
    item.harness_id === harness
  );
  if (
    adapter === undefined || !adapter.verified ||
    definition.execution.transport !== "pty" ||
    definition.execution.capability !== "supported"
  ) {
    return refuse(
      "unavailable",
      adapter?.unverified_reason ??
        `${definition.label}의 TUI 시작 adapter가 검증되지 않았다`,
      ["자기 터미널에서 직접 시작한다"],
      guide,
    );
  }
  const detection = context.detection;
  if (detection === null || detection.discovery !== "detected") {
    return refuse(
      "unavailable",
      `${definition.label}를 이 컴퓨터에서 찾지 못했다`,
      [
        "`lophn harness refresh`로 사람이 다시 감지하거나 설치한다. 다른 harness로 바꾸지 않는다",
      ],
    );
  }
  if (detection.environment.kind !== "host") {
    return refuse("unavailable", "지금은 native host에서만 시작한다", [
      "자기 터미널에서 직접 시작한다",
    ], guide);
  }
  if ((input.profile_id ?? null) !== detection.profile_id) {
    return refuse("conflict", "선택한 profile이 감지한 profile과 다르다", [
      "profile을 다시 고르거나 `lophn harness refresh`로 다시 감지한다",
    ]);
  }
  const unsupported = versionRefusal(definition, detection);
  if (unsupported !== null) {
    return refuse("unavailable", unsupported, [
      "`lophn harness refresh`로 version을 확인하거나 제품을 갱신한다",
    ], guide);
  }
  const executable = detection.selected_executable;
  if (executable === null) {
    return refuse("unavailable", "실행 파일을 정하지 못했다", [
      "`lophn harness refresh`로 다시 감지한다",
    ]);
  }
  if (context.current === null || context.current.selected !== executable) {
    return refuse(
      "conflict",
      "감지한 실행 파일이 옮겨졌거나 사라졌다. 다른 경로로 대체하지 않는다",
      ["`lophn harness refresh`로 사람이 다시 감지한 뒤 시작한다"],
    );
  }

  const prompt = firstPromptOf(input.ticket, facts);
  const command = definition.execution.launch_argv;
  const base = [command[0] ?? harness, ...command.slice(1)];
  let argv: string[];
  let delivery: PromptDelivery;
  if (adapter.prompt.kind === "argv") {
    if (isBatchShim(executable)) {
      return refuse(
        "unavailable",
        "`.cmd` shim은 줄바꿈 prompt를 argv로 넘기지 못해 시작하지 않는다",
        ["자기 터미널에서 직접 시작한다"],
        guide,
      );
    }
    // prompt는 한 인자다. shell 문자열 조합·quote·escape가 없다.
    argv = adapter.prompt.flag === null
      ? [...base, prompt]
      : [...base, adapter.prompt.flag, prompt];
    delivery = { mode: "argv" };
  } else {
    if (adapter.prompt.readiness === null) {
      return refuse(
        "unavailable",
        "검증한 composer 준비 신호가 없어 첫 prompt를 입력으로 넣지 않는다",
        ["자기 터미널에서 직접 시작한다"],
        guide,
      );
    }
    argv = base;
    delivery = {
      mode: "stdin_after_ready",
      readiness: adapter.prompt.readiness,
      deadline_ms: PROMPT_DELIVERY_DEADLINE_MS,
    };
  }
  const overlay: Record<string, string> = {
    ...ENV_SAFE_OVERLAY,
    [LOPHN_CONNECTION]: input.connection,
  };
  const planned = codingAgentLaunchPlanSchema.safeParse({
    ticket: input.ticket,
    ticket_revision: input.ticket_revision,
    harness_id: harness,
    catalog_revision: definition.catalog_revision,
    adapter_revision: definition.adapter_revision,
    environment: detection.environment,
    profile_id: detection.profile_id,
    connection: input.connection,
    project: input.project,
    folder_ref: input.folder_ref,
    cwd: input.cwd,
    method: TERMINAL_TUI,
    executable,
    argv,
    env_names: Object.keys(overlay),
    env_overlay: overlay,
    env_delete: [...ENV_DELETE],
    first_prompt: prompt,
    prompt_delivery: delivery,
    human_start_handle: input.human_start_handle,
    operation_id: input.operation_id,
  });
  if (!planned.success) {
    return err({
      code: "invalid_input",
      message: "시작 계획의 값이 올바르지 않다(경로·folder)",
    });
  }
  return ok({ kind: "plan", plan: planned.data });
}
