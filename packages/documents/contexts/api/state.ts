// context API(command와 읽기)가 보는 상태의 모양과 바깥에서 받는 도구다. 시험은 이 모양을 메모리에
// 두고(testing.ts) 구현이 ledger 표에 옮겨도 같은 값이 나오는지를 본다. 값의 뜻은
// docs/domain-model/documents/contexts.md와 terms.md가 정하고, 값의 모양은
// packages/contracts/documents/context-api.ts가 정한다.
import type {
  BundleSummary,
  CheckReport,
  ContextValue,
  GlossaryEntry,
  SavedViewValue,
  StoredViolation,
} from "../../../contracts/documents/mod.ts";

// 요청한 쪽. 실제 자격은 platform/identity가 정하고 여기서는 command가 가르는 구분만 둔다.
// actor는 ledger에 남는 문자열이다(`user`, `agent:asg_…`, `machine`, `coding_agent:cac_…`).
export type ContextApiActor =
  | { kind: "user"; actor: string }
  // Context Engineer는 assignment의 역할이다. 다른 agent는 읽기만 한다.
  | { kind: "agent"; actor: string; role: "context_engineer" | "other" }
  // 좁은 범위 credential은 context worker의 제출 두 가지만 낸다.
  | { kind: "machine"; actor: string; scope: "context_worker" | "other" }
  | { kind: "coding_agent"; actor: string };

export type EmittedEvent = {
  seq: string;
  type: string;
  subject: string;
  actor: string;
  at: string;
  payload: Record<string, unknown>;
};

export type BundleRow = BundleSummary & {
  // blob에 둘 content다. submit 뒤에는 바뀌지 않는다.
  content: Record<string, unknown>;
};

// index가 계산해 둔 개체(derived). 읽기가 선언 검색을 돌릴 때 쓴다.
export type EntityRow = {
  type: string;
  key: string;
  path: string;
  section: string | null;
  fields: Record<string, unknown>;
};

export type ContextApiState = {
  // 마지막으로 낸 event seq. revision은 이 seq다.
  seq: number;
  projects: Map<string, { id: string; archived: boolean }>;
  contexts: Map<string, ContextValue>;
  bundles: Map<string, BundleRow>;
  checks: Map<string, CheckReport>;
  views: Map<string, SavedViewValue>;
  glossary: Map<string, GlossaryEntry>;
  events: EmittedEvent[];
  // idempotency key → 처음 결과. 같은 key의 되풀이는 처음 결과를 돌려준다.
  replays: Map<string, unknown>;
  // derived store: context별 위반과 개체
  violations: Map<string, StoredViolation[]>;
  entities: Map<string, EntityRow[]>;
  // 읽기 전 index 갱신이 실패하는 context. 읽기는 빈 결과로 꾸미지 않고 unavailable이다.
  indexFailing: Set<string>;
};

export type BlobReference = { hash: string; size_bytes: number };

// 바깥에서 받는 도구. 시각·ID·hash는 주입해서 시험이 매번 같게 돈다.
export type ContextApiDeps = {
  now(): string;
  newId(prefix: "cbn" | "chk" | "viw" | "run"): string;
  // 정규 JSON의 sha256(hex)이다. submit이 bundle_hash를 이 함수로 계산한다.
  hash(value: unknown): string;
  // 값을 blob에 두고 참조를 돌려준다(event payload가 쓴다).
  putBlob(value: unknown): BlobReference;
  // 있으면 event를 이 함수로 내고 돌려받은 실제 seq를 쓴다(ledger 위에서는 tx.emit이다). actor는
  // 호출한 쪽의 자격에서 정해지므로 payload에 싣지 않는다. 없으면 상태의 seq를 하나 올려 정한다.
  emit?(event: {
    type: string;
    subject: string;
    actor: string;
    payload: Record<string, unknown>;
  }): string;
  // 위반을 Context Engineer에게 넘기는 Run을 만든다. 근거는 command가 만들어 넘긴다.
  startHandOffRun(request: {
    context: string;
    evidence: BlobReference;
    violations: readonly StoredViolation[];
  }): string;
};
