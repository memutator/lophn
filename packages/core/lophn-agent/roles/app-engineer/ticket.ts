import { missingForReady } from "../../tools/mod.ts";

// App Engineer의 ticket 준비 검사. 순수 함수다: IO·시계·model
// 호출이 없다. ticket 생성·전환은 harness/tools의 `ticket.create`·`ticket.make_ready`가, 준비 상태의
// 소유 규칙은 coding-agent/tickets가 맡는다. 이 모듈은 무엇을 어떤 단위의 ticket으로 만들고 무엇이
// 모자라 확인 필요로 남는지의 모양만 정한다. claim·시작·보고는 이 역할에 없다.

// ticket 하나가 담는 요구의 상한이다(고정 결과 상한 "ticket 요구 6개").
export const TICKET_REQUIREMENT_MAX = 6;
// 한 수리 ticket이 묶는 문제의 상한이다(contract 상한).
export const REPAIR_PROBLEM_MAX = 12;

export type FlowRequirement = { flow: string; requirement: string };

export type TicketUnit = {
  flow: string;
  requirements: string[];
  // 같은 흐름이 나뉘었을 때의 몇 번째와 전체 수. 나뉘지 않으면 1/1이다.
  part: number;
  parts: number;
};

// 큰 일은 흐름 경계로 나누고 흐름 하나는 최대 6개 요구까지만 한 ticket에 둔다. 한 흐름이
// 6개를 넘으면 순서대로 6개씩 나눈다. 흐름의 처음 나온 순서와 요구의 입력 순서를 지킨다.
export function splitTicketUnits(
  items: readonly FlowRequirement[],
): TicketUnit[] {
  const flows = new Map<string, string[]>();
  for (const item of items) {
    const list = flows.get(item.flow) ?? [];
    list.push(item.requirement);
    flows.set(item.flow, list);
  }
  const units: TicketUnit[] = [];
  for (const [flow, requirements] of flows) {
    const parts = Math.ceil(requirements.length / TICKET_REQUIREMENT_MAX);
    for (let part = 0; part < parts; part += 1) {
      units.push({
        flow,
        requirements: requirements.slice(
          part * TICKET_REQUIREMENT_MAX,
          (part + 1) * TICKET_REQUIREMENT_MAX,
        ),
        part: part + 1,
        parts,
      });
    }
  }
  return units;
}

type Condition = { kind: string; problem?: string };

export type TicketPreparation = {
  readiness: "ready" | "needs_confirmation";
  // 실행 준비가 아닐 때 사람이나 다음 단계가 확인할 것이다. ready면 비어 있다.
  needs: string[];
};

// ticket 하나의 준비 상태다. 채택한 고정 설계 근거(고정 참조)·채택 질문·실행 가능한
// acceptance check가 모두 있고 요구가 흐름 하나에 6개 이하일 때만 ready이고, 모자라면 ticket을 버리지
// 않고 확인 필요 목록과 함께 needs_confirmation으로 남긴다.
export function prepareTicket(input: {
  kind: "implementation" | "repair";
  problems: readonly string[];
  references: readonly unknown[];
  adoption_questions: readonly unknown[];
  conditions: readonly Condition[];
  requirements: readonly string[];
}): TicketPreparation {
  const needs = missingForReady(input);
  if (input.requirements.length > TICKET_REQUIREMENT_MAX) {
    needs.push(
      `${input.requirements.length} requirements exceed ${TICKET_REQUIREMENT_MAX} for one flow`,
    );
  }
  return needs.length === 0
    ? { readiness: "ready", needs }
    : { readiness: "needs_confirmation", needs };
}

export type RepairCandidate = {
  problem: string;
  // 원인 가설과 알려진 해결 조건. 같은 둘이면 한 ticket으로 묶는다.
  cause: string;
  resolution: string;
  // 가설을 근거로 확인했는지. 확인하지 못한 가설은 확인됨으로 쓰지 않는다.
  cause_confirmed: boolean;
  // 재현 상태: 시험으로 재현, 사람 확인으로 대신, 재현 불가·미정.
  reproduction: "test" | "human" | "unknown";
};

export type RepairBundle = {
  cause: string;
  resolution: string;
  problems: string[];
  needs: string[];
};

// 같은 원인 가설과 같은 해결 조건의 문제를 한 수리 묶음으로 묶는다. 묶음은 문제 12개를 넘지
// 않고 넘으면 순서대로 나눈다. 가설이 확인되지 않았거나 재현이 불가·미정인 문제가 하나라도 있으면
// 그 묶음은 필요한 확인을 남긴다.
export function bundleRepairs(
  candidates: readonly RepairCandidate[],
): RepairBundle[] {
  const groups = new Map<string, RepairCandidate[]>();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.cause, candidate.resolution]);
    const list = groups.get(key) ?? [];
    if (!list.some((entry) => entry.problem === candidate.problem)) {
      list.push(candidate);
    }
    groups.set(key, list);
  }
  const bundles: RepairBundle[] = [];
  for (const list of groups.values()) {
    for (let start = 0; start < list.length; start += REPAIR_PROBLEM_MAX) {
      const slice = list.slice(start, start + REPAIR_PROBLEM_MAX);
      const needs: string[] = [];
      if (slice.some((entry) => !entry.cause_confirmed)) {
        needs.push("the cause hypothesis is not confirmed");
      }
      for (const entry of slice) {
        if (entry.reproduction === "unknown") {
          needs.push(`no reproduction for ${entry.problem}`);
        }
      }
      bundles.push({
        cause: slice[0]!.cause,
        resolution: slice[0]!.resolution,
        problems: slice.map((entry) => entry.problem),
        needs,
      });
    }
  }
  return bundles;
}

export type CodingRequest = {
  origin: "direct_request" | "feedback" | "design" | "repair";
  // 코드 변경이 필요한 일인지, 설정(preset·권한·공개 설정) 변경만 필요한 일인지.
  change: "code" | "setting_only";
};

// 직접 coding 요청·피드백·구현·수리는 모두 ticket이다. 설정 변경만 필요한 일은 coding ticket이
// 아니다: 설정은 사람이 정하는 경로로 안내한다.
export function ticketRoute(request: CodingRequest): "ticket" | "setting" {
  return request.change === "setting_only" ? "setting" : "ticket";
}

// 사람이 [Start]를 누르거나 자기 터미널에서 직접 시작하는 일은 이 역할의 동작이 아니다. 이
// 역할의 ticket 제공 이름 중 시작·claim·보고를 뜻하는 이름은 없어야 한다.
export const TICKET_FORBIDDEN_TOOL_NAMES: readonly string[] = [
  "ticket.claim",
  "ticket.renew",
  "ticket.release",
  "ticket.report",
  "ticket.start",
  "ticket.cancel",
  "ticket.update",
  "ticket.close",
  "ticket.link_release",
];
