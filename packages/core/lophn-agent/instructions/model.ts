import type { Result } from "../../../base/mod.ts";
import type {
  AgentRole,
  AssignmentScope,
  PROMPT_INSTRUCTION_LAYERS,
  WorkPlace,
} from "../../../protocol/lophn-agent/mod.ts";

// 사람 지침(LOPHN.md)의 층과 상한을 고르는 순수 규칙이다. LOPHN.md는 document·판을 쓰지 않는 그냥 파일이다.
// turn 시작에 읽는 쪽은 turn.ts, 파일을 여는 쪽은 core(files.ts)다. 아래 `instructionPlace`,
// `InstructionLayer`, `InstructionResolution`, `resolveLayers`와 work.ts는 옛 assemblePrompt가 쓰는 동안만 남는다.

export const INSTRUCTION_FILE_MAX_BYTES = 32768;
export const INSTRUCTION_TOTAL_MAX_BYTES = 131072;

// 전역, project(LOPHN.md), agent 순서다. 앱 층은 없다.
export type InstructionLayerKind = (typeof PROMPT_INSTRUCTION_LAYERS)[number];
export type InstructionStatus =
  | "present"
  | "absent"
  | "unavailable"
  | "invalid"
  | "too_large";

// 지침을 읽는 쪽이 보는 한 층의 파일. bytes는 처음부터 최대 INSTRUCTION_FILE_MAX_BYTES 만큼이다.
// 상한을 넘는 파일은 size_bytes로만 알면 되므로 끝까지 읽지 않는다.
export type InstructionFile = {
  size_bytes: number;
  bytes: Uint8Array;
};

// 읽기 통로는 읽기만 있다. 지침 파일 저장은 사람이 editor에서 파일을 저장하는 일이다. 어느 project의
// 파일인지는 통로가 이미 안다(그 session의 place).
export interface InstructionFiles {
  // 그 층의 지금 파일. 파일이 없으면 null(부재)이고 읽지 못하면 err다.
  read(layer: InstructionLayerKind): Promise<Result<InstructionFile | null>>;
}

// 한 층의 읽기 결과. 로컬 경로는 어느 칸에도 없다.
export type InstructionLayer = {
  kind: InstructionLayerKind;
  // project 층의 대상 id. global·agent는 null이다.
  place: string | null;
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
// Engineer는 세션이 가진 자리다. 탭 이동은 이 입력에 없다.
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

// 옛 assemblePrompt용. 새 입구는 turn.ts의 readTurnInstructions다.
export function instructionLayers(_place: WorkPlace): InstructionLayerKind[] {
  return ["global", "project", "agent"];
}

export type Inspected =
  | { status: "present"; text: string }
  | { status: "too_large" | "invalid"; reason: string };

// 상한을 넘으면 자르지 않고, UTF-8이 아니면 대체 문자로 바꾸지 않는다.
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
// 본문을 하나도 보내지 않고 멈춘다.
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
