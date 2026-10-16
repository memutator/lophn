// context API(command와 읽기)가 보는 상태의 모양과 바깥에서 받는 도구다. 시험은 이 모양을 메모리에
// 두고(testing.ts) 구현이 ledger 표에 옮겨도 같은 값이 나오는지를 본다.
// 값의 모양은 packages/protocol/projects/context-api.ts가 정한다.
import type { Result } from "../../../../base/mod.ts";
import type {
  BundleSummary,
  CheckReport,
  ContextValue,
  GlossaryEntry,
  SavedViewValue,
  StoredViolation,
} from "../../../../protocol/projects/mod.ts";

// 요청한 쪽. 실제 자격은 platform/identity가 정하고 여기서는 command가 가르는 구분만 둔다.
// actor는 ledger에 남는 문자열이다(`user`, `agent:ses_…`, `machine`, `coding_agent:…`).
export type ContextApiActor =
  | { kind: "user"; actor: string }
  // agent가 context를 쓸 수 있는지는 그 context의 project로 deps.canWrite가 정한다(mayWrite).
  | { kind: "agent"; actor: string }
  // 좁은 범위 credential은 context worker의 제출 두 가지만 낸다. agent_runtime은 agent runtime의 machine
  // 자격이고 turn 시작 전 재료 읽기(context.list·get·contract)만 한다.
  | {
    kind: "machine";
    actor: string;
    scope: "context_worker" | "agent_runtime" | "other";
  }
  | { kind: "coding_agent"; actor: string };

type EmittedEvent = {
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
  // 관계 간선: 관계 선언 순서대로, via 값(list면 항목 순서)마다 하나. index가 저장하고 `context.entity`가
  // 관계 대상을 찾을 때 읽는다. 없으면 간선이 없는 것과 같다.
  links?: readonly { relation: string; target_key: string }[];
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
  // context.list의 app 거르기가 쓰는, context별로 적용된 판이 app-data로 읽는 앱 ID들(context_app_data).
  // 읽는 앱이 있는 context만 들어 있다.
  appReaders: Map<string, readonly string[]>;
};

export type BlobReference = { hash: string; size_bytes: number };

// 새 판의 초안 폴더. 폴더에는 BundleContent 모양의 bundle.json 하나가 든다. 파일 IO는 바깥이 한다.
export interface ContextDrafts {
  folder(project: string, context: string, bundle: string): string;
  // 폴더와 bundle.json을 만든다. 이미 있으면 그대로 둔다.
  create(
    project: string,
    context: string,
    bundle: string,
    content: unknown,
  ): void;
  // bundle.json의 내용. 없거나 JSON이 아니면 invalid_input이다.
  read(project: string, context: string, bundle: string): Result<unknown>;
  // 폴더를 지우도록 맡긴다. command의 쓰기가 성공한 뒤에 지워진다.
  remove(project: string, context: string, bundle: string): void;
}

// 바깥에서 받는 도구. 시각·ID·hash는 주입해서 시험이 매번 같게 돈다.
export type ContextApiDeps = {
  now(): string;
  newId(prefix: "cbn" | "chk" | "viw"): string;
  // 정규 JSON의 sha256(hex)이다. submit이 bundle_hash를 이 함수로 계산한다.
  hash(value: unknown): string;
  // 값의 blob 참조(hash와 크기)를 돌려준다(event payload가 쓴다). 파일을 쓰지 않는다: 바이트는 호출 경계가
  // 이미 준비했고, 참조 등록은 adapter가 같은 transaction에서 한다.
  putBlob(value: unknown): BlobReference;
  // 있으면 event를 이 함수로 내고 돌려받은 실제 seq를 쓴다(ledger 위에서는 tx.emit이다). actor는
  // 호출한 쪽의 자격에서 정해지므로 payload에 싣지 않는다. 없으면 상태의 seq를 하나 올려 정한다.
  emit?(event: {
    type: string;
    subject: string;
    actor: string;
    payload: Record<string, unknown>;
  }): string;
  // 그 project의 context를 쓸 수 있는 actor인가. 그 project의 Project Manager이거나 사람이다.
  canWrite(actor: string, project: string): boolean;
  drafts: ContextDrafts;
  // context.record_violations가 마지막으로 기록한 위반 키(violationKey)들. 새 위반을 집합으로 가린다.
  recordedViolations(context: string): readonly string[];
  keepViolations(context: string, keys: readonly string[]): void;
};

// context를 쓸 수 있는 actor: 사람이거나 그 context의 project의 Project Manager인 agent.
export function mayWrite(
  deps: Pick<ContextApiDeps, "canWrite">,
  actor: ContextApiActor,
  project: string,
): boolean {
  return actor.kind === "user" ||
    (actor.kind === "agent" && deps.canWrite(actor.actor, project));
}
