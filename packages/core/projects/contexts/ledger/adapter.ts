// context API 순수 handler(api/)를 platform ledger 위에 올리는 adapter다.
// handler는 다시 쓰지 않는다. 각 command는 이 흐름으로 감싼다. 1은 adapter-load.ts, 3~6은
// adapter-run.ts와 adapter-save.ts, route마다의 적재 범위는 adapter-routes.ts에 있다.
//
//   1. 적재. 이 command가 보는 행만 SQL에서 새 ContextApiState로 읽는다.
//        - state.seq는 0, state.replays는 비운다. seq는 미리 읽거나 짐작하지 않는다: event는 handler가
//          deps.emit으로 내고 ledger가 정한 실제 seq를 돌려받는다. 멱등은 platform envelope가 한다.
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
//   1.5. 앱 하나에 묶인 agent(`conditions.app`)는 app-bound.ts가 먼저 막는다: command는 모두, 읽기는
//        get·contract·overview·glossary.list 중 그 앱을 app-data로 읽는 context만, 목록은 그 줄만 남긴다.
//        읽는 앱은 context_app_data 표(판을 적용할 때 채운다)에서 낸다. 막힌 것은 없는 대상과 같은 not_found다.
//   2. actor. mapActor(ctx)로 platform ctx를 ContextApiActor로 바꾼다.
//   3. 실행. createContextApiCommands(state, handlerDeps)의 handler를 부른다.
//        handlerDeps.now = command를 시작할 때 부른 tx.now()의 값(platform 시계는 부를 때마다 달라질 수
//        있어 한 transaction에 시각 하나를 고정한다), newId = tx.newId, hash = deps.hash,
//        putBlob = (value) => 값의 참조(hash, 크기)만 계산한다(파일을 쓰지 않는다. 같은 value는 한 참조),
//        canWrite = tx.port(contextAuthorityPort).canWrite (그 project의 Project Manager이거나 사람),
//        recordedViolations·keepViolations = context_violation_keys 표,
//        emit = (event) => tx.emit(CONTEXT_API_EVENTS에서 type으로 찾은 정의, event.subject, event.payload).
//        없는 type이면 던진다(internal). actor는 tx의 자격에서 정해지므로 넘기지 않는다.
//        handler는 돌려받은 seq를 revision으로 쓴다. 그래서 같은 transaction에서 다른 concern이 낸 event
//        (blob 등록)가 사이에 끼어도 seq가 어긋나지 않는다. head를 읽거나 맞추는 일이 없다.
//   4. 실패(Result err)면 아무것도 쓰지 않고 그 err를 돌려준다. handler는 거절을 낼 때까지 emit하지
//      않는다(검사가 emit 앞이다).
//   5. 성공이면 event는 이미 냈다(3). handler가 가리킨 content blob의 영구 참조를 tx.registerBlobRef로
//        등록한다(준비는 호출 경계가 요청 자격으로 끝냈다. 준비가 없으면 err). 실패하면 platform이
//        transaction을 rollback하므로 낸 event도 참조도 사라진다.
//   6. 쓰기. 적재한 값과 handler가 남긴 값을 표마다 비교해 달라진 행만 쓴다
//        (변경 행 한도 1000에 event 행이 든다). 순서: 검사, 물러나는 판(applied가 아니게 된 것),
//        applied가 된 판, context, saved view, 용어 항목, 지운 saved view·항목 순. 물러나는 판을 먼저
//        쓰는 까닭은 context당 applied가 하나라는 partial unique index가 문장마다 검사되기 때문이다.
//        새 content는 handler가 올린 blob 참조(content_ref)를 쓴다. 용어 updated_at은 handler가 본
//        tx.now()이고 ledger가 한 transaction에 하나의 시각을 주므로 event의 at과 같다.
//
// command마다 적재하는 범위:
//
// | command                       | 대상 context 찾기      | 적재                          | content |
// |-------------------------------|------------------------|-------------------------------|---------|
// | context.create                | 입력의 project, id     | project, project의 context 전부 | no      |
// | context.archive / unarchive   | input.context          | context                       | no      |
// | bundle.open_draft             | input.context 또는 new.id | (새 context이면 project), context, 판 | 적용된 판 |
// | bundle.discard_draft          | contextOf(bundle)      | context, 판                   | no      |
// | bundle.submit                 | contextOf(bundle)      | context, 판, 검사             | no (폴더에서 읽는다) |
// | bundle.finish_check           | contextOf(check)       | context, 판, 검사, saved view | 검사한 판 |
// | bundle.rollback               | input.context          | context, 판, saved view       | 되돌릴 판 |
// | view.save                     | input.context          | context, 판, saved view       | 적용된 판 |
// | view.update                   | contextOf(view)        | context, 판, saved view       | 적용된 판 |
// | view.delete                   | contextOf(view)        | context, saved view           | no      |
// | context.record_violations     | input.context          | context, 판, 위반(index)      | no      |
// | glossary.set (새 항목)        | input.context          | context, 용어 항목, 입력 id의 항목 | no   |
// | glossary.set (기존)·remove    | contextOf(entry)       | context, 용어 항목            | no      |
//
// 읽기도 같은 적재를 읽기 snapshot(`snapshot.sql`)으로 하고 state.seq = Number(snapshot.as_of_seq)다.
// 읽기마다 적재 범위(bundle.test_draft는 대상 판의 context와 판 하나, 내용은 폴더에서 읽는다): context.entity는 (type, key) 개체와 그 관계 대상 행, context.series_next는 그 type의
// 개체(둘 다 적용된 판의 content와 index 갱신 실패 여부), context.list는 project(또는 app이면 context_app_data로 고른 context들)와 그 context·판(content 없음), context.get·bundles·
// glossary.list는 대상 context의 것, context.violations는 위반(deps.index)이다. context.saved_views(깨진 view
// 표시)·overview·search·contract·input_options는 적용된 판의 content(context.contract의 bundle 지정은 그 판의 content), context.draft는 판과 검사와
// 만드는 중인 판 하나(draft, 없으면 검사 중인 판, 없으면 마지막 failed 판)의 content,
// context.containing은 project의 active context들의 적용된 판 content다.
// 위반·개체·index 갱신 실패는 deps.index가 준다.
//
// platform이 주지 않아 deps로 받는 것: blob 읽기, derived index. 쓸 수 있는 actor의 판정은
// contextAuthorityPort(tx port)가 한다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { StoredViolation } from "../../../../protocol/projects/mod.ts";
import { AGENT_RUNTIME_PRINCIPAL } from "../../../../protocol/lophn-agent/mod.ts";
import { definePort, parseActor } from "../../../../protocol/base/mod.ts";
import type { ContextAuthority, ContextFolders } from "../../ports.ts";
import type { ContextFiles } from "../folders.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  RequestContext,
} from "../../../../protocol/server/mod.ts";
import type { SearchExecutor } from "../api/reads.ts";
import type {
  BlobReference,
  ContextApiActor,
  EntityRow,
} from "../api/state.ts";
import { COMMAND_ENTRIES, READ_ENTRIES } from "./adapter-routes.ts";
import {
  APP_BOUND_LIST,
  authorizeRead,
  denyCommand,
  filterList,
  isAppBound,
} from "./app-bound.ts";

