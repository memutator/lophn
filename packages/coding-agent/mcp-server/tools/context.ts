// lophn_context tool의 실행이다(T17, mcp#R17). list·show·items·glossary·of는 소유 읽기
// route 하나로만 보내고, propose는 고정 변경안 문서를 저장하는 통로 하나다. 이 tool은
// context·term command를 부르지 않는다: 제안만으로 context·용어는 바뀌지 않고 run도
// 질문도 만들지 않는다(Q14). 사람의 결정을 coding agent가 적용하는 통로는 없다.
import { MCP_DECISION_ROUTES } from "../../../contracts/coding-agent/mod.ts";
import type { Route } from "../../../contracts/platform/mod.ts";
import {
  describeContextProposal,
  describeContextProposalFailure,
  type FlowClient,
  type PrepareBytes,
  proposeContextChange,
} from "../../connection/mod.ts";
import { failureOutput, type ToolOutput, withoutOp } from "./output.ts";

export type ContextToolDeps = {
  client: FlowClient;
  // propose가 변경안 문서 bytes를 core의 blob 준비로 보내는 통로다. 읽기 op는 쓰지 않는다.
  prepareBytes: PrepareBytes;
};

type Perspective = "basis" | "reference" | "watch";
type Entry = { perspective: Perspective; kind?: string };

const READ_OPS = ["list", "show", "items", "glossary", "of"] as const;
type ReadOp = (typeof READ_OPS)[number];

// context는 문서가 속한 곳이 아니라 읽는 관점이다. 모델이 자리와 섞지 않게 매번 알린다.
const PERSPECTIVE_NOTE =
  "context는 문서의 소속이 아니라 읽는 관점이다. 문서의 자리는 따로 있다";

function isReadOp(op: unknown): op is ReadOp {
  return typeof op === "string" && (READ_OPS as readonly string[]).includes(op);
}

// 소유 읽기 입력에서 tool 선택자(op)와 tool 전용 filter(perspective)를 뗀다. 소유 route
// 입력은 strict라 둘을 모른다.
function ownerInput(raw: unknown): Record<string, unknown> {
  const { op: _op, perspective: _perspective, ...rest } = (raw ?? {}) as Record<
    string,
    unknown
  >;
  return rest;
}

function counts(entries: readonly Entry[]) {
  const out = { basis: 0, reference: 0, watch: 0 };
  for (const entry of entries) out[entry.perspective] += 1;
  return out;
}

function itemsSummary(
  title: string,
  entries: readonly Entry[],
  complete: boolean,
  selected: Perspective | undefined,
): string {
  const total = counts(entries);
  const part = selected === undefined
    ? `기준 ${total.basis}·참고 ${total.reference}·watch ${total.watch}`
    : `${PERSPECTIVE_LABEL[selected]} ${total[selected]}`;
  return `${title}: ${part}${complete ? "" : " (이어 읽을 항목이 더 있다)"}`;
}

const PERSPECTIVE_LABEL: Record<Perspective, string> = {
  basis: "기준",
  reference: "참고",
  watch: "watch",
};

export function createContextTool(
  deps: ContextToolDeps,
): (toolName: string, route: Route, input: unknown) => Promise<ToolOutput> {
  const routes = MCP_DECISION_ROUTES.lophn_context as unknown as Record<
    ReadOp,
    Route
  >;
  return async function runContextTool(_toolName, _route, rawInput) {
    const op = (rawInput as { op?: unknown } | undefined)?.op;
    if (op === "propose") return await propose(deps, rawInput);
    if (!isReadOp(op)) {
      // 표에 없는 op는 실행하지 않는다. 생성·수정·적용 op는 이 tool에 없다.
      return failureOutput({
        code: "invalid_input",
        message: "context tool 표에 없는 op다",
        details: { op: typeof op === "string" ? op : null },
      }, ["lophn_context list, show, items, glossary, of, propose만 있다"]);
    }
    const read = await deps.client.read(routes[op], ownerInput(rawInput));
    if (!read.ok) {
      // 범위 밖 context는 없는 것과 같은 오류가 그대로 온다.
      return failureOutput(read.error, [
        "lophn_context list로 읽을 수 있는 context를 다시 읽는다",
      ]);
    }
    const value = read.value as Record<string, unknown>;
    return describeRead(op, value, rawInput);
  };
}

