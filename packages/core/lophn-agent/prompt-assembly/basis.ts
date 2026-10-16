import { canonicalize, sha256Hex } from "../../../base/mod.ts";
import type { PlaceAgent, PlaceContext } from "./place-info.ts";

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
  // 이름 순. glossary는 용어집 hash다.
  contexts: { name: string; version: string; glossary: string }[];
  // `role name (place)` 꼴, 정렬
  agents: string[];
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function agentKey(agent: PlaceAgent): string {
  return `${agent.role} ${agent.name}${
    agent.place === null ? "" : ` (${agent.place})`
  }`;
}

export async function basisOf(input: {
  instructions: InstructionTexts;
  tool_names: readonly string[];
  contexts: readonly PlaceContext[];
  agents: readonly PlaceAgent[];
}): Promise<SeenBasis> {
  const instructions = {} as SeenBasis["instructions"];
  for (const layer of INSTRUCTION_LAYERS) {
    instructions[layer] = await sha256Hex(input.instructions[layer]);
  }
  const contexts: SeenBasis["contexts"] = [];
  for (const c of input.contexts) {
    contexts.push({
      name: c.name,
      version: c.version,
      glossary: await sha256Hex(canonicalize(c.text?.glossary ?? [])),
    });
  }
  contexts.sort((a, b) => cmp(a.name, b.name));
  return {
    instructions,
    tools: [...input.tool_names].sort(cmp),
    contexts,
    agents: input.agents.map(agentKey).sort(cmp),
  };
}

type ListChange = { added: string[]; removed: string[] };

export type BasisDiff = {
  instructions: InstructionLayerName[];
  tools: ListChange | null;
  contexts: (ListChange & { refreshed: string[] }) | null;
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
  const before = new Map(seen.contexts.map((c) => [c.name, c]));
  const refreshed = now.contexts.filter((c) => {
    const old = before.get(c.name);
    return old !== undefined &&
      (old.version !== c.version || old.glossary !== c.glossary);
  }).map((c) => c.name);
  const names = listChange(
    seen.contexts.map((c) => c.name),
    now.contexts.map((c) => c.name),
  );
  return {
    instructions: INSTRUCTION_LAYERS.filter((layer) =>
      seen.instructions[layer] !== now.instructions[layer]
    ),
    tools: listChange(seen.tools, now.tools),
    contexts: names === null && refreshed.length === 0
      ? null
      : { added: names?.added ?? [], removed: names?.removed ?? [], refreshed },
    agents: listChange(seen.agents, now.agents),
  };
}
