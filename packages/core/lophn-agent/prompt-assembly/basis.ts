import { sha256Hex } from "../../../base/mod.ts";
import type { PlaceAgent } from "./model.ts";

// 지난 turn이 본 prompt의 판이다. turn이 시작할 때 지금 판과 비교해 바뀐 것마다 notice를 만든다.
// 이름 목록은 "무엇이 더해지고 빠졌는지"를 쓰려고 hash가 아니라 목록으로 둔다. 긴 글(지침, 용어집)은 hash다.
// session 기록에 쓰는 일은 호출하는 쪽이 한다.

export const INSTRUCTION_LAYERS = ["global", "project", "agent"] as const;
type InstructionLayerName = (typeof INSTRUCTION_LAYERS)[number];

// 층별 지침 전문. 없는 층은 빈 문자열이다.
export type InstructionTexts = Record<InstructionLayerName, string>;

export type SeenBasis = {
  instructions: Record<InstructionLayerName, string>;
  // 정본 tool 이름, 이름 순
  tools: string[];
  // 이름, 정렬
  agents: string[];
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function agentLine(agent: PlaceAgent): string {
  return agent.name;
}

export async function basisOf(input: {
  instructions: InstructionTexts;
  tool_names: readonly string[];
  agents: readonly PlaceAgent[];
}): Promise<SeenBasis> {
  const instructions = {} as SeenBasis["instructions"];
  for (const layer of INSTRUCTION_LAYERS) {
    instructions[layer] = await sha256Hex(input.instructions[layer]);
  }
  return {
    instructions,
    tools: [...input.tool_names].sort(cmp),
    agents: input.agents.map(agentLine).sort(cmp),
  };
}

type ListChange = { added: string[]; removed: string[] };

export type BasisDiff = {
  instructions: InstructionLayerName[];
  tools: ListChange | null;
  agents: ListChange | null;
};

function listChange(
  before: readonly string[],
  after: readonly string[],
): ListChange | null {
  const was = new Set(before);
  const now = new Set(after);
  const added = after.filter((x) => !was.has(x));
  const removed = before.filter((x) => !now.has(x));
  return added.length === 0 && removed.length === 0 ? null : { added, removed };
}

// 순수 함수다. 바뀐 것이 없으면 모든 칸이 비어 있다.
export function diffBasis(seen: SeenBasis, now: SeenBasis): BasisDiff {
  return {
    instructions: INSTRUCTION_LAYERS.filter(
      (layer) => seen.instructions[layer] !== now.instructions[layer],
    ),
    tools: listChange(seen.tools, now.tools),
    agents: listChange(seen.agents, now.agents),
  };
}
