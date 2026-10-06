import { err, ok } from "../../base/mod.ts";
import {
  contextArchive,
  contextArchived,
  contextCreated,
  contextItemRemoved,
  contextItemSet,
  contextUnarchive,
  contextUnarchived,
  contextUpdated,
  CONTEXT_EVENTS,
} from "../../contracts/documents/mod.ts";
import type { JsonObject } from "../../contracts/platform/mod.ts";
import {
  compareSeq,
  type GroupDraft,
  type ReasonCode,
  type RevertOwner,
  type RevertRunGroup,
  type RunEvent,
  sortSeqs,
  subjectEvents,
} from "./model.ts";

// context 변경의 복원 판정(documents/contexts). run 이전의 변경이 없으면 역복
// (이후 revision이 같을 때만, documents/contexts#T22 참고).
export const CONTEXT_REVERT_OWNER = "documents/contexts";

const OWN_TYPES = new Set<string>(CONTEXT_EVENTS.map((event) => event.type));

function revisionOf(all: readonly RunEvent[]): string {
  let revision = "0";
  for (const event of all) {
    if (OWN_TYPES.has(event.type) && compareSeq(event.seq, revision) > 0) {
      revision = event.seq;
    }
  }
  return revision;
}

function draft(
  target: string | null,
  seqs: readonly string[],
  capability: GroupDraft["capability"],
  reason: ReasonCode | null,
  comparison: JsonObject | null,
  beforeRef: JsonObject | null,
): GroupDraft {
  return {
    owner: CONTEXT_REVERT_OWNER,
    target,
    source_seqs: sortSeqs(seqs),
    capability,
    reason,
    comparison,
    before_ref: beforeRef,
    dependencies: [],
  };
}

function classifyContext(
  context: string,
  own: readonly RunEvent[],
  all: readonly RunEvent[],
): GroupDraft[] {
  const seqs = own.map((event) => event.seq);
  const ownSet = new Set(seqs);
  const first = own[0].seq;
  const revision = revisionOf(all);
  // 처음 변경 뒤에 이 run이 아닌 변경이 있으면 충돌. documents/contexts#T22에서 설명.
  const foreign = all.some((event) =>
    !ownSet.has(event.seq) && compareSeq(event.seq, first) > 0
  );
  if (foreign) {
    return [
      draft(context, seqs, "conflict", "later_change", {
        kind: "context",
        context,
        base_revision: revision,
      }, null),
    ];
  }
  // agent run만 복원 가능.
  if (!own.every((event) => event.actor.startsWith("agent:"))) {
    return [
      draft(context, seqs, "irreversible", "not_agent_output", null, null),
    ];
  }
  // 분류되지 않은 event는 복원 불가.
  if (
    !own.every((event) =>
      event.type === contextCreated.type ||
      event.type === contextUpdated.type ||
      event.type === contextItemSet.type ||
      event.type === contextItemRemoved.type ||
      event.type === contextArchived.type ||
      event.type === contextUnarchived.type
    )
  ) {
    return [
      draft(
        context,
        seqs,
        "irreversible",
        "unclassified_event",
        null,
        null,
      ),
    ];
  }
  // context 생성은 삭제(archive)로 보상.
  if (own[0].type === contextCreated.type) {
    return [
      draft(context, seqs, "reversible", null, {
        kind: "archive",
        context,
        base_revision: revision,
      }, { kind: "created_context", context }),
    ];
  }
  // 그 외 변경들은 각각 복원 가능. 같은 context에 여러 종류의 변경이 있을 때 모두 원래 상태로 돌린다.
  // 구체적인 보상 경로는 각각의 역복 logic에서 정의된다 (비어 있음, 각 draft는 비교만 제공).
  const drafts: GroupDraft[] = [];
  if (own.some((e) =>
    e.type === contextUpdated.type || e.type === contextItemSet.type ||
    e.type === contextItemRemoved.type
  )) {
    // 이 경우, 사람 자격으로 context를 다시 고정 상태로 되돌려야 한다.
    // 구현상 documents concern이 처리한다 (우리는 분류만 한다).
    drafts.push(
      draft(context, seqs, "reversible", null, {
        kind: "restore",
        context,
        base_revision: revision,
      }, {
        kind: "context_state",
        context,
      }),
    );
  }
  if (own.some((e) =>
    e.type === contextArchived.type || e.type === contextUnarchived.type
  )) {
    // 보관 상태 복원도 document concern이 처리.
    drafts.push(
      draft(context, seqs, "reversible", null, {
        kind: "restore_archive_state",
        context,
        base_revision: revision,
      }, { kind: "context_archive_state", context }),
    );
  }
  return drafts.length > 0 ? drafts : [
    draft(context, seqs, "irreversible", "unclassified_event", null, null),
  ];
}

export function createContextOwner(): RevertOwner {
  return {
    concern: CONTEXT_REVERT_OWNER,
    claims: (type) => OWN_TYPES.has(type),
    classify({ events, lookup }) {
      const bySubject = new Map<string, RunEvent[]>();
      for (const event of events) {
        const list = bySubject.get(event.subject as string) ?? [];
        list.push(event);
        bySubject.set(event.subject as string, list);
      }
      const drafts: GroupDraft[] = [];
      for (const [context, own] of bySubject) {
        drafts.push(
          ...classifyContext(context, own, subjectEvents(lookup, context)),
        );
      }
      return drafts;
    },
    ready(_group, _input) {
      // context 복원은 사전 준비 없음.
      return ok(null);
    },
    restore(tx, group, _input) {
      const comparison = group.comparison;
      const context = group.target;
      if (comparison === null || context === null) {
        return err({
          code: "invalid_input",
          message: "this group has nothing to restore",
        });
      }
      if (comparison["kind"] === "archive") {
        const result = tx.call(contextArchive, { context }, {
          base_revision: String(comparison["base_revision"]),
        });
        if (!result.ok) return err(result.error);
      } else if (comparison["kind"] === "restore") {
        const result = tx.call(contextUnarchive, { context }, {
          base_revision: String(comparison["base_revision"]),
        });
        if (!result.ok) return err(result.error);
      }
      // 다른 종류의 변경은 추후 documents concern이 처리할 명령 구현.
      return ok(undefined);
    },
  };
}
