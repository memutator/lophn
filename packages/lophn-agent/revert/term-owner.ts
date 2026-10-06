import { err, ok } from "../../base/mod.ts";
import {
  termArchive,
  termArchived,
  termProposed,
  termUnarchive,
  termUnarchived,
  termUpdated,
  TERM_EVENTS,
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

// term 변경의 복원 판정(documents/terms). agent 후보 제안만 복원하고 사람 정의는 대상 아님.
// run 이후의 변경이 없으면 역복 (이후 revision이 같을 때만, documents/terms#T25 참고).
export const TERM_REVERT_OWNER = "documents/terms";

const OWN_TYPES = new Set<string>(TERM_EVENTS.map((event) => event.type));

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
    owner: TERM_REVERT_OWNER,
    target,
    source_seqs: sortSeqs(seqs),
    capability,
    reason,
    comparison,
    before_ref: beforeRef,
    dependencies: [],
  };
}

function classifyTerm(
  term: string,
  own: readonly RunEvent[],
  all: readonly RunEvent[],
): GroupDraft[] {
  const seqs = own.map((event) => event.seq);
  const ownSet = new Set(seqs);
  const first = own[0].seq;
  const revision = revisionOf(all);
  // 처음 변경 뒤에 이 run이 아닌 변경이 있으면 충돌. documents/terms#T25 참고.
  const foreign = all.some((event) =>
    !ownSet.has(event.seq) && compareSeq(event.seq, first) > 0
  );
  if (foreign) {
    return [
      draft(term, seqs, "conflict", "later_change", {
        kind: "term",
        term,
        base_revision: revision,
      }, null),
    ];
  }
  // agent run만 복원 가능.
  if (!own.every((event) => event.actor.startsWith("agent:"))) {
    return [
      draft(term, seqs, "irreversible", "not_agent_output", null, null),
    ];
  }
  // 사람 정의(TermDefined)는 복원 대상이 아님 (CE agent 후보만).
  if (
    own.some((event) =>
      event.type === "TermDefined"
    )
  ) {
    return [
      draft(
        term,
        seqs,
        "irreversible",
        "not_agent_output",
        null,
        null,
      ),
    ];
  }
  // 분류되지 않은 event는 복원 불가.
  if (
    !own.every((event) =>
      event.type === termProposed.type ||
      event.type === termUpdated.type ||
      event.type === termArchived.type ||
      event.type === termUnarchived.type
    )
  ) {
    return [
      draft(
        term,
        seqs,
        "irreversible",
        "unclassified_event",
        null,
        null,
      ),
    ];
  }
  // term 제안(후보)는 archive로 보상.
  if (own[0].type === termProposed.type) {
    return [
      draft(term, seqs, "reversible", null, {
        kind: "archive",
        term,
        base_revision: revision,
      }, { kind: "proposed_term", term }),
    ];
  }
  // 그 외 변경들(update, archive/unarchive)은 각각 보상.
  const drafts: GroupDraft[] = [];
  if (own.some((e) => e.type === termUpdated.type)) {
    // 후보 업데이트는 원래 상태로 복원.
    drafts.push(
      draft(term, seqs, "reversible", null, {
        kind: "restore",
        term,
        base_revision: revision,
      }, {
        kind: "term_state",
        term,
      }),
    );
  }
  if (own.some((e) =>
    e.type === termArchived.type || e.type === termUnarchived.type
  )) {
    // 보관 상태 복원.
    drafts.push(
      draft(term, seqs, "reversible", null, {
        kind: "restore_archive_state",
        term,
        base_revision: revision,
      }, { kind: "term_archive_state", term }),
    );
  }
  return drafts.length > 0 ? drafts : [
    draft(term, seqs, "irreversible", "unclassified_event", null, null),
  ];
}

export function createTermOwner(): RevertOwner {
  return {
    concern: TERM_REVERT_OWNER,
    claims: (type) => OWN_TYPES.has(type),
    classify({ events, lookup }) {
      const bySubject = new Map<string, RunEvent[]>();
      for (const event of events) {
        const list = bySubject.get(event.subject as string) ?? [];
        list.push(event);
        bySubject.set(event.subject as string, list);
      }
      const drafts: GroupDraft[] = [];
      for (const [term, own] of bySubject) {
        drafts.push(
          ...classifyTerm(term, own, subjectEvents(lookup, term)),
        );
      }
      return drafts;
    },
    ready(_group, _input) {
      // term 복원은 사전 준비 없음.
      return ok(null);
    },
    restore(tx, group, _input) {
      const comparison = group.comparison;
      const term = group.target;
      if (comparison === null || term === null) {
        return err({
          code: "invalid_input",
          message: "this group has nothing to restore",
        });
      }
      if (comparison["kind"] === "archive") {
        const result = tx.call(termArchive, { term }, {
          base_revision: String(comparison["base_revision"]),
        });
        if (!result.ok) return err(result.error);
      } else if (comparison["kind"] === "restore") {
        const result = tx.call(termUnarchive, { term }, {
          base_revision: String(comparison["base_revision"]),
        });
        if (!result.ok) return err(result.error);
      }
      // 다른 종류의 변경은 추후 documents concern이 처리할 명령 구현.
      return ok(undefined);
    },
  };
}
