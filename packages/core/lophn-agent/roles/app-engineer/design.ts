import { ASSUMPTION_MAX } from "./interview.ts";

// App Engineer 설계 문서의 종류·순서·명세 검사.
// 순수 함수다: IO·시계·model 호출이 없다. 저장은 document.create·document.save_version
// (harness/tools 문서 묶음)이, 형식 저장 검사는 documents/formats가 맡는다. 이 모듈은
// 무엇을 어떤 순서로 어떤 근거와 함께 남기는지의 모양만 정한다.

// 설계·해석 결과가 Markdown 문서로 남을 수 있는 8종류. 고정 8개 산출물 선언이 아니라
// 요청에 필요한 종류만 저장한다.
export const DESIGN_DOCUMENT_KINDS = [
  "domain_story",
  "glossary_draft",
  "domain_model",
  "requirements",
  "usage_flow",
  "spec",
  "observation",
  "interpretation",
] as const;
export type DesignDocumentKind = (typeof DESIGN_DOCUMENT_KINDS)[number];

export const DESIGN_MEDIA_TYPE = "text/markdown" as const;

export const DESIGN_DOCUMENT_TITLES: Readonly<
  Record<DesignDocumentKind, string>
> = {
  domain_story: "도메인 스토리",
  glossary_draft: "용어집 초안",
  domain_model: "도메인 모델과 조작",
  requirements: "요구사항",
  usage_flow: "사용 흐름",
  spec: "전체 명세",
  observation: "관측 설계 설명",
  interpretation: "문제 해석",
};

// 요청에서 필요한 종류만 저장 대상이 된다. 종류가 아닌 이름(예: blueprint 사본)은
// 저장하지 않고 따로 돌려준다. 중복은 하나로 접고 정해진 종류 순서로 낸다.
export function planDesignSaves(requested: readonly string[]): {
  save: DesignDocumentKind[];
  unknown: string[];
} {
  const wanted = new Set(requested);
  return {
    save: DESIGN_DOCUMENT_KINDS.filter((kind) => wanted.has(kind)),
    unknown: [...wanted].filter((name) =>
      !(DESIGN_DOCUMENT_KINDS as readonly string[]).includes(name)
    ),
  };
}

// 새 앱 설계의 진행 순서. 앞 단계의 결과가 뒤 단계의 근거다. 마지막 앱 계약의 요구는
// 문서 종류가 아니라 설계 문서·티켓 안의 설명이다.
export const DESIGN_STEPS = [
  { key: "story_terms", kinds: ["domain_story", "glossary_draft"] },
  { key: "model_operations", kinds: ["domain_model"] },
  { key: "requirements", kinds: ["requirements"] },
  { key: "usage_flow", kinds: ["usage_flow"] },
  { key: "spec", kinds: ["spec"] },
  { key: "observation", kinds: ["observation"] },
  { key: "contract_request", kinds: [] },
] as const satisfies readonly {
  key: string;
  kinds: readonly DesignDocumentKind[];
}[];
export type DesignStep = (typeof DESIGN_STEPS)[number]["key"];

function stepIndex(step: DesignStep): number {
  return DESIGN_STEPS.findIndex((entry) => entry.key === step);
}

// 다음에 할 단계다. 끝났거나 이번 요청에 필요 없어 건너뛴 단계는 지나간다.
export function nextDesignStep(
  finished: readonly DesignStep[],
): DesignStep | undefined {
  const done = new Set(finished);
  return DESIGN_STEPS.find((entry) => !done.has(entry.key))?.key;
}

// 단계를 시작해도 되는지. 앞의 모든 단계가 끝났거나 건너뛰어졌어야 한다.
export function canStartStep(
  step: DesignStep,
  finished: readonly DesignStep[],
): boolean {
  const done = new Set(finished);
  return DESIGN_STEPS.slice(0, stepIndex(step)).every((entry) =>
    done.has(entry.key)
  );
}

// 한 단계가 낸 결과 문서의 고정 version이다.
export type StepResult = {
  step: DesignStep;
  document: string;
  version: string;
};
export type BasisReference = { document: string; version: string };

function key(reference: BasisReference): string {
  return `${reference.document}@${reference.version}`;
}