function describeRead(
  op: ReadOp,
  value: Record<string, unknown>,
  rawInput: unknown,
): ToolOutput {
  if (op === "list") {
    const rows = (value.contexts as { status?: string }[] | undefined) ?? [];
    const archived = rows.filter((row) => row.status === "archived").length;
    return {
      summary: `context ${rows.length}개${
        archived > 0 ? ` (보관 ${archived}개 포함)` : ""
      }. ${PERSPECTIVE_NOTE}`,
      data: value,
      next: [
        "lophn_context show로 항목과 이유를 읽는다",
        "lophn_context items로 기준·참고·watch 항목을 관점별로 읽는다",
      ],
    };
  }
  if (op === "show") {
    const context = value.context as {
      title?: string;
      items?: Entry[];
      status?: string;
    };
    const total = counts(context.items ?? []);
    return {
      summary: `${
        context.title ?? "context"
      }: 기준 ${total.basis}·참고 ${total.reference}·watch ${total.watch}${
        context.status === "archived" ? " (보관됨)" : ""
      }. ${PERSPECTIVE_NOTE}`,
      data: value,
      next: [
        "lophn_context items로 항목의 읽을 수 있는 고정 판과 구역 상태를 읽는다",
        "lophn_context glossary로 용어를 읽는다",
      ],
    };
  }
  if (op === "items") {
    const selected = (rawInput as { perspective?: Perspective }).perspective;
    const shaped = selected === undefined ? value : onlyPerspective(
      value,
      selected,
    );
    const entries = (shaped.entries as Entry[] | undefined) ?? [];
    const complete = value.complete !== false;
    return {
      summary: `${
        itemsSummary(
          (value.title as string | undefined) ?? "context",
          entries,
          complete,
          selected,
        )
      }. ${PERSPECTIVE_NOTE}`,
      data: shaped,
      next: complete
        ? [
          "lophn_read로 항목의 고정 판 본문을 읽는다",
          "lophn_context glossary로 용어 정의와 후보를 읽는다",
        ]
        : ["next_cursor로 lophn_context items를 이어 읽는다"],
    };
  }
  if (op === "glossary") {
    const definitions = (value.definitions as unknown[] | undefined) ?? [];
    const candidates = (value.candidates as unknown[] | undefined) ?? [];
    return {
      summary:
        `용어 정의 ${definitions.length}개, 후보 ${candidates.length}개. 후보는 사람이 정의하기 전의 이름이다`,
      data: value,
      next: [
        "정의를 바꾸거나 새 용어를 올리려면 lophn_context propose로 변경안을 낸다. 정의 확정은 사람이 한다",
      ],
    };
  }
  const rows = (value.contexts as unknown[] | undefined) ?? [];
  return {
    summary: `이 대상을 참조하는 context ${rows.length}개. ${PERSPECTIVE_NOTE}`,
    data: value,
    next: ["lophn_context show로 항목의 관점과 이유를 읽는다"],
  };
}

// items의 perspective filter다. 선택한 관점의 항목만 남기고 같은 순서를 지킨다.
function onlyPerspective(
  value: Record<string, unknown>,
  selected: Perspective,
): Record<string, unknown> {
  const entries = ((value.entries as Entry[] | undefined) ?? []).filter(
    (entry) => entry.perspective === selected,
  );
  const perspectives = value.perspectives as
    | Record<Perspective, unknown[]>
    | undefined;
  return {
    ...value,
    entries,
    ...(perspectives === undefined
      ? {}
      : { perspectives: { [selected]: perspectives[selected] ?? [] } }),
  };
}

async function propose(
  deps: ContextToolDeps,
  rawInput: unknown,
): Promise<ToolOutput> {
  const outcome = await proposeContextChange(deps, withoutOp(rawInput));
  if (!outcome.ok) {
    return { ...describeContextProposalFailure(outcome.error), isError: true };
  }
  return describeContextProposal(outcome.value);
}
