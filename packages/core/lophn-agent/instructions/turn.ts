import { sha256Hex } from "../../../base/mod.ts";
import {
  PROMPT_INSTRUCTION_LAYERS,
  type WorkspaceKind,
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
  // 실제로 읽은 파일 이름(LOPHN.md 또는 CLAUDE.md). 전역·project 층만 있고 그 밖이거나 부재면 null이다.
  file: string | null;
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
  return { layer, status: "absent", text: null, hash: null, file: null };
}

// 전역 → project → agent 순서(PROMPT_INSTRUCTION_LAYERS)로 읽는다. home은 workspace가 없어 project 층이
// 비어 있다. deps.files는 그 session에 묶인 읽기다(instructionFilesOverCore).
export async function readTurnInstructions(
  deps: InstructionDeps,
  session: { kind: WorkspaceKind },
): Promise<TurnInstructions> {
  const layers: TurnInstructionLayer[] = [];
  const blocked = (
    layer: InstructionLayerKind,
    reason: "unavailable" | "invalid" | "too_large",
    message: string,
  ) => ({ status: "blocked" as const, layer, reason, message });
  // 한 층의 파일 하나. 읽은 본문과 파일 이름(부재면 null)이나 막힘을 준다.
  const readFile = async (layer: InstructionLayerKind) => {
    const read = await deps.files.read(layer);
    if (!read.ok) {
      return blocked(
        layer,
        "unavailable",
        `${layer} instruction could not be read`,
      );
    }
    if (read.value === null) return null;
    const inspected = inspectInstruction(read.value);
    if (inspected.status !== "present") {
      return blocked(
        layer,
        inspected.status,
        `${layer} instruction: ${inspected.reason}`,
      );
    }
    return { text: inspected.text, file: read.value.name ?? null };
  };
  for (const layer of PROMPT_INSTRUCTION_LAYERS) {
    if (layer === "project" && session.kind === "home") {
      layers.push(absent(layer));
      continue;
    }
    const read = await readFile(layer);
    if (read !== null && "status" in read) return read;
    const raw = read?.text ?? null;
    const file = read?.file ?? null;
    if (raw === null) {
      layers.push(absent(layer));
      continue;
    }
    const text = await deps.redact(raw);
    if (text === null) {
      return blocked(
        layer,
        "unavailable",
        `${layer} instruction redaction did not finish`,
      );
    }
    layers.push({
      layer,
      status: "present",
      text,
      hash: await sha256Hex(text),
      file,
    });
  }
  return { status: "ready", layers };
}
