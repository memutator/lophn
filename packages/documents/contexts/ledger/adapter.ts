// context API 순수 handler(api/)를 platform ledger 위에 올리는 adapter의 spec이다.
// handler는 다시 쓰지 않는다. 각 command는 이 흐름으로 감싼다.
//
//   1. 적재. 이 command가 보는 행만 SQL에서 새 ContextApiState로 읽는다.
//        - state.seq = ledgerHead(tx.sql). state.replays는 비운다(멱등은 platform envelope가 한다).
//        - state.projects = 입력의 project (context.create). 없거나 보관됐으면 handler가 invalid_input.
//        - state.contexts = 대상 context (+ context.create는 그 project의 context 전부: 제목 유일 검사,
//          그리고 입력 id의 context: 다른 project의 같은 id를 conflict로 막으려면 필요하다).
//        - glossary.set의 새 항목은 입력 id의 항목도 읽는다(다른 context가 쓰는 id는 conflict).
//        - state.bundles / checks / views / glossary = 대상 context의 것. 판의 content는 blob이라 아래 표의
//          "content" 칸이 yes인 판만 deps.blobs.read로 읽는다. 읽지 않은 판의 content는 `{}`이고 handler가
//          쓰지 않으며, 바뀌지 않았으면 다시 쓰지 않는다(content_ref를 그대로 둔다).
//        - state.violations / entities / indexFailing = deps.index(derived 저장소). ledger에 없다.
//      대상 context는 입력에서 찾는다: context 입력은 그대로, bundle·check·view·entry 입력은
//      contextOf(sql, kind, id)로. 대상이 없으면 적재를 비우고 handler가 not_found를 낸다.
//   2. actor. mapActor(ctx, deps)로 platform ctx를 ContextApiActor로 바꾼다.
//   3. 실행. createContextApiCommands(state, handlerDeps)의 handler를 부른다.
//        handlerDeps.now = tx.now, newId = tx.newId, hash = deps.hash,
//        putBlob = (value) => deps.blobs.put(tx, value) (같은 value는 한 번만 올린다),
//        startHandOffRun = (request) => deps.startHandOffRun(tx, request) 한 뒤
//        state.seq = ledgerHead(tx.sql). Run을 만들면서 다른 concern이 낸 event가 head를 밀기 때문에,
//        이어서 낼 ContextViolationsHandedOff의 seq를 그 뒤로 맞춘다.
//   4. 실패(Result err)면 아무것도 쓰지 않고 emit하지 않고 그 err를 돌려준다.
//   5. 성공이면 state.events를 순서대로 tx.emit(정의, subject, payload)로 낸다.
//        정의는 CONTEXT_API_EVENTS에서 type으로 찾는다. 없으면 internal.
//        tx.emit이 돌려준 seq가 handler가 그 event에 매긴 seq와 다르면 internal이다
//        (revision이 seq라서 어긋난 채 두면 CAS가 깨진다). transaction은 rollback된다.
//   6. 쓰기. 적재한 값과 handler가 남긴 값을 표마다 비교해 달라진 행만 쓴다
//        (변경 행 한도 1000에 event 행이 든다). 순서: 검사, 물러나는 판(applied가 아니게 된 것),
//        applied가 된 판, context, saved view, 용어 항목, 지운 saved view·항목 순. 물러나는 판을 먼저
//        쓰는 까닭은 context당 applied가 하나라는 partial unique index가 문장마다 검사되기 때문이다.
//        새 content는 handler가 올린 blob 참조(content_ref)를 쓴다.
//        그리고 handler가 돌려준 값의 시각과 ledger event 시각이 갈라지면(용어 updated_at) event의
//        at으로 맞춘다.
//
// command마다 적재하는 범위:
//
// | command                       | 대상 context 찾기      | 적재                          | content |
// |-------------------------------|------------------------|-------------------------------|---------|
// | context.create                | 입력의 project, id     | project, project의 context 전부 | no      |
// | context.archive / unarchive   | input.context          | context                       | no      |
// | bundle.save_draft             | input.context          | context, 판, (검사 없음)       | no      |
// | bundle.discard_draft          | contextOf(bundle)      | context, 판                   | no      |
// | bundle.submit                 | contextOf(bundle)      | context, 판, 검사             | draft 판 |
// | bundle.finish_check           | contextOf(check)       | context, 판, 검사, saved view | 검사한 판 |
// | bundle.rollback               | input.context          | context, 판, saved view       | 되돌릴 판 |
// | view.save                     | input.context          | context, 판, saved view       | 적용된 판 |
// | view.update                   | contextOf(view)        | context, 판, saved view       | 적용된 판 |
// | view.delete                   | contextOf(view)        | context, saved view           | no      |
// | context.record_violations     | input.context          | context, 판                   | no      |
// | context.hand_off_violations   | input.context          | context, 판, 위반(index)      | 적용된 판 |
// | glossary.set (새 항목)        | input.context          | context, 용어 항목, 입력 id의 항목 | no   |
// | glossary.set (기존)·remove    | contextOf(entry)       | context, 용어 항목            | no      |
//
// 읽기도 같은 적재를 읽기 snapshot(`snapshot.sql`)으로 하고 state.seq = Number(snapshot.as_of_seq)다.
// 읽기마다 적재 범위: context.list는 project와 그 context·판(content 없음), context.get·bundles·
// glossary.list·violations는 대상 context의 것, context.saved_views(깨진 view 표시)·overview·search는
// 적용된 판의 content, context.containing은 project의 active context들의 적용된 판 content다.
// 위반·개체·index 갱신 실패는 deps.index가 준다.
//
// platform이 주지 않아 deps로 받는 것: blob 읽기·올리기, 위반 넘김 Run 만들기, Context Engineer 판별,
// derived index. 자세한 문제는 PR 본문의 doubts를 본다.
import type { Result } from "../../../base/mod.ts";
import type { StoredViolation } from "../../../contracts/documents/mod.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  RequestContext,
  Tx,
} from "../../../contracts/platform/mod.ts";
import type { SearchExecutor } from "../api/reads.ts";
import type {
  BlobReference,
  ContextApiActor,
  EntityRow,
} from "../api/state.ts";

