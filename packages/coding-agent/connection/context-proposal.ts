// context 변경 제안의 접수 통로다(mcp#R17, cli#R19). MCP `lophn_context propose`와 CLI
// `context propose`가 같은 흐름을 쓴다: 입력 검사 → 대상 context 읽기 → 고정 변경안
// 문서 만들기 → 문서 저장(upload·prepare·save, documents/versions). 여기서 context·용어
// command는 부르지 않는다: 제안은 변경안 문서만 남기고 context·용어는 그대로다. run도
// 질문도 만들지 않는다. 적용은 사람이 변경안 주소를 Context Engineer에게 맡겨 질문으로
// 이을 때 사람의 답으로만 일어난다(Q14).
import { z } from "zod";
import {
  err,
  type LophnError,
  ok,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import { contextProposeFields } from "../../contracts/coding-agent/mod.ts";
import { contextGet } from "../../contracts/documents/mod.ts";
import {
  type FlowClient,
  type SavedDocument,
  saveDocument,
} from "./document-save.ts";
import {
  type PrepareBytes,
  type SubmittedFile,
  toDocumentFiles,
} from "./submission.ts";

const proposalSchema = z.strictObject(contextProposeFields);

export type ContextChange = z.infer<typeof contextProposeFields.change>;
export type ContextProposalInput = z.input<typeof proposalSchema>;

// 변경안 문서의 파일 이름과 형식이다. 문서 안 본문은 사람이 읽는 markdown이고 기계가
// 읽는 변경안은 `lophn-context-change/1` JSON 한 덩어리다.
export const PROPOSAL_PATH = "context-change.md";
export const PROPOSAL_SCHEMA = "lophn-context-change/1";

export type ContextProposalDeps = {
  client: FlowClient;
  prepareBytes: PrepareBytes;
};

export type ContextProposalOutcome = {
  kind: ContextChange["kind"];
  // 대상 context다. create는 새로 만들 context ID다.
  context: string | null;
  // 제안을 만들 때 읽은 context revision이다. create·term_update는 null이다.
  context_revision: string | null;
  // 항목 변경이 추가인지 기존 항목의 변경인지다. set_item이 아니면 null이다.
  item_effect: "add_item" | "change_item" | null;
  saved: SavedDocument;
};

type ContextView = {
  title: string;
  revision: string;
  items: { target: Record<string, unknown>; perspective: string }[];
};

function targetKey(target: Record<string, unknown>): string {
  return target.kind === "document"
    ? `document\u0000${target.document}\u0000${target.section ?? ""}`
    : `app_command\u0000${target.app}\u0000${target.command}`;
}

const KIND_LABEL: Record<ContextChange["kind"], string> = {
  create: "생성",
  rename: "이름 변경",
  set_item: "항목 추가·관점 변경",
  remove_item: "항목 제거",
  term_propose: "용어 추가",
  term_update: "채택 변경",
};

function reject(
  code: LophnError["code"],
  message: string,
  details?: Record<string, unknown>,
): Result<never, LophnError> {
  return err({ code, message, ...(details ? { details } : {}) });
}

// 폴더·untracked 파일은 context 항목이 될 수 없다. 항목은 저장한 문서(와 구역)나 앱
// command만 가리킨다. 거절 이유를 항목 위치와 함께 말한다.
function invalidInput(error: z.ZodError): LophnError {
  const issue = error.issues[0];
  const path = issue?.path.join(".") ?? "";
  const targetIssue = error.issues.find((item) =>
    item.path.includes("target") || item.path.includes("items")
  );
  if (targetIssue !== undefined) {
    return {
      code: "invalid_input",
      message:
        "context 항목은 저장한 문서나 앱 command만 가리킨다. 폴더나 untracked 파일은 먼저 문서로 저장한다",
      details: { field: targetIssue.path.join(".") },
    };
  }
  return {
    code: "invalid_input",
    message: path === ""
      ? "변경안 입력이 맞지 않다"
      : `${path}: 입력이 맞지 않다`,
    details: { field: path },
  };
}

// 대상 context를 읽는다. 범위 밖이거나 없으면 같은 not_found다(존재를 새지 않는다).
async function readContext(
  client: FlowClient,
  id: string,
): Promise<Result<ContextView, LophnError>> {
  const read = await client.read(contextGet, { context: id });
  if (!read.ok) return read;
  const context = (read.value as { context: ContextView }).context;
  return ok(context);
}

function targetContext(change: ContextChange): string | null {
  switch (change.kind) {
    case "create":
      return change.id;
    case "rename":
    case "set_item":
    case "remove_item":
    case "term_propose":
      return change.context;
    case "term_update":
      return null;
  }
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function submitted(bytes: Uint8Array, hash: string): SubmittedFile {
  return {
    path: PROPOSAL_PATH,
    media_type: "text/markdown",
    bytes: bytes.byteLength,
    blob_hash: hash,
    primary: true,
    open: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  };
}

// 변경안 문서 본문이다. 시각·사람 값은 넣지 않아 같은 제안이 같은 bytes가 된다.
export function proposalText(
  change: ContextChange,
  reason: string,
  basis: {
    context: string | null;
    title: string | null;
    revision: string | null;
    item_effect: ContextProposalOutcome["item_effect"];
  },
): string {
  const label = basis.item_effect === "change_item"
    ? "관점 변경"
    : basis.item_effect === "add_item"
    ? "항목 추가"
    : KIND_LABEL[change.kind];
  const record = {
    schema: PROPOSAL_SCHEMA,
    kind: change.kind,
    context: basis.context,
    context_revision: basis.revision,
    change,
    reason,
  };
  return [
    `# Context 변경안: ${label}${
      basis.title === null ? "" : ` (${basis.title})`
    }`,
    "",
    "이 문서는 변경안이다. 제안만 있고 context와 용어는 바뀌지 않았다. 적용은 사람이 정한다.",
    "",
    `- 종류: ${KIND_LABEL[change.kind]}`,
    `- 대상 context: ${basis.context ?? "없음"}`,
    `- 읽은 context revision: ${basis.revision ?? "없음"}`,
    "",
    "## 이유",
    "",
    reason,
    "",
    "## 변경안",
    "",
    "````json",
    JSON.stringify(record, null, 2),
    "````",
    "",
  ].join("\n");
}

// 제안을 받아 고정 변경안 문서로 저장한다. context·용어 command는 부르지 않는다.
export async function proposeContextChange(
  deps: ContextProposalDeps,
  raw: unknown,
): Promise<Result<ContextProposalOutcome, LophnError>> {
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) return err(invalidInput(parsed.error));
  const { change, reason, idempotency_key } = parsed.data;

  const id = targetContext(change);
  let view: ContextView | null = null;
  if (id !== null) {
    const read = await readContext(deps.client, id);
    if (change.kind === "create") {
      // 이미 있는 ID는 적용할 수 없는 제안이다. 없거나 읽을 수 없으면 새 context다.
      if (read.ok) {
        return reject("conflict", "이미 있는 context ID다", { context: id });
      }
    } else {
      if (!read.ok) return read;
      view = read.value;
    }
  }

  let itemEffect: ContextProposalOutcome["item_effect"] = null;
  if (view !== null && change.kind === "set_item") {
    const key = targetKey(change.item.target);
    itemEffect = view.items.some((item) => targetKey(item.target) === key)
      ? "change_item"
      : "add_item";
  }
  if (view !== null && change.kind === "remove_item") {
    const key = targetKey(change.target);
    if (!view.items.some((item) => targetKey(item.target) === key)) {
      // 없는 항목을 빼는 제안은 적용할 수 없다.
      return reject("not_found", "그 항목이 context에 없다", {
        context: id,
      });
    }
  }

  const text = proposalText(change, reason, {
    context: id,
    title: view?.title ?? null,
    revision: view?.revision ?? null,
    item_effect: itemEffect,
  });
  const bytes = encode(text);
  const hash = await sha256Hex(bytes);
  const files = await toDocumentFiles(
    [submitted(bytes, hash)],
    deps.prepareBytes,
  );
  if (!files.ok) return files;
  const saved = await saveDocument(deps.client, {
    files: files.value,
    title: `Context 변경안: ${KIND_LABEL[change.kind]}`,
    ...(idempotency_key === undefined ? {} : { idempotency_key }),
  });
  if (!saved.ok) return saved;
  return ok({
    kind: change.kind,
    context: id,
    context_revision: view?.revision ?? null,
    item_effect: itemEffect,
    saved: saved.value.saved,
  });
}

export type ContextProposalReport = {
  summary: string;
  data: unknown;
  next: string[];
};

// 접수 결과다. 변경안 주소와 "사람이 Context Engineer에게 맡기라"는 안내만 낸다.
// 제안만으로 context·용어는 바뀌지 않았고 run도 질문도 만들지 않았다는 사실을 data에
// 남긴다.
export function describeContextProposal(
  outcome: ContextProposalOutcome,
): ContextProposalReport {
  const { saved } = outcome;
  const address = `${saved.document}@${saved.version}`;
  const verb = saved.status === "saved"
    ? "변경안을 문서로 저장했다"
    : "같은 변경안이 이미 있다";
  return {
    summary:
      `${verb}: ${address}. 제안만 있어 context와 용어는 바뀌지 않았다. 사람이 이 주소를 Context Engineer에게 맡긴다`,
    data: {
      proposal: {
        status: saved.status,
        document: saved.document,
        version: saved.version,
        reference: saved.reference,
        address,
      },
      kind: outcome.kind,
      context: outcome.context,
      context_revision: outcome.context_revision,
      item_effect: outcome.item_effect,
      // 제안은 변경안 문서만 남긴다.
      applied: false,
      run_created: false,
      question_created: false,
      handoff: "사람이 변경안 주소를 Context Engineer에게 맡겨 질문으로 잇는다",
    },
    next: [
      `사람에게 변경안 주소(${address})를 알리고 Context Engineer에게 맡기라고 안내한다`,
      "lophn_question list로 사람의 질문이 생겼는지 읽는다. 질문 생성은 coding agent가 하지 않는다",
      "lophn_read로 저장된 변경안 문서를 확인한다",
    ],
  };
}

export function describeContextProposalFailure(
  error: LophnError,
): ContextProposalReport {
  return {
    summary: error.message,
    data: { code: error.code, details: error.details ?? {} },
    next: error.code === "invalid_input"
      ? [
        "lophn_context 입력을 고쳐 다시 제안한다. 폴더나 untracked 파일은 먼저 문서로 저장한다",
      ]
      : [
        "lophn_context show·items로 context 현재 상태를 읽은 뒤 다시 제안한다",
      ],
  };
}
