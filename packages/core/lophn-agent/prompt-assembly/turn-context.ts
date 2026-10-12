import { sha256Hex } from "../../../base/mod.ts";
import type {
  ViewTab,
  WorkspaceReadOutput,
} from "../../../protocol/shell/mod.ts";
import { wireData } from "../safety/mod.ts";
import type { TurnContextBasis } from "./model.ts";

// 매 judgment turn의 동적 context다(concern lophn-agent/harness/prompt-assemble). 호출마다 새로
// 만들고 이전 turn의 값을 기억하지 않는다. 결과 문자열은 포장·8 KiB 제한을 끝낸 하나이거나 null이며
// `assemblePrompt`가 최신 메시지 끝에 그대로 붙인다.

export const TURN_CONTEXT_MAX_BYTES = 8192;
export const TURN_CONTEXT_MAX_TABS = 20;
export const TURN_CONTEXT_SUMMARY_MAX_BYTES = 2048;

// 화면을 모으지 못한 이유. 세션이 없는 주기 run은 "no_session", relay read가 실패하면
// "collect_failed"다. 나머지는 relay가 알려 준 부재다.
export type TurnContextView =
  | WorkspaceReadOutput
  | { availability: "no_session" | "collect_failed" };

export type TurnContextInput = {
  // 이번 turn 직전의 UTC 시각(`...Z`).
  collected_at: string;
  timezone: string | null;
  view: TurnContextView;
  // 이번 turn에 읽은 모든 tab page를 이은 탭. current일 때만 쓴다.
  tabs: readonly ViewTab[];
};

export type TurnContextDeps = {
  // 화면 글의 redaction. 끝내지 못하면 null이고 그 값은 넣지 않는다.
  redact(text: string): string | null | Promise<string | null>;
};

export type TurnContext = {
  text: string | null;
  basis: TurnContextBasis;
};

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

// 탭 종류마다 줄에 쓰는 대상 문자열이다. 종류를 더하면 contracts의 ViewTab과 함께 여기에 한 줄을 더해야
// 컴파일된다.
type TabTarget = {
  [K in ViewTab["kind"]]: (tab: Extract<ViewTab, { kind: K }>) => string;
};

const TAB_TARGET: TabTarget = {
  document_editor: (tab) => tab.document,
  terminal: (tab) => tab.project_folder,
  app_panel: (tab) =>
    `${tab.app} ${tab.surface}${
      tab.view_session === undefined ? "" : ` view_session=${tab.view_session}`
    }`,
  contexts: () => "list",
  // Agents·Agent 탭은 view에 종류와 선택만 싣는다. 대화 내용과 대상은 넣지 않는다.
  agents: () => "list",
  agent: () => "conversation",
  context: (tab) => `${tab.context} ${tab.sub_tab}`,
  search: (tab) =>
    `${tab.context}${
      tab.declared_search === undefined ? "" : ` search=${tab.declared_search}`
    }`,
};

function tabLine(tab: ViewTab): string {
  const describe = TAB_TARGET[tab.kind] as (tab: ViewTab) => string;
  return `- ${tab.selected ? "* " : ""}${tab.kind} ${tab.key} ${describe(tab)}`;
}

type Plan = {
  tabs: { tab: ViewTab; line: string }[];
  omitted: number;
  summary: string | null;
  // 앱 요약이 없을 때 밝히는 이유.
  summary_note: string;
};

async function render(
  input: TurnContextInput,
  plan: Plan,
  absent: string | null,
): Promise<string> {
  const head = [
    "[turn context]",
    `UTC: ${input.collected_at}`,
    `timezone: ${input.timezone ?? "알 수 없음"}`,
  ];
  if (absent !== null) {
    head.push(`화면: 없음 (${absent})`);
    return head.join("\n");
  }
  const view = input.view as Extract<
    WorkspaceReadOutput,
    { availability: "current" }
  >;
  head.push(
    `화면 관측: ${view.observed_at} (generation ${view.generation})`,
    `탭: ${plan.tabs.length}개 표시, ${plan.omitted}개 생략`,
  );
  const body: string[] = [];
  if (plan.tabs.length > 0) body.push(plan.tabs.map((t) => t.line).join("\n"));
  if (plan.summary !== null) body.push(`앱 요약:\n${plan.summary}`);
  head.push(
    plan.summary === null ? `앱 요약: ${plan.summary_note}` : "앱 요약: 아래",
  );
  if (body.length === 0) return head.join("\n");
  const wired = await wireData(body.join("\n"), {
    kind: "workspace_view",
    address: "workspace",
    collected_at: view.observed_at,
  });
  return `${head.join("\n")}\n${wired.wrapped}`;
}

