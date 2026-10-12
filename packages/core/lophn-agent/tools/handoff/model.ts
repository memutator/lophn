import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../../../base/mod.ts";
import {
  handoffAllowed,
  type HandoffContent,
  type HandoffReference,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { SqlParams, SqlRow } from "../../../../protocol/server/mod.ts";
import {
  type BlobFieldDefinition,
  defineBlobField,
} from "../../../../protocol/storage/mod.ts";

// 순수 함수와 읽기 조회만 있다. handoff는 별도 entity·ID·상태·대기열이 없다
// (domain-model lophn-agent/handoff). 받는 run의 source handoff 가지가 접수의
// 사실이고 그 내용은 이 값의 blob 하나다. 그래서 이 leaf에는 표가 없다.

// 내용 blob은 받는 run이 소유하는 영구 참조다. 일반 blob.read로는 열지 않는다.
export const HANDOFF_BODY_OWNER_KIND = "run";
export const HANDOFF_BODY_FIELD = "handoff_content";
export const HANDOFF_CONTENT_PURPOSE = "handoff_content";

// 무엇·왜·제외·기대 결과만 담는 짧은 설명이다. 이 상한은 설명이 대화 원문 복사로
// 커지는 것을 줄일 뿐 의미상의 복사를 막는다고 하지 않는다. 복사 방어는
// 구조(필드 넷만), 출처 검증(보낸 run·원래 요청·고정 version), redaction이다.
export const HANDOFF_CONTENT_MAX_BYTES = 16 * 1024;

export const handoffBodyFields: readonly BlobFieldDefinition[] = [
  defineBlobField({
    owner_kind: HANDOFF_BODY_OWNER_KIND,
    field: HANDOFF_BODY_FIELD,
    retention: { kind: "permanent" },
    general_read: false,
  }),
];

// 내용의 정규 직렬화 bytes. core가 같은 bytes로 blob을 준비하고 command가 같은
// 값에서 같은 hash를 다시 만든다.
export function handoffContentBytes(content: HandoffContent): Uint8Array {
  return new TextEncoder().encode(canonicalize(content));
}

export function handoffBodyHash(content: HandoffContent): string {
  return createHash("sha256").update(handoffContentBytes(content)).digest(
    "hex",
  );
}

export type BodyBlob = {
  hash: string;
  evidence: {
    preparation: string;
    principal: string;
    purpose: string;
    hash: string;
    size_bytes: number;
  };
};

export function bodyBlob(principal: string, content: HandoffContent): BodyBlob {
  const bytes = handoffContentBytes(content);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return {
    hash,
    evidence: {
      preparation: hash,
      principal,
      purpose: HANDOFF_CONTENT_PURPOSE,
      hash,
      size_bytes: bytes.length,
    },
  };
}

// 허용 방향은 contracts의 선언 그대로다. 양쪽 실제 assignment의 역할로만 묻는다.
export function directionAllowed(from: string, to: string): boolean {
  return handoffAllowed(from, to);
}

type Lookup = {
  sql: {
    get: (query: string, params: SqlParams) => SqlRow | undefined;
    all: (query: string, params: SqlParams) => SqlRow[];
  };
};

export type SenderRun = {
  id: string;
  assignment: string;
  state: string;
  source: { kind: string; message?: string; original_message?: string };
};

export function loadRunRef(lookup: Lookup, id: string): SenderRun | undefined {
  const row = lookup.sql.get(
    "select id, assignment, state, source from runs where id = ?",
    [id],
  );
  return row === undefined ? undefined : {
    id: String(row["id"]),
    assignment: String(row["assignment"]),
    state: String(row["state"]),
    source: JSON.parse(String(row["source"])) as SenderRun["source"],
  };
}

export type AssignmentRef = { role: string; state: string; revision: number };

export function loadAssignmentRef(
  lookup: Lookup,
  id: string,
): AssignmentRef | undefined {
  const row = lookup.sql.get(
    "select role, state, revision from assignments where id = ?",
    [id],
  );
  return row === undefined ? undefined : {
    role: String(row["role"]),
    state: String(row["state"]),
    revision: Number(row["revision"]),
  };
}

// 원래 사람 요청. 사람 요청에서 시작한 run은 그 message, handoff로 이어진 run은 받은
// original_message다. 주기 run은 사람 요청이 아니라서 없다.
export function humanOrigin(source: SenderRun["source"]): string | null {
  if (source.kind === "message" && source.message !== undefined) {
    return source.message;
  }
  if (source.kind === "handoff" && source.original_message !== undefined) {
    return source.original_message;
  }
  return null;
}

export type HandoffRun = {
  id: string;
  assignment: string;
  state: string;
  result: string | null;
  sender_run: string;
  dedup_key: string;
  source: string;
  accepted_seq: string;
};

const HANDOFF_COLUMNS =
  `id, assignment, state, result, source_sender_run, source_dedup_key, source, accepted_seq`;

function handoffRunOf(row: SqlRow): HandoffRun {
  return {
    id: String(row["id"]),
    assignment: String(row["assignment"]),
    state: String(row["state"]),
    result: row["result"] === null ? null : String(row["result"]),
    sender_run: String(row["source_sender_run"]),
    dedup_key: String(row["source_dedup_key"]),
    source: String(row["source"]),
    accepted_seq: String(row["accepted_seq"]),
  };
}

// 같은 보낸 run·중복 방지 key의 받는 run. 있으면 접수 유일성이 이미 확정된 것이다.
export function loadByDedup(
  lookup: Lookup,
  senderRun: string,
  dedupKey: string,
): HandoffRun | undefined {
  const row = lookup.sql.get(
    `select ${HANDOFF_COLUMNS} from runs
     where source_kind = 'handoff' and source_sender_run = ? and source_dedup_key = ?`,
    [senderRun, dedupKey],
  );
  return row === undefined ? undefined : handoffRunOf(row);
}

export function loadHandoffRun(
  lookup: Lookup,
  receiverRun: string,
): HandoffRun | undefined {
  const row = lookup.sql.get(
    `select ${HANDOFF_COLUMNS} from runs
     where id = ? and source_kind = 'handoff'`,
    [receiverRun],
  );
  return row === undefined ? undefined : handoffRunOf(row);
}

// 채택 질문의 답. 질문은 answered이고 고른 선택지의 adoption이 이 고정 판과 같아야 한다
// (R3). 다른 판의 채택 답이나 최신 주소는 거절한다. 선택지·답의 원본은 questions 표이고
// 질문이 답으로 닫혔는지는 질문이 든 묶음(question_groups)의 상태가 정한다.
export function adoptionOf(
  lookup: Lookup,
  question: string,
): { document: string; version: string; section: string | null } | undefined {
  const row = lookup.sql.get(
    `select g.status as status, q.answer as answer, q.options as options
     from questions q join question_groups g on g.id = q."group"
     where q.id = ?`,
    [question],
  );
  if (row === undefined || row["status"] !== "answered") return undefined;
  if (row["answer"] === null) return undefined;
  const answer = JSON.parse(String(row["answer"])) as {
    kind?: string;
    option_key?: string | null;
  };
  if (answer.kind !== "option" || typeof answer.option_key !== "string") {
    return undefined;
  }
  const options = JSON.parse(String(row["options"])) as {
    key: string;
    adoption:
      | { document: string; version: string; section: string | null }
      | null;
  }[];
  const chosen = options.find((option) => option.key === answer.option_key);
  return chosen?.adoption ?? undefined;
}

// 근거 검사. 근거 고정 판이 하나도 없으면 시작하지 않고 질문을 단 근거는 그
// 질문의 채택 답과 같은 판이어야 한다. App Engineer에게 가는 일은 설계가 일의 근거라서
// 채택한 판 하나는 있어야 한다.
export function checkReferences(
  lookup: Lookup,
  toRole: string,
  references: readonly HandoffReference[],
): Result<void> {
  if (references.length === 0) {
    return err({
      code: "invalid_input",
      message: "a handoff needs at least one fixed version",
    });
  }
  const seen = new Set<string>();
  let adopted = 0;
  for (const reference of references) {
    const key = `${reference.document}:${reference.version}:${
      reference.section ?? ""
    }:${reference.question ?? ""}`;
    if (seen.has(key)) {
      return err({
        code: "invalid_input",
        message: "duplicate fixed version reference",
      });
    }
    seen.add(key);
    if (reference.question === null) continue;
    const adoption = adoptionOf(lookup, reference.question);
    if (
      adoption === undefined || adoption.document !== reference.document ||
      adoption.version !== reference.version
    ) {
      return err({
        code: "invalid_input",
        message: "the question does not adopt this fixed version",
      });
    }
    adopted += 1;
  }
  if (toRole === "app_engineer" && adopted === 0) {
    return err({
      code: "invalid_input",
      message: "a handoff to an app engineer needs an adopted version",
    });
  }
  return ok(undefined);
}

// 같은 요청의 재전송인지. 접수 유일성은 (보낸 run, 중복 방지 key)가 정하므로 재전송이
// 새 수신 run id를 들고 와도 같은 요청이면 먼저 접수한 run을 돌려준다. 같은 key에 다른
// 수신 assignment·원래 요청·내용·근거면 접수 유일성을 깨므로 거절한다.
export function sameHandoff(
  prior: HandoffRun,
  input: {
    receiver_assignment: string;
    original_message: string;
    body: string;
    references: readonly HandoffReference[];
  },
  senderRun: string,
  dedupKey: string,
): boolean {
  return prior.assignment === input.receiver_assignment &&
    canonicalize(JSON.parse(prior.source)) === canonicalize({
        kind: "handoff",
        sender_run: senderRun,
        original_message: input.original_message,
        body: input.body,
        references: input.references,
        dedup_key: dedupKey,
      });
}
