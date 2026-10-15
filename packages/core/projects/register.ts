import { ok, type Result } from "../../base/mod.ts";
import {
  CONTEXT_API_EVENTS,
  contextViolationsRecordedEvent,
  EVENTS,
} from "../../protocol/projects/mod.ts";
import type { DocumentRef } from "../../protocol/projects/mod.ts";
import type {
  EventVisibilityDefinition,
  RequestContext,
} from "../../protocol/server/mod.ts";
import type { EventDefinition } from "../../protocol/events/mod.ts";
import type {
  EventRegistration,
  ReaderRegistration,
} from "../storage/ledger/mod.ts";
import {
  isAssignmentReactions,
  isNotifications,
} from "../main/daemon/platform-register.ts";
import {
  CONTEXT_WORKER_PRINCIPAL,
  createContextsRegistration,
  loadContextsRuntime,
} from "./contexts/register.ts";
import { createProjectCommands } from "./registry/commands.ts";
import { createProjectEventVisibility } from "./registry/visibility.ts";
import { createProjectReads, type ProjectReadDeps } from "./registry/reads.ts";
import { projectsSchemaSteps } from "./registry/schema.ts";

// context API의 의존. command를 실행하는 writer Worker와 read를 실행하는 reader Worker 안에서만
// 실제 구현이 올라온다(contexts-api.ts). core 본체는 route 등록만 쓴다.
const contextsRuntime = await loadContextsRuntime();

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  blobFields?: readonly unknown[];
};

// 문서가 디스크 파일 하나가 되어 project에 문서 목록이 없다.
function projectDocuments(): Result<readonly DocumentRef[]> {
  return ok([]);
}

const projectReadDeps: ProjectReadDeps = { documents: projectDocuments };

export function createLedgerRegistration(): LedgerRegistration {
  // owner target은 ledger가 주입한 TargetAuthorization port가 판정한다.
  const commands = createProjectCommands();
  const contexts = createContextsRegistration(contextsRuntime);
  const reads = createProjectReads(projectReadDeps);
  return {
    schemaSteps: [...projectsSchemaSteps, ...contexts.schemaSteps],
    commands: [
      commands.create,
      commands.update,
      commands.setTracking,
      commands.archive,
      commands.unarchive,
      ...contexts.commands,
    ],
    reads: [
      reads.list,
      reads.get,
      reads.resolve,
      reads.resolveCwd,
      reads.trackingRoots,
      ...contexts.reads,
    ],
    // context 내용 blob은 context 읽기가 연다.
    blobFields: [...contexts.blobFields],
  };
}

// project 보관·보관 해제는 assignments 반응 구독자도 읽는다. 그 자리의 켜진 assignment를 멈추고
// 다시 켜는 계기다.
function withAssignments<D extends EventDefinition>(
  base: EventVisibilityDefinition<D>,
): EventVisibilityDefinition {
  const policy: EventVisibilityDefinition<D> = {
    event: base.event,
    handle(snapshot, ctx, envelope) {
      return isAssignmentReactions(ctx)
        ? ok(true)
        : base.handle(snapshot, ctx, envelope);
    },
  };
  return policy as unknown as EventVisibilityDefinition;
}

// context worker(machine:context-worker)가 보는 context event. 판 제출·적용·되돌림과 보관이
// index 감시 폴더와 검사 일을 바꾼다. 사람 token은 owner 정책으로 읽는다.
function isContextWorker(ctx: RequestContext): boolean {
  return ctx.actor === "machine" && ctx.principal === CONTEXT_WORKER_PRINCIPAL;
}

// context event의 공개 정책: 사람(user)과 context worker가 읽고, 다른 자격에는 숨긴다.
// ContextViolationsRecorded는 notifications 계기라 그 구독자에도 연다.
function contextVisibility<D extends EventDefinition>(
  event: D,
): EventVisibilityDefinition<D> {
  const notified = event.type === contextViolationsRecordedEvent.type;
  return {
    event,
    handle: (_snapshot, ctx) =>
      ok(
        ctx.actor === "user" || isContextWorker(ctx) ||
          (notified && isNotifications(ctx)),
      ),
  };
}

// event 정의와 공개 정책. reader Worker가 모든 팀 module의 것을 모아 events/list의 registry를
// 만든다.
export function createEventRegistration(): EventRegistration {
  const projects = createProjectEventVisibility();
  return {
    events: EVENTS,
    visibility: [
      projects.created as unknown as EventVisibilityDefinition,
      projects.updated as unknown as EventVisibilityDefinition,
      withAssignments(projects.archived),
      withAssignments(projects.unarchived),
      ...CONTEXT_API_EVENTS.map((event) =>
        contextVisibility(event) as unknown as EventVisibilityDefinition
      ),
    ],
  };
}

// reader Worker가 HTTP read를 연다. command 등록과 같은 read 목록이다.
export function createReaderRegistration(): ReaderRegistration {
  const contexts = createContextsRegistration(contextsRuntime);
  const projectReads = createProjectReads(projectReadDeps);
  return {
    reads: [
      ...contexts.reads,
      projectReads.list,
      projectReads.get,
      projectReads.resolve,
      projectReads.resolveCwd,
      projectReads.trackingRoots,
    ],
    ports: new Map(),
  };
}