// 초점 탭을 먼저 남기고 탭 20개·앱 요약 2 KiB·전체 8 KiB를 지킨다. 줄이는 순서는 초점 아닌 탭 끝 →
// 앱 요약 → 초점 탭이고, 줄이면 생략 수를 센다.
export async function buildTurnContext(
  deps: TurnContextDeps,
  input: TurnContextInput,
): Promise<TurnContext> {
  const absent = input.view.availability === "current"
    ? null
    : input.view.availability;
  const basis: TurnContextBasis = {
    collected_at: input.collected_at,
    timezone: input.timezone,
    workspace_generation: null,
    observed_at: null,
    tabs: [],
    focused_key: null,
    omitted_count: 0,
    app_summary: { included: false, bytes: 0 },
    unavailable: [],
    text_hash: null,
    bytes: 0,
  };
  if (absent !== null) {
    basis.unavailable = ["no_workspace", absent];
    const text = await render(
      input,
      { tabs: [], omitted: 0, summary: null, summary_note: "" },
      absent,
    );
    return finish(basis, text);
  }
  const view = input.view as Extract<
    WorkspaceReadOutput,
    { availability: "current" }
  >;
  basis.workspace_generation = view.generation;
  basis.observed_at = view.observed_at;

  // 초점(선택) 탭이 앞, 나머지는 화면 순서. redaction을 못 끝낸 탭은 넣지 않고 생략으로 센다.
  const focusFirst = [
    ...input.tabs.filter((tab) => tab.selected),
    ...input.tabs.filter((tab) => !tab.selected),
  ];
  const candidates: Plan["tabs"] = [];
  const lines = await Promise.all(
    focusFirst.map((tab) => deps.redact(tabLine(tab))),
  );
  focusFirst.forEach((tab, index) => {
    const line = lines[index]!;
    if (line !== null && candidates.length < TURN_CONTEXT_MAX_TABS) {
      candidates.push({ tab, line });
    }
  });
  const focusedCount = candidates.filter((c) => c.tab.selected).length;

  let summary: string | null = await deps.redact(view.summary);
  let note = "없음";
  if (summary === null) {
    basis.unavailable.push("redacted");
    note = "생략 (redaction 실패)";
  } else if (summary.trim() === "") summary = null;
  else if (byteLength(summary) > TURN_CONTEXT_SUMMARY_MAX_BYTES) {
    summary = null;
    basis.unavailable.push("app_summary_over_limit");
    note = "생략 (2 KiB 초과, 상세는 앱 read tool로 읽는다)";
  }

  const plan = (keep: number, withSummary: boolean): Plan => ({
    tabs: candidates.slice(0, keep),
    omitted: input.tabs.length - Math.min(keep, candidates.length),
    summary: withSummary ? summary : null,
    summary_note: withSummary ? note : "생략 (8 KiB 예산)",
  });
  let text = await render(input, plan(candidates.length, true), null);
  let chosen = plan(candidates.length, true);
  const fits = (value: string) => byteLength(value) <= TURN_CONTEXT_MAX_BYTES;
  for (
    let keep = candidates.length - 1;
    !fits(text) && keep >= focusedCount;
    keep--
  ) {
    chosen = plan(keep, true);
    text = await render(input, chosen, null);
  }
  if (!fits(text)) {
    chosen = plan(focusedCount, false);
    text = await render(input, chosen, null);
  }
  if (!fits(text)) {
    chosen = plan(0, false);
    text = await render(input, chosen, null);
  }
  if (!fits(text)) return finish(basis, null);

  basis.tabs = chosen.tabs.map(({ tab }) => ({
    key: tab.key,
    kind: tab.kind,
    selected: tab.selected,
  }));
  basis.focused_key = chosen.tabs.find((c) => c.tab.selected)?.tab.key ?? null;
  basis.omitted_count = chosen.omitted;
  basis.app_summary = {
    included: chosen.summary !== null,
    bytes: chosen.summary === null ? 0 : byteLength(chosen.summary),
  };
  if (summary !== null && chosen.summary === null) {
    basis.unavailable.push("app_summary_over_budget");
  }
  return finish(basis, text);
}

async function finish(
  basis: TurnContextBasis,
  text: string | null,
): Promise<TurnContext> {
  if (text !== null) {
    basis.bytes = byteLength(text);
    basis.text_hash = await sha256Hex(text);
  }
  return { text, basis };
}
