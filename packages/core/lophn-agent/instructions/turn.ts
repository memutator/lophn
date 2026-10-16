import { sha256Hex } from "../../../base/mod.ts";
import {
  PROMPT_INSTRUCTION_LAYERS,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  inspectInstruction,
  type InstructionDeps,
  type InstructionLayerKind,
} from "./model.ts";

// turn 시작에 한 번 읽는 지침이다. 도는 turn은 이 결과를 끝까지 쓰고, 바뀐 것은 다음 turn 시작에 hash로 알아본다.

export type TurnInstructionLayer = {
  layer: InstructionLayerKind;
  status: "present" | "absent";
  // redaction을 거친 본문. 부재면 null이다.
  text: string | null;
  // 본문의 sha256. 부재면 null이다.
  hash: string | null;
};

// 사람이 쓴 지침은 조용히 빼지 않는다: 한 층이라도 읽지 못했거나 상한을 넘으면 turn을 시작하지 않는다.
type TurnInstructions =
  | { status: "ready"; layers: TurnInstructionLayer[] }
  | {
    status: "blocked";
    layer: InstructionLayerKind;
    reason: "unavailable" | "invalid" | "too_large";
    message: string;
  };

function absent(layer: InstructionLayerKind): TurnInstructionLayer {
  return { layer, status: "absent", text: null, hash: null };
}

// 전역 → project → agent 순서(PROMPT_INSTRUCTION_LAYERS)로 읽는다. lophn은 place가 없어 project 층이 비어 있다.
// deps.files는 그 session에 묶인 읽기다(instructionFilesOverCore).
export async function readTurnInstructions(
  deps: InstructionDeps,
  session: { role: Role },
): Promise<TurnInstructions> {
  const layers: TurnInstructionLayer[] = [];
  for (const layer of PROMPT_INSTRUCTION_LAYERS) {
    if (layer === "project" && session.role === "lophn") {
      layers.push(absent(layer));
      continue;
    }
    const read = await deps.files.read(layer);
    if (!read.ok) {
      return {
        status: "blocked",
        layer,
        reason: "unavailable",
        message: `${layer} instruction could not be read`,
      };
    }
    if (read.value === null) {
      layers.push(absent(layer));
      continue;
    }
    const inspected = inspectInstruction(read.value);
    if (inspected.status !== "present") {
      return {
        status: "blocked",
        layer,
        reason: inspected.status,
        message: `${layer} instruction: ${inspected.reason}`,
      };
    }
    const text = await deps.redact(inspected.text);
    if (text === null) {
      return {
        status: "blocked",
        layer,
        reason: "unavailable",
        message: `${layer} instruction redaction did not finish`,
      };
    }
    layers.push({
      layer,
      status: "present",
      text,
      hash: await sha256Hex(text),
    });
  }
  return { status: "ready", layers };
}
