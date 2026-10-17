import { canonicalize, sha256Hex } from "../../../base/mod.ts";
import { toWireToolName } from "../../../protocol/lophn-agent/tool-catalog.ts";
import { renderContextText } from "./context-text.ts";
import { inputBudget, measureWire } from "./budget.ts";
import {
  type BasisDiff,
  basisOf,
  diffBasis,
  INSTRUCTION_LAYERS,
  type InstructionTexts,
  type SeenBasis,
} from "./basis.ts";
import { noticeInput } from "./input-tags.ts";
import { historyMessages } from "./layers.ts";
import type {
  BlockedReason,
  CacheBoundary,
  HistoryMessage,
  ModelLimits,
  PlaceAgent,
  PlaceContext,
  PromptMessage,
  PromptRequest,
  PromptTool,
  SystemBlock,
  SystemLayerKind,
  WirePacker,
} from "./model.ts";
import { type SkillListItem, skillListText } from "./skill-list.ts";

// turn 하나의 prompt를 5장 순서로 조립한다: role 지침과 고정 규칙, 지침 층, skill 목록, place 정보,
// 대화. 지침은 file이 아니라 값으로 받는다(turn 시작에 읽는 쪽이 따로 있다). I/O는 호출하는 쪽이 한다.

export type TurnPromptInput = {
  // 제품 고정 규칙을 포함한 role 지침 글.
  role_prompt: string;
  // 정본 이름이다. model에는 `toWireToolName`을 거쳐 보낸다. 목록은 session을 시작할 때 고정한다.
  tools: readonly PromptTool[];
  instructions: InstructionTexts;
  skills: readonly SkillListItem[];
  // role 층이 만든 place 정보. 글과 notice·판 비교가 쓰는 보이는 context와 agent다.
  place: {
    text: string;
    contexts: readonly PlaceContext[];
    agents: readonly PlaceAgent[];
    // project가 없는 place면 context 글에 project 이름을 싣는다.
    show_project: boolean;
  };
  history: readonly HistoryMessage[];
  // 지난 turn이 본 판. 없으면(첫 turn, compact) notice를 붙이지 않는다.
  seen?: SeenBasis;
  limits: ModelLimits;
  reserved_output: number;
};

type TurnPromptDeps = { pack: WirePacker };

export type TurnPromptResult =
  | {
    status: "ready";
    request: PromptRequest;
    // 이번 turn이 본 판. 호출하는 쪽이 session 기록에 써 다음 turn의 seen으로 쓴다.
    basis: SeenBasis;
    diff: BasisDiff | null;
    cache_boundaries: CacheBoundary[];
    input_budget: number;
    measured_tokens: number;
  }
  | { status: "blocked"; reason: BlockedReason; message: string };

const INSTRUCTION_TITLE = {
  global: "Global instructions",
  project: "Project instructions (LOPHN.md)",
  agent: "Agent instructions",
} as const;

function instructionsBlock(texts: InstructionTexts): string {
  const sections = INSTRUCTION_LAYERS.flatMap((layer) =>
    texts[layer].trim() === ""
      ? []
      : [`## ${INSTRUCTION_TITLE[layer]}\n${texts[layer]}`]
  );
  return sections.length === 0
    ? ""
    : ["# Instructions", ...sections].join("\n\n");
}

function wire(names: readonly string[]): string {
  return names.map(toWireToolName).join(", ");
}

function changeText(
  label: string,
  change: { added: string[]; removed: string[] },
  show: (names: string[]) => string = (n) => n.join(", "),
): string {
  const parts: string[] = [];
  if (change.added.length > 0) parts.push(`Added: ${show(change.added)}.`);
  if (change.removed.length > 0) {
    parts.push(`Removed: ${show(change.removed)}.`);
  }
  return `${label} ${parts.join(" ")}`;
}

