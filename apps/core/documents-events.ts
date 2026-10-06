// documents가 event 구독에 싣는 것: 팀 event 정의, 공개 정책, 그리고 core 안에서 documents
// 관측을 맞추는 구독자(machine:documents-feed)가 보는 event 범위(documents plan Q17).
// 이 구독자는 core가 직접 돌리는 machine principal이고 token이 없다. 사람 token·agent·app
// credential은 이 principal이 될 수 없어서 아래 정책의 feed 분기에 닿지 않는다.
// event는 깨우는 신호일 뿐이다. 구독자는 payload로 상태를 만들지 않고, 깨어나면 같은
// ledger snapshot read(project.tracking_roots·관측 근거)를 다시 한다.
import { ok, type Result } from "../../packages/base/mod.ts";
import {
  contextWatchedItemChanged,
  documentArchived,
  documentCreated,
  documentMoved,
  documentRenamed,
  documentRestored,
  documentSaved,
  documentSourceChanged,
  documentUnarchived,
  documentUpdated,
  EVENTS,
  projectArchived,
  projectCreated,
  projectTrackingChanged,
  projectUnarchived,
  projectUpdated,
} from "../../packages/contracts/documents/mod.ts";
import type {
  EventDefinition,
  EventEnvelopeFor,
  EventVisibilityDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../packages/contracts/platform/mod.ts";
import { createProjectEventVisibility } from "../../packages/documents/projects/mod.ts";
import type { EventRegistration } from "../../packages/platform/ledger/mod.ts";
import { notificationsOnlyVisibility } from "./platform.ts";

export const DOCUMENTS_FEED_PRINCIPAL = "machine:documents-feed";

// core가 ledger credential 기록으로 심는 자격이다. 읽는 operation은 ListEvents 하나다.
export const DOCUMENTS_FEED_CONTEXT: RequestContext = {
  principal: DOCUMENTS_FEED_PRINCIPAL,
  actor: "machine",
  scope: { operations: ["ListEvents"], targets: {} },
  conditions: {},
  credential_ref: DOCUMENTS_FEED_PRINCIPAL,
};

// tracking 규칙·root(project.tracking_roots)와 경로→문서 연결(원본 hash·최신 판·보관)이
// 바뀌는 event다. 이 밖의 documents event는 feed에도 닫혀 있다.
const FEED_EVENTS = [
  projectCreated,
  projectUpdated,
  projectTrackingChanged,
  projectArchived,
  projectUnarchived,
  documentCreated,
  documentSaved,
  documentSourceChanged,
  documentArchived,
  documentUnarchived,
  documentRestored,
  // 이름·자리·제목이 바뀌면 문서 revision이 바뀐다. 관측 근거(document_revision)가 낡으면
  // 파일 관측의 저장이 conflict라서 이 event도 근거를 다시 맞추는 신호다.
  documentMoved,
  documentRenamed,
  documentUpdated,
] as const;

const FEED_TYPES: ReadonlySet<string> = new Set(
  FEED_EVENTS.map((event) => event.type),
);

export function isDocumentsFeedEvent(type: string): boolean {
  return FEED_TYPES.has(type);
}

function isFeed(ctx: RequestContext): boolean {
  return ctx.actor === "machine" &&
    ctx.principal === DOCUMENTS_FEED_PRINCIPAL &&
    ctx.credential_ref === DOCUMENTS_FEED_PRINCIPAL;
}

type Handle<D extends EventDefinition> = EventVisibilityDefinition<D>["handle"];

// feed에는 열고, 나머지 자격은 owner의 기존 정책(없으면 닫힘)을 따른다.
function withFeed<D extends EventDefinition>(
  event: D,
  owner?: Handle<D>,
): EventVisibilityDefinition {
  const policy: EventVisibilityDefinition<D> = {
    event,
    handle(
      snapshot: ReadSnapshot,
      ctx: RequestContext,
      envelope: EventEnvelopeFor<D>,
    ): Result<boolean> {
      if (isFeed(ctx)) return ok(true);
      return owner ? owner(snapshot, ctx, envelope) : ok(false);
    },
  };
  return policy as unknown as EventVisibilityDefinition;
}

export function createDocumentsEventRegistration(): EventRegistration {
  const projects = createProjectEventVisibility();
  return {
    events: EVENTS,
    visibility: [
      withFeed(projectCreated, projects.created.handle),
      withFeed(projectUpdated, projects.updated.handle),
      // 규칙 변경의 사람 공개는 owner가 아직 정하지 않았다. feed에만 연다.
      withFeed(projectTrackingChanged),
      withFeed(projectArchived, projects.archived.handle),
      withFeed(projectUnarchived, projects.unarchived.handle),
      withFeed(documentCreated),
      withFeed(documentSaved),
      withFeed(documentSourceChanged),
      withFeed(documentArchived),
      withFeed(documentUnarchived),
      withFeed(documentRestored),
      // 문서 watch 변화는 notifications 계기다(platform/notifications#R1). feed가 아니라
      // notifications 구독자에게만 열고, 나머지 자격에는 닫혀 있다.
      notificationsOnlyVisibility(contextWatchedItemChanged),
      // search consumer(derived index)가 읽는 event. 자리·이름·제목이 바뀌면 index가 따라간다.
      // 사람 공개는 owner가 아직 정하지 않았다. feed에만 연다.
      withFeed(documentMoved),
      withFeed(documentRenamed),
      withFeed(documentUpdated),
    ],
  };
}