// content blob을 읽는다. 쓰는 길은 없다: 바이트는 호출 경계(core)가 command 앞에서 호출자 자격으로
// platform/blob-store에 준비하고, adapter는 같은 값에서 같은 hash를 만들어 tx.registerBlobRef로
// 소유 변경과 같은 transaction에 영구 참조만 등록한다(content-blobs.ts).
export interface ContextBlobs {
  // 참조가 가리키는 BundleContent JSON을 읽는다. 없거나 hash가 다르면 internal이다.
  read(reference: BlobReference): Result<Record<string, unknown>>;
}

// derived 저장소(개체, 위반, index 신선도)다. ledger 표가 아니고 index 작업(ctx-I-index)이 구현한다.
// adapter는 이 port로만 읽는다. 위반 수는 ledger(contexts.violation_mark)에, 위반 목록은 여기에 있다.
export interface ContextIndexPort {
  // context의 위반 목록. 계산하지 않았으면 빈 목록이다.
  violations(context: string): readonly StoredViolation[];
  // 적용된 판의 개체. 검색과 overview가 쓴다.
  entities(context: string): readonly EntityRow[];
  // context.entity가 읽는 행: (type, key) 개체(같은 쌍이 둘이면 추출 순서의 첫 개체)와, 그 개체의 관계
  // 간선이 가리키는 key를 가진 개체들. 추출 순서다. 개체가 없으면 빈 목록이다.
  entity(context: string, type: string, key: string): readonly EntityRow[];
  // context.series_next가 읽는 행: 그 type의 개체 전부(추출 순서).
  ofType(context: string, type: string): readonly EntityRow[];
  // 읽기 전 index 갱신이 실패한 context다. 읽기는 빈 결과로 꾸미지 않고 unavailable을 낸다.
  failing(context: string): boolean;
}

// context를 쓸 수 있는 actor의 판정. 구현은 wiring이 tx port로 끼운다(그 project의 Project Manager의 session).
export const contextAuthorityPort = definePort<ContextAuthority>(
  "projects.context_authority",
);