// content blob을 읽고 올린다. platform/blob-store가 구현한다.
export interface ContextBlobs {
  // 참조가 가리키는 BundleContent JSON을 읽는다. 없거나 hash가 다르면 internal이다.
  read(reference: BlobReference): Result<Record<string, unknown>>;
  // 값을 올리고 참조를 돌려준다(tx.registerBlobRef로 소유 변경과 같은 transaction에 등록한다).
  put(tx: Tx, value: unknown): BlobReference;
}

// derived 저장소(개체, 위반, index 신선도)다. ledger 표가 아니고 index 작업(ctx-I-index)이 구현한다.
// adapter는 이 port로만 읽는다. 위반 수는 ledger(contexts.violation_mark)에, 위반 목록은 여기에 있다.
export interface ContextIndexPort {
  // context의 위반 목록. 계산하지 않았으면 빈 목록이다.
  violations(context: string): readonly StoredViolation[];
  // 적용된 판의 개체. 검색과 overview가 쓴다.
  entities(context: string): readonly EntityRow[];
  // 읽기 전 index 갱신이 실패한 context다. 읽기는 빈 결과로 꾸미지 않고 unavailable을 낸다.
  failing(context: string): boolean;
}

export type ContextLedgerDeps = {
  blobs: ContextBlobs;
  index: ContextIndexPort;
  // 선언 검색 실행기(search/의 순수 함수).
  execute: SearchExecutor;
  // 정규 JSON의 sha256(hex). bundle_hash를 계산한다.
  hash(value: unknown): string;
  // 위반을 Context Engineer에게 넘기는 Run을 같은 transaction에서 만든다.
  startHandOffRun(
    tx: Tx,
    request: {
      context: string;
      evidence: BlobReference;
      violations: readonly StoredViolation[];
    },
  ): string;
  // `agent:asg_…`의 assignment가 Context Engineer 역할인가.
  isContextEngineer(assignment: string): boolean;
};

// context worker의 좁은 machine 자격이 가지는 operation이다(credential scope.operations).
export const CONTEXT_WORKER_OPERATIONS = [
  "bundle.finish_check",
  "context.record_violations",
] as const;

// platform ctx를 handler의 actor로 바꾼다.
//   user -> user, coding_agent:… -> coding_agent,
//   agent:asg_… -> agent (isContextEngineer면 context_engineer, 아니면 other),
//   machine -> machine (scope.operations가 비어 있지 않고 모두 CONTEXT_WORKER_OPERATIONS이면
//              context_worker, 아니면 other).
// route의 actors 목록에 없는 app:… 자격은 envelope가 먼저 막지만 여기서도 forbidden이다.
export function mapActor(
  _ctx: RequestContext,
  _deps: Pick<ContextLedgerDeps, "isContextEngineer">,
): Result<ContextApiActor> {
  throw new Error("not implemented");
}

// CONTEXT_API_COMMAND_ROUTES의 route마다 CommandDefinition 하나, 위의 흐름대로.
export function contextLedgerCommands(
  _deps: ContextLedgerDeps,
): readonly CommandDefinition[] {
  throw new Error("not implemented");
}

// CONTEXT_API_READ_ROUTES의 route마다 ReadDefinition 하나.
export function contextLedgerReads(
  _deps: ContextLedgerDeps,
): readonly ReadDefinition[] {
  throw new Error("not implemented");
}