// 바뀐 것마다 notice 하나다. program이 쓴 고정 문장만 쓰고 앱이 쓴 글은 넣지 않는다: 앞부분이 turn마다 같아야 prefix cache가 맞는다.
function noticesOf(diff: BasisDiff, input: TurnPromptInput): string[] {
  const notices: string[] = [];
  if (diff.instructions.length > 0) {
    const body = diff.instructions.map((layer) => {
      const text = input.instructions[layer].trim();
      return `## ${INSTRUCTION_TITLE[layer]}\n${
        text === "" ? "(empty now)" : text
      }`;
    });
    notices.push(
      noticeInput({
        kind: "instructions_changed",
        body: [
          "The instructions changed. The new text of each changed layer:",
          ...body,
        ]
          .join("\n\n"),
      }),
    );
  }
  if (diff.tools !== null) {
    notices.push(noticeInput({
      kind: "tools_changed",
      body: changeText("The tools changed.", diff.tools, wire),
    }));
  }
  if (diff.contexts !== null) {
    const { added, removed, refreshed } = diff.contexts;
    const visible = input.place.contexts;
    const shown = new Set([...added, ...refreshed]);
    const texts = visible.flatMap((c) =>
      shown.has(c.name) && c.text !== null
        ? [
          renderContextText(c.text, "full", {
            project: input.place.show_project,
          }),
        ]
        : []
    );
    const lines = [changeText("The contexts changed.", { added, removed })];
    if (refreshed.length > 0) {
      lines.push(
        `New version or glossary: ${
          refreshed.join(", ")
        }. The new text follows.`,
      );
    }
    notices.push(
      [
        noticeInput({ kind: "contexts_changed", body: lines.join("\n") }),
        ...texts,
      ]
        .join("\n"),
    );
  }
  if (diff.agents !== null) {
    notices.push(noticeInput({
      kind: "agents_changed",
      body: changeText("The agents you can call changed.", diff.agents),
    }));
  }
  return notices;
}

function changed(diff: BasisDiff): boolean {
  return diff.instructions.length > 0 || diff.tools !== null ||
    diff.contexts !== null || diff.agents !== null;
}

// notice는 대화 끝에 덧붙인다. 마지막이 user message가 아니면 새 user message로 둔다.
function appendNotices(
  messages: PromptMessage[],
  notices: readonly string[],
): PromptMessage[] {
  if (notices.length === 0) return messages;
  const parts = notices.map((text) => ({ kind: "text" as const, text }));
  const last = messages[messages.length - 1];
  if (last !== undefined && last.role === "user") {
    return [...messages.slice(0, -1), {
      role: "user",
      parts: [...last.parts, ...parts],
    }];
  }
  return [...messages, { role: "user", parts }];
}

// 경계 표시가 달리는 층. role 끝의 marker가 앞선 tools 목록도 덮는다.
const CACHED: readonly SystemLayerKind[] = ["role", "instructions", "place"];

export async function assembleTurnPrompt(
  input: TurnPromptInput,
  deps: TurnPromptDeps,
): Promise<TurnPromptResult> {
  if (input.role_prompt.trim() === "") {
    return {
      status: "blocked",
      reason: "role_missing",
      message: "role 지침이 없다",
    };
  }
  const budget = inputBudget(input.limits, input.reserved_output);
  if (!budget.ok) {
    return {
      status: "blocked",
      reason: "invalid_budget",
      message: budget.error.message,
    };
  }

  const texts: [SystemLayerKind, string][] = [
    ["role", input.role_prompt],
    ["instructions", instructionsBlock(input.instructions)],
    ["skills", skillListText(input.skills)],
    ["place", input.place.text],
  ];
  const system: SystemBlock[] = texts.filter(([, text]) => text !== "")
    .map(([layer, text]) => ({ layer, text, cache: CACHED.includes(layer) }));

  const tools: PromptTool[] = input.tools
    .map((t) => ({
      name: toWireToolName(t.name),
      description: t.description,
      input_schema: JSON.parse(canonicalize(t.input_schema)),
    })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

  const basis = await basisOf({
    instructions: input.instructions,
    tool_names: input.tools.map((t) => t.name),
    contexts: input.place.contexts,
    agents: input.place.agents,
  });
  const diff = input.seen === undefined ? null : diffBasis(input.seen, basis);
  const notices = diff !== null && changed(diff) ? noticesOf(diff, input) : [];

  const request: PromptRequest = {
    system,
    tools,
    messages: appendNotices(historyMessages(input.history), notices),
  };
  const measured = measureWire(deps.pack(request));
  if (measured > budget.value) {
    return {
      status: "blocked",
      reason: "input_over_budget",
      message: "입력이 입력 예산을 넘는다",
    };
  }

  const cache_boundaries: CacheBoundary[] = [];
  let prefix = await sha256Hex(canonicalize(tools));
  for (const block of system) {
    prefix = await sha256Hex(`${prefix}\n${block.text}`);
    if (block.cache !== false) {
      cache_boundaries.push({ after: block.layer, prefix_hash: prefix });
    }
  }
  return {
    status: "ready",
    request,
    basis,
    diff,
    cache_boundaries,
    input_budget: budget.value,
    measured_tokens: measured,
  };
}