// 뒤 단계의 판단 근거를 검사한다. 결과를 낸 가장 가까운 앞 단계의 문서가 모두 근거에
// 있어야 하고, 근거로 든 고정 version은 이 run이 실제로 읽은 것이어야 한다. 최신 판은
// 읽지 않았으면 근거가 아니다: 앞 문서에 새 version이 생겨도 이미 읽고 든 근거는 그 고정
// version 그대로 남는다.
export function checkStepBasis(
  step: DesignStep,
  basis: readonly BasisReference[],
  results: readonly StepResult[],
  read: ReadonlySet<string>,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const index = stepIndex(step);
  for (const reference of basis) {
    if (!read.has(key(reference))) {
      problems.push(`basis version not read: ${key(reference)}`);
    }
  }
  if (index > 0) {
    const previous = results.filter((result) => stepIndex(result.step) < index);
    const nearest = previous.reduce(
      (highest, result) => Math.max(highest, stepIndex(result.step)),
      -1,
    );
    const cited = new Set(basis.map((reference) => reference.document));
    for (const result of previous) {
      if (stepIndex(result.step) !== nearest) continue;
      if (!cited.has(result.document)) {
        problems.push(`basis misses the ${result.step} result`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

// 전체 명세의 흐름. main은 사람이 겪는 동작이고, 빈 결과와 실패는 그 main 흐름의
// 별도 흐름이다.
export const SPEC_FLOW_STEP_MAX = 8;

export type SpecFlow = {
  name: string;
  kind: "main" | "empty" | "failure";
  // empty·failure 흐름이 속한 main 흐름 이름. main은 null이다.
  of: string | null;
  steps: string[];
  may_be_empty?: boolean;
  may_fail?: boolean;
};

export type SpecDraft = {
  purpose: string;
  out_of_scope: string[];
  flows: SpecFlow[];
  invariants: string[];
  acceptance: string[];
  assumptions: string[];
  // 명세 본문 전체 글이다. 다른 판을 가리키는 문장이 없는지 본다.
  text: string;
};

// 흐름 하나가 8단계를 넘으면 단계 경계에서 나눈다.
export function splitFlow(flow: SpecFlow): SpecFlow[] {
  if (flow.steps.length <= SPEC_FLOW_STEP_MAX) return [flow];
  const parts: SpecFlow[] = [];
  const total = Math.ceil(flow.steps.length / SPEC_FLOW_STEP_MAX);
  for (let part = 0; part < total; part += 1) {
    parts.push({
      ...flow,
      name: `${flow.name} (${part + 1}/${total})`,
      steps: flow.steps.slice(
        part * SPEC_FLOW_STEP_MAX,
        (part + 1) * SPEC_FLOW_STEP_MAX,
      ),
    });
  }
  return parts;
}

// 명세가 정하지 않는 구현·시각 선택이다. 구현자의 기술 선택은 열어 둔다.
const CHOICES: readonly { category: string; pattern: RegExp }[] = [
  {
    category: "layout",
    pattern: /레이아웃|배치|사이드바|\blayout\b|\bgrid\b|\bpx\b/i,
  },
  { category: "color", pattern: /색상|색깔|\bcolor\b|#[0-9a-f]{6}\b/i },
  { category: "component", pattern: /컴포넌트|\bcomponent\b|모달|\bmodal\b/i },
  {
    category: "library",
    pattern: /라이브러리|\blibrary\b|\breact\b|\bvue\b|\bredux\b|\btailwind\b/i,
  },
  {
    category: "storage",
    pattern: /sqlite|postgres|\bredis\b|\bmongodb\b|저장소 구현|\bindexeddb\b/i,
  },
];

export function implementationChoices(text: string): string[] {
  return CHOICES.filter((choice) => choice.pattern.test(text)).map((choice) =>
    choice.category
  );
}

// 다른 판을 가리켜 현재 동작을 알려 주지 않는 문장이다. 명세 최신 판 하나로 현재 동작을
// 알 수 있어야 한다.
const OTHER_VERSION = /이전 판|지난 판|이전 version|previous version|see v\d/i;

// 전체 명세를 검사한다. 문제는 코드 문자열이다.
export function checkSpec(
  spec: SpecDraft,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (spec.purpose.trim() === "") problems.push("purpose missing");
  if (spec.out_of_scope.length === 0) problems.push("out of scope missing");
  if (spec.invariants.length === 0) problems.push("invariant missing");
  if (spec.acceptance.length === 0) problems.push("acceptance check missing");
  const mains = spec.flows.filter((flow) => flow.kind === "main");
  if (mains.length === 0) problems.push("main flow missing");
  const names = new Set(mains.map((flow) => flow.name));
  for (const flow of spec.flows) {
    if (flow.steps.length > SPEC_FLOW_STEP_MAX) {
      problems.push(`flow too long: ${flow.name}`);
    }
    if (flow.kind !== "main" && (flow.of === null || !names.has(flow.of))) {
      problems.push(`${flow.kind} flow has no main flow: ${flow.name}`);
    }
  }
  for (const main of mains) {
    const has = (kind: SpecFlow["kind"]) =>
      spec.flows.some((flow) => flow.kind === kind && flow.of === main.name);
    if (main.may_be_empty === true && !has("empty")) {
      problems.push(`empty flow missing: ${main.name}`);
    }
    if (main.may_fail === true && !has("failure")) {
      problems.push(`failure flow missing: ${main.name}`);
    }
  }
  if (spec.assumptions.length > ASSUMPTION_MAX) {
    problems.push("too many assumptions");
  }
  const body = [
    spec.purpose,
    ...spec.out_of_scope,
    ...spec.invariants,
    ...spec.acceptance,
    ...spec.flows.flatMap((flow) => flow.steps),
  ].join("\n");
  for (const category of implementationChoices(body)) {
    problems.push(`implementation choice: ${category}`);
  }
  if (OTHER_VERSION.test(spec.text)) problems.push("refers to another version");
  return { ok: problems.length === 0, problems };
}

// 앱 계약 변경의 요구. 도메인 조작마다 읽기·쓰기 명령을 잇고 필요한 권한은 그
// 명령에서만 나온다. blueprint 원본은 coding agent의 release가 바꾸므로 이 요구는 설명일 뿐
// blueprint 내용을 옮겨 적지 않는다.
export type ContractRequest = {
  operations: {
    operation: string;
    commands: { key: string; effect: "read" | "write" }[];
    automation: string | null;
  }[];
  permissions: { command: string; reason: string }[];
  text: string;
};

// blueprint 원본의 모양(commands 배열의 key·effect 객체)을 그대로 옮긴 글이다.
export function looksLikeBlueprintCopy(text: string): boolean {
  return /"commands"\s*:\s*\[/.test(text) && /"key"\s*:/.test(text) &&
    /"effect"\s*:/.test(text);
}

export function checkContractRequest(
  request: ContractRequest,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (request.operations.length === 0) problems.push("operation missing");
  const known = new Set<string>();
  for (const operation of request.operations) {
    if (operation.commands.length === 0) {
      problems.push(`operation has no command: ${operation.operation}`);
    }
    for (const command of operation.commands) known.add(command.key);
  }
  for (const permission of request.permissions) {
    if (!known.has(permission.command)) {
      problems.push(`permission outside the request: ${permission.command}`);
    }
    if (permission.reason.trim() === "") {
      problems.push(`permission without reason: ${permission.command}`);
    }
  }
  if (looksLikeBlueprintCopy(request.text)) {
    problems.push("blueprint copy in the request");
  }
  return { ok: problems.length === 0, problems };
}

// 판단·정리의 용도다. 인터뷰 해석·설계·가설·ticket 범위·release 의미·handoff 판단의
// 본문은 judgment, 이미 정한 제목·요약은 organizing이다. 실제 provider·model·계정은 preset
// 선택의 몫이라 여기서 이름을 정하지 않는다.
export type ModelUse = {
  call:
    | "interview_reading"
    | "design_body"
    | "cause_hypothesis"
    | "ticket_scope"
    | "release_meaning"
    | "handoff_decision"
    | "ticket_title"
    | "document_title"
    | "summary";
  purpose: "judgment" | "organizing";
};

export function purposeOf(call: ModelUse["call"]): ModelUse["purpose"] {
  return call === "ticket_title" || call === "document_title" ||
      call === "summary"
    ? "organizing"
    : "judgment";
}
