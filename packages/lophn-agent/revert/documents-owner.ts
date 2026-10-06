import { err, ok } from "../../base/mod.ts";
import {
  DOCUMENT_EVENTS,
  documentArchive,
  documentArchived,
  documentCreated,
  documentMoved,
  documentRenamed,
  documentRestore,
  documentSaved,
  documentSourceChanged,
  documentUnarchived,
  documentUpdated,
  preparedVersionSchema,
} from "../../contracts/documents/mod.ts";
import type { JsonObject } from "../../contracts/platform/mod.ts";
import {
  compareSeq,
  type GroupDraft,
  hashOf,
  type ReasonCode,
  type RevertOwner,
  type RevertRunGroup,
  type RunEvent,
  sortSeqs,
  subjectEvents,
  targetOf,
} from "./model.ts";

// 문서 내용·metadata의 복원 판정(documents/versions, documents/addressing). 이 leaf는 문서 표를
// 읽지 않는다. run의 문서 event(DocumentCreated·DocumentSaved·DocumentUpdated)와 같은 문서의 다른
// event만으로 분류하고, 복원은 documents가 선언한 dispatchable command(`document.archive`,
// `document.restore`)를 같은 Tx에서 부른다. 최종 안전 검사(base_revision·base_version CAS, 보관·
// 원본 연결 문서 거절, 권한)는 그 command가 다시 한다.

export const DOCUMENTS_REVERT_OWNER = "documents/versions";

const OWN_TYPES = new Set<string>(DOCUMENT_EVENTS.map((event) => event.type));

// 문서의 revision은 내용 저장이 아니라 만들기·제목·원본 연결·보관·자리·이름 변경의 seq다
// (documents/versions: 내용 저장은 latest_version만 옮긴다).
const METADATA_TYPES = new Set<string>([
  documentCreated.type,
  documentUpdated.type,
  documentSourceChanged.type,
  documentArchived.type,
  documentUnarchived.type,
  documentMoved.type,
  documentRenamed.type,
]);

function revisionOf(all: readonly RunEvent[]): string {
  let revision = "0";
  for (const event of all) {
    if (
      METADATA_TYPES.has(event.type) && compareSeq(event.seq, revision) > 0
    ) revision = event.seq;
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
    owner: DOCUMENTS_REVERT_OWNER,
    target,
    source_seqs: sortSeqs(seqs),
    capability,
    reason,
    comparison,
    before_ref: beforeRef,
    dependencies: [],
  };
}

function classifyDocument(
  document: string,
  own: readonly RunEvent[],
  all: readonly RunEvent[],
): GroupDraft[] {
  const seqs = own.map((event) => event.seq);
  const ownSet = new Set(seqs);
  const first = own[0].seq;
  const revision = revisionOf(all);
  // 처음 변경 뒤에 이 run이 아닌 변경이 하나라도 있으면(끼었거나 뒤따랐거나) 충돌이다. 값이
  // 우연히 같아도 충돌이고 이 판정을 덮어쓰는 동의는 없다(R4).
  const foreign = all.some((event) =>
    !ownSet.has(event.seq) && compareSeq(event.seq, first) > 0
  );
  if (foreign) {
    return [
      draft(document, seqs, "conflict", "later_change", {
        kind: "document",
        document,
        base_revision: revision,
      }, null),
    ];
  }
  if (!own.every((event) => event.actor.startsWith("agent:"))) {
    return [
      draft(document, seqs, "irreversible", "not_agent_output", null, null),
    ];
  }
  if (
    !own.every((event) =>
      event.type === documentCreated.type ||
      event.type === documentSaved.type ||
      event.type === documentUpdated.type
    )
  ) {
    return [
      draft(
        document,
        seqs,
        "irreversible",
        "unclassified_document_event",
        null,
        null,
      ),
    ];
  }
  if (own[0].type === documentCreated.type) {
    // run이 만든 문서는 보관한다. 원본 연결이 있으면 디스크 원본 반영이 걸려 있어 복원하지 않는다.
    const created = documentCreated.payload.safeParse(own[0].payload);
    if (!created.success || created.data.file_source !== null) {
      return [
        draft(document, seqs, "irreversible", "linked_document", null, null),
      ];
    }
    return [
      draft(document, seqs, "reversible", null, {
        kind: "archive",
        document,
        base_revision: revision,
      }, { kind: "created_document", document }),
    ];
  }
  const drafts: GroupDraft[] = [];
  const saves = own.filter((event) => event.type === documentSaved.type);
  const titles = own.filter((event) => event.type === documentUpdated.type);
  if (saves.length > 0) {
    const firstSave = documentSaved.payload.safeParse(saves[0].payload);
    const lastSave = documentSaved.payload.safeParse(
      saves[saves.length - 1].payload,
    );
    const saveSeqs = saves.map((event) => event.seq);
    if (
      !firstSave.success || !lastSave.success ||
      firstSave.data.previous_version === null
    ) {
      drafts.push(
        draft(
          document,
          saveSeqs,
          "irreversible",
          "no_previous_version",
          null,
          null,
        ),
      );
    } else {
      drafts.push(
        draft(document, saveSeqs, "reversible", null, {
          kind: "restore",
          document,
          base_version: lastSave.data.version,
          base_revision: revision,
          restore_version: firstSave.data.previous_version,
        }, {
          kind: "version",
          document,
          version: firstSave.data.previous_version,
        }),
      );
    }
  }
  if (titles.length > 0) {
    // 제목 복원은 사람 자격으로 부를 수 없는 보상 값이다. 남는 변경으로 설명한다.
    drafts.push(
      draft(
        document,
        titles.map((event) => event.seq),
        "irreversible",
        "title_change",
        null,
        null,
      ),
    );
  }
  return drafts;
}