export type ContextLedgerDeps = {
  blobs: ContextBlobs;
  index: ContextIndexPort;
  // 선언 검색 실행기(search/의 순수 함수).
  execute: SearchExecutor;
  // 정규 JSON의 sha256(hex). bundle_hash를 계산한다.
  hash(value: unknown): string;
  // 초안·저장 목차 폴더의 위치와 그 폴더의 JSON 파일 IO.
  folders: ContextFolders;
  files: ContextFiles;
  // app-data source의 앱 slug들이 가리키는 앱 ID들이다. 앱 하나에 묶인 agent의 읽기 권한이 쓴다.
  // 등록되지 않은 slug는 빠지고, 앱 등록이 없는 조립에서는 빈 목록이다.
  appIds(slugs: readonly string[]): readonly string[];
  // 앱 slug의 active release가 선언한 command의 효과다(검사 환경 `app_commands`). 앱이 없거나 보관됐거나
  // active release가 없거나 그 release에 command가 없으면 undefined다. 앱 등록이 없는 조립에서도 undefined다.
  appCommandEffect?(
    app: string,
    command: string,
  ): "read" | "write" | "external" | undefined;
};

// context worker의 좁은 machine 자격이 가지는 operation이다(credential scope.operations).
export const CONTEXT_WORKER_OPERATIONS = [
  "bundle.finish_check",
  "context.record_violations",
] as const;

// platform ctx를 handler의 actor로 바꾼다.
//   user -> user, coding_agent:… -> coding_agent, agent:ses_… -> agent,
//   machine -> machine (principal이 AGENT_RUNTIME_PRINCIPAL이면 agent_runtime: context.list·get·contract만
//              읽는다. scope.operations가 비어 있지 않고 모두 CONTEXT_WORKER_OPERATIONS이면 context_worker,
//              아니면 other).
// route의 actors 목록에 없는 app:… 자격은 envelope가 먼저 막지만 여기서도 forbidden이다.
export function mapActor(ctx: RequestContext): Result<ContextApiActor> {
  const parts = parseActor(ctx.actor);
  switch (parts?.kind) {
    case "user":
      return ok({ kind: "user", actor: ctx.actor });
    case "coding_agent":
      return ok({ kind: "coding_agent", actor: ctx.actor });
    case "agent":
      return ok({ kind: "agent", actor: ctx.actor });
    case "machine": {
      const operations: readonly string[] = ctx.scope.operations;
      const worker = operations.length > 0 &&
        operations.every((operation) =>
          (CONTEXT_WORKER_OPERATIONS as readonly string[]).includes(operation)
        );
      return ok({
        kind: "machine",
        actor: ctx.actor,
        scope: ctx.principal === AGENT_RUNTIME_PRINCIPAL
          ? "agent_runtime"
          : worker
          ? "context_worker"
          : "other",
      });
    }
    default:
      return err({ code: "forbidden", message: "actor cannot use contexts" });
  }
}

// CONTEXT_API_COMMAND_ROUTES의 route마다 CommandDefinition 하나, 위의 흐름대로.
export function contextLedgerCommands(
  deps: ContextLedgerDeps,
): readonly CommandDefinition[] {
  return COMMAND_ENTRIES.map((entry): CommandDefinition => ({
    route: entry.route,
    handle(tx, ctx, input, compare) {
      // 앱 하나에 묶인 agent에게 context command는 없는 대상과 같은 답이다(app-bound.ts).
      if (isAppBound(ctx)) {
        const denied = denyCommand(tx, ctx, entry.route.name);
        if (!denied.ok) return denied;
      }
      const actor = mapActor(ctx);
      return actor.ok
        ? entry.run(deps, tx, ctx, actor.value, input, compare)
        : actor;
    },
  }));
}

// CONTEXT_API_READ_ROUTES의 route마다 ReadDefinition 하나.
export function contextLedgerReads(
  deps: ContextLedgerDeps,
): readonly ReadDefinition[] {
  return READ_ENTRIES.map((entry): ReadDefinition => ({
    route: entry.route,
    handle(snapshot, ctx, input) {
      const bound = isAppBound(ctx);
      const operation = entry.route.name;
      if (bound && operation !== APP_BOUND_LIST) {
        const context = (input as { context?: unknown }).context;
        const allowed = authorizeRead(
          snapshot,
          deps,
          ctx,
          operation,
          typeof context === "string" ? context : undefined,
        );
        if (!allowed.ok) return allowed;
      }
      const actor = mapActor(ctx);
      if (!actor.ok) return actor;
      const read = entry.run(deps, snapshot, actor.value, input);
      if (!bound || !read.ok || operation !== APP_BOUND_LIST) return read;
      // 목록은 열리는 context의 줄만 남긴다.
      const page = read.value as { contexts: { id: string }[] };
      return ok({
        ...page,
        contexts: filterList(snapshot, deps, ctx, page.contexts),
      }) as typeof read;
    },
  }));
}
