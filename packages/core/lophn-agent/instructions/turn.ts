import { sha256Hex } from "../../../base/mod.ts";
import {
  PROMPT_INSTRUCTION_LAYERS,
  type PlaceKind,
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

// 그 agent가 맡은 domain 하나. purpose는 예산을 넘어 본문을 뺄 때 한 줄로 싣는다.
export type TurnDomain = { id: string; name: string; purpose: string };

// domain 층 글자 수 예산이다. 넘으면 앞 domain부터 채우고 나머지는 본문 없이 purpose 한 줄만 싣는다.
export const DOMAIN_TEXT_BUDGET = 24000;

function absent(layer: InstructionLayerKind): TurnInstructionLayer {
  return { layer, status: "absent", text: null, hash: null };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 전역 → project → domain → agent 순서(PROMPT_INSTRUCTION_LAYERS)로 읽는다. home은 place가 없어 project 층이
// 비어 있다. domain 층은 맡은 domain의 DOMAIN.md를 이름순으로 `## <name>` 아래 한 글로 잇는다(고정 순서와 제목이라
// 같은 재료는 같은 bytes다). deps.files는 그 session에 묶인 읽기다(instructionFilesOverCore).
export async function readTurnInstructions(
  deps: InstructionDeps,
  session: { kind: PlaceKind },
  domains: readonly TurnDomain[],
): Promise<TurnInstructions> {
  const layers: TurnInstructionLayer[] = [];
  const blocked = (
    layer: InstructionLayerKind,
    reason: "unavailable" | "invalid" | "too_large",
    message: string,
  ) => ({ status: "blocked" as const, layer, reason, message });
  // 한 층의 파일 하나. 읽은 본문(부재면 null)이나 막힘을 준다.
  const readFile = async (layer: InstructionLayerKind, domain?: string) => {
    const read = await deps.files.read(layer, domain);
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
    return inspected.text;
  };
  for (const layer of PROMPT_INSTRUCTION_LAYERS) {
    if (layer === "project" && session.kind === "home") {
      layers.push(absent(layer));
      continue;
    }
    let raw: string | null;
    if (layer === "domain") {
      const parts: string[] = [];
      let used = 0;
      for (const domain of [...domains].sort((a, b) => cmp(a.name, b.name))) {
        const body = await readFile(layer, domain.id);
        if (typeof body === "object" && body !== null) return body;
        if (body === null || body.trim() === "") continue;
        const full = `## ${domain.name}\n${body.trim()}`;
        // 예산을 한 번 넘기면 그 domain부터 뒤는 모두 본문 없이 싣는다.
        if (used + full.length <= DOMAIN_TEXT_BUDGET) {
          used += full.length;
          parts.push(full);
        } else {
          used = DOMAIN_TEXT_BUDGET + 1;
          parts.push(
            [`## ${domain.name}`, domain.purpose, "full text: read DOMAIN.md"]
              .filter((line) => line.trim() !== "")
              .join("\n"),
          );
        }
      }
      raw = parts.length === 0 ? null : parts.join("\n\n");
    } else {
      const read = await readFile(layer);
      if (typeof read === "object" && read !== null) return read;
      raw = read;
    }
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
    });
  }
  return { status: "ready", layers };
}