function preparedOf(input: RevertRunGroup): unknown {
  return input.comparison["prepared"];
}

export function createDocumentsOwner(): RevertOwner {
  return {
    concern: DOCUMENTS_REVERT_OWNER,
    claims: (type) => OWN_TYPES.has(type),
    classify({ events, lookup }) {
      const bySubject = new Map<string, RunEvent[]>();
      const orphans: RunEvent[] = [];
      for (const event of events) {
        if (targetOf(event.subject) === null) {
          orphans.push(event);
          continue;
        }
        const list = bySubject.get(event.subject as string) ?? [];
        list.push(event);
        bySubject.set(event.subject as string, list);
      }
      const drafts: GroupDraft[] = [];
      for (const [document, own] of bySubject) {
        drafts.push(
          ...classifyDocument(document, own, subjectEvents(lookup, document)),
        );
      }
      if (orphans.length > 0) {
        drafts.push(
          draft(
            null,
            orphans.map((event) => event.seq),
            "irreversible",
            "unclassified_document_event",
            null,
            null,
          ),
        );
      }
      return drafts;
    },
    // 내용 복원은 이전 판의 준비 결과가 있어야 한다. 준비 결과는 복원 입력의 comparison.prepared에
    // 실려 오고, 그 hash(prepared_ref)와 문서·기준 판이 맞아야 한다. 없으면 복원을 시작하지 않는다.
    ready(group, input) {
      const comparison = group.comparison;
      if (comparison === null || comparison["kind"] !== "restore") {
        return ok(null);
      }
      const prepared = preparedOf(input);
      if (prepared === undefined) return ok("blocked_not_prepared");
      if (input.prepared_ref !== hashOf(prepared)) {
        return err({
          code: "invalid_input",
          message: "the prepared result is not the one referenced",
        });
      }
      const parsed = preparedVersionSchema.safeParse(prepared);
      if (
        !parsed.success || parsed.data.document !== group.target ||
        parsed.data.base_version !== comparison["base_version"]
      ) {
        return err({
          code: "invalid_input",
          message: "the prepared result is not for this document version",
        });
      }
      return ok(null);
    },
    restore(tx, group, input) {
      const comparison = group.comparison;
      const document = group.target;
      if (comparison === null || document === null) {
        return err({
          code: "invalid_input",
          message: "this group has nothing to restore",
        });
      }
      const result = comparison["kind"] === "archive"
        ? tx.call(documentArchive, { document }, {
          base_revision: String(comparison["base_revision"]),
        })
        : tx.call(documentRestore, {
          document,
          restore_version: String(comparison["restore_version"]),
          prepared: preparedVersionSchema.parse(preparedOf(input)),
        }, {
          base_version: String(comparison["base_version"]),
          base_revision: String(comparison["base_revision"]),
        });
      if (!result.ok) return err(result.error);
      return ok(undefined);
    },
  };
}
