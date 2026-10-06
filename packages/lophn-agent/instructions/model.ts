import type { Result } from "../../base/mod.ts";
import type {
  AgentRole,
  AssignmentScope,
  InstructionLocation,
  WorkPlace,
} from "../../contracts/lophn-agent/mod.ts";

// 사람 지침(LOPHN.md)의 층·작업 자리·상한을 고르는 순수 규칙이다. 파일 읽기와 hash는 work.ts,
// 파일·Document·Version의 정본은 documents다(lophn-agent/instructions 요구 R1–R8).

export const INSTRUCTION_FILE_MAX_BYTES = 32768;
export const INSTRUCTION_TOTAL_MAX_BYTES = 131072;

export type InstructionLayerKind = "global" | "project" | "app" | "preset";
export type InstructionStatus =
  | "present"
  | "absent"
  | "unavailable"
  | "invalid"
  | "too_large";

// 지침을 읽는 쪽이 보는 확정 판 하나. bytes는 파일 처음부터 최대 INSTRUCTION_FILE_MAX_BYTES 만큼이다.
// 상한을 넘는 파일은 size_bytes로만 알면 되므로 끝까지 읽지 않는다.
export type InstructionFile = {
  document: string;
  version: string;
  size_bytes: number;
  bytes: Uint8Array;
};

// 읽기 통로는 읽기만 있다. 지침 파일 생성·저장·연결 변경은 사람의 documents command이고
// agent는 question으로 제안만 한다(R3).
export interface InstructionFiles {
  // 전역·project·app 층의 등록 파일. 파일이 없으면 null(부재)이고 읽지 못하면 err다.
  registered(
    location: InstructionLocation,
  ): Promise<Result<InstructionFile | null>>;
  // preset에 붙인 지침 문서의 현재 확정 판. 붙인 문서가 없어졌으면 부재가 아니라 err다.
  attached(document: string): Promise<Result<InstructionFile>>;
  // 앱이 속한 project. 관계를 모르면 null이다.
  projectOf(app: string): Promise<Result<string | null>>;
}

// 한 층의 읽기 결과. 로컬 경로는 어느 칸에도 없다(R8).
export type InstructionLayer = {
  kind: InstructionLayerKind;
  // project·app 층의 대상 id. global·preset은 null이다.
  place: string | null;
  document: string | null;
  version: string | null;
  source_hash: string | null;
  transmitted_hash: string | null;
  status: InstructionStatus;
  // 포장 전 UTF-8 byte. 부재면 0이다.
  bytes: number;
  reason: string | null;
  // 전송 본문(redaction 뒤). present이고 call을 막지 않을 때만 있다.
  text: string | null;
};

export type InstructionResolution =
  & {
    place: WorkPlace;
    layers: InstructionLayer[];
    total_bytes: number;
  }
  & (
    | { status: "ready" }
    | {
      status: "blocked";
      reason: "layer_failed" | "total_too_large";
      message: string;
    }
  );

// 이번 call의 지침 작업 자리. App Engineer와 Operator는 담당 범위로 고정이고 lophn·Context
// Engineer는 세션이 가진 자리다. 탭 이동은 이 입력에 없다(R4).
export function instructionPlace(input: {
  role: AgentRole;
  session: WorkPlace;
  scope: AssignmentScope;
}): WorkPlace {
  const { role, scope } = input;
  if (role === "app_engineer" && scope.kind === "app") {
    return { kind: "app", id: scope.id };
  }
  if (role === "operator" && scope.kind === "app") {
    return { kind: "app", id: scope.id };
  }
  if (role === "operator" && scope.kind === "project") {
    return { kind: "project", id: scope.id };
  }
  return input.session;
}

// 전역 → project → app 순으로 읽을 등록 파일 자리다. 부모 폴더를 거슬러 오르지 않고 정해진
// 세 자리 밖은 없다(R1). 앱이 속한 project를 모르면 project 층은 없다.
export function instructionLocations(
  place: WorkPlace,
  appProject: string | null,
): InstructionLocation[] {
  const locations: InstructionLocation[] = [{
    layer: "global",
    place: "global",
  }];
  if (place.kind === "project") {
    locations.push({ layer: "project", place: place.id });
  }
  if (place.kind === "app") {
    if (appProject !== null) {
      locations.push({ layer: "project", place: appProject });
    }
    locations.push({ layer: "app", place: place.id });
  }
  return locations;
}

// preset 판에 붙인 지침을 적용 순서대로 정한다. 앞 층이 이미 넣은 문서는 다시 넣지 않는다.
export function attachmentOrder(
  attachments: readonly { document: string; order: number }[],
  included: ReadonlySet<string>,
): string[] {
  const seen = new Set(included);
  const documents: string[] = [];
  for (
    const attachment of [...attachments].sort((a, b) => a.order - b.order)
  ) {
    if (seen.has(attachment.document)) continue;
    seen.add(attachment.document);
    documents.push(attachment.document);
  }
  return documents;
}

export type Inspected =
  | { status: "present"; text: string }
  | { status: "too_large" | "invalid"; reason: string };

// 상한을 넘으면 자르지 않고, UTF-8이 아니면 대체 문자로 바꾸지 않는다(R7).
export function inspectInstruction(file: InstructionFile): Inspected {
  if (file.size_bytes > INSTRUCTION_FILE_MAX_BYTES) {
    return { status: "too_large", reason: "instruction file is too large" };
  }
  try {
    return {
      status: "present",
      text: new TextDecoder("utf-8", { fatal: true }).decode(file.bytes),
    };
  } catch {
    return { status: "invalid", reason: "instruction file is not UTF-8" };
  }
}

// 층 목록으로 call을 보낼 수 있는지 정한다. 부재만 건너뛰고 나머지 비정상 상태나 합계 초과는
// 본문을 하나도 보내지 않고 멈춘다(R7).
export function resolveLayers(
  place: WorkPlace,
  layers: InstructionLayer[],
): InstructionResolution {
  const total = layers.reduce((sum, layer) => sum + layer.bytes, 0);
  const failed = layers.find((layer) =>
    layer.status !== "present" && layer.status !== "absent"
  );
  const blocked = failed !== undefined
    ? { reason: "layer_failed" as const, message: describeFailure(failed) }
    : total > INSTRUCTION_TOTAL_MAX_BYTES
    ? {
      reason: "total_too_large" as const,
      message: "instruction files exceed the total limit",
    }
    : undefined;
  if (blocked === undefined) {
    return { status: "ready", place, layers, total_bytes: total };
  }
  return {
    status: "blocked",
    ...blocked,
    place,
    layers: layers.map((layer) => ({ ...layer, text: null })),
    total_bytes: total,
  };
}

function describeFailure(layer: InstructionLayer): string {
  return `${layer.kind} instruction is ${layer.status}${
    layer.reason === null ? "" : `: ${layer.reason}`
  }`;
}
