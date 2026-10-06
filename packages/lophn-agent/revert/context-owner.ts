import { err, ok } from "../../base/mod.ts";
import {
  CONTEXT_EVENTS,
  contextArchive,
  contextArchived,
  contextCreated,
  contextItemRemoved,
  contextItemSet,
  contextRemoveItem,
  contextSetItem,
  contextUnarchive,
  contextUnarchived,
  contextUpdate,
  contextUpdated,
  contextWatchedItemChanged,
} from "../../contracts/documents/mod.ts";
import type { JsonObject } from "../../contracts/platform/mod.ts";
import {
  applySteps,
  bySubject,
  callOf,
  currentRevision,
  draftOf,
  hasForeignChange,
  type Step,
} from "./chain.ts";
import {
  type GroupDraft,
  type RevertOwner,
  type RunEvent,
  subjectEvents,
  targetOf,
} from "./model.ts";

// context 변경의 복원 판정(documents/contexts, documents/contexts#R15). 이 leaf는 context 표를 읽지
// 않는다. run의 context event와 같은 context의 다른 구성 event만으로 분류하고, 복원은 documents가
// dispatchable로 선언한 command(`context.update`·`set_item`·`remove_item`·`archive`·`unarchive`)를 같은
// Tx에서 부른다. run이 만든 context는 보관하고(삭제하지 않는다), 이름·목적·항목·보관 변경은 event가 남긴
// 이전 값으로 거꾸로 되돌린다. 최종 안전 검사(revision CAS, 항목 대상 검사, 권한)는 그 command가 다시 한다.

export const CONTEXT_REVERT_OWNER = "documents/contexts";

const OWN_TYPES = new Set<string>(CONTEXT_EVENTS.map((event) => event.type));
// 감시 변화 기록은 구성이 아니라서 revision을 바꾸지 않고 복원을 막지도 않는다.
const CONFIG_TYPES = new Set<string>(
  CONTEXT_EVENTS.map((event) => event.type).filter((type) =>
    type !== contextWatchedItemChanged.type
  ),
);

const draft = (
  target: string | null,
  seqs: readonly string[],
  capability: GroupDraft["capability"],
  reason: GroupDraft["reason"],
  comparison: JsonObject | null,
  beforeRef: JsonObject | null,
) =>
  draftOf(
    CONTEXT_REVERT_OWNER,
    target,
    seqs,
    capability,
    reason,
    comparison,
    beforeRef,
  );

// event를 거꾸로 되돌리는 호출의 열이다. 풀 수 없는 event가 있으면 null이다.
function stepsOf(own: readonly RunEvent[]): Step[] | null {
  const steps: Step[] = [];
  for (const event of [...own].reverse()) {
    if (event.type === contextUpdated.type) {
      const parsed = contextUpdated.payload.safeParse(event.payload);
      if (!parsed.success) return null;
      steps.push({ op: "update", ...parsed.data.before } as Step);
    } else if (event.type === contextItemSet.type) {
      const parsed = contextItemSet.payload.safeParse(event.payload);
      if (!parsed.success) return null;
      const { before_item, target } = parsed.data;
      // 새로 넣은 항목은 빼고, 관점·이유만 바꾼 항목은 이전 값으로 되돌린다(자리는 그대로다).
      steps.push(
        before_item === null
          ? { op: "remove_item", target } as Step
          : { op: "set_item", item: before_item } as Step,
      );
    } else if (event.type === contextItemRemoved.type) {
      const parsed = contextItemRemoved.payload.safeParse(event.payload);
      if (!parsed.success) return null;
      steps.push({
        op: "set_item",
        item: parsed.data.before_item,
        position: parsed.data.before_position,
      } as Step);
    } else if (event.type === contextArchived.type) {
      steps.push({ op: "unarchive" });
    } else if (event.type === contextUnarchived.type) {
      steps.push({ op: "archive" });
    } else {
      return null;
    }
  }
  return steps;
}

// run이 끝난 뒤의 보관 상태. 만든 context를 run이 이미 보관했으면 되돌릴 일이 없다.
function endsActive(own: readonly RunEvent[]): boolean {
  let active = true;
  for (const event of own) {
    if (event.type === contextArchived.type) active = false;
    if (event.type === contextUnarchived.type) active = true;
  }
  return active;
}

function classifyContext(
  context: string,
  own: readonly RunEvent[],
  all: readonly RunEvent[],
): GroupDraft[] {
  const seqs = own.map((event) => event.seq);
  const revision = currentRevision(all, CONFIG_TYPES);
  if (hasForeignChange(own, all, CONFIG_TYPES)) {
    return [
      draft(context, seqs, "conflict", "later_change", {
        kind: "context",
        context,
        base_revision: revision,
      }, null),
    ];
  }
  if (!own.every((event) => event.actor.startsWith("agent:"))) {
    return [
      draft(context, seqs, "irreversible", "not_agent_output", null, null),
    ];
  }
  const created = own[0].type === contextCreated.type;
  const rest = created ? own.slice(1) : own;
  const steps = created
    ? rest.every((event) => event.type !== contextCreated.type) &&
        rest.every((event) => CONFIG_TYPES.has(event.type))
      ? (endsActive(rest) ? [{ op: "archive" } as Step] : [])
      : null
    : stepsOf(own);
  if (steps === null) {
    return [
      draft(context, seqs, "irreversible", "unclassified_event", null, null),
    ];
  }
  const first = own[0].payload as { before_revision?: unknown } | undefined;
  return [
    draft(
      context,
      seqs,
      "reversible",
      null,
      {
        kind: "context",
        context,
        base_revision: revision,
        steps,
      },
      created ? { kind: "created_context", context } : {
        kind: "context_state",
        context,
        revision: String(first?.before_revision ?? ""),
      },
    ),
  ];
}

export function createContextOwner(): RevertOwner {
  return {
    concern: CONTEXT_REVERT_OWNER,
    claims: (type) => OWN_TYPES.has(type),
    classify({ events, lookup }) {
      const drafts: GroupDraft[] = [];
      for (const { subject, own } of bySubject(events)) {
        const context = targetOf(subject === "" ? null : subject);
        if (context === null) {
          drafts.push(draft(
            null,
            own.map((event) => event.seq),
            "irreversible",
            "unclassified_event",
            null,
            null,
          ));
          continue;
        }
        drafts.push(
          ...classifyContext(context, own, subjectEvents(lookup, context)),
        );
      }
      return drafts;
    },
    restore(tx, group) {
      const context = group.target;
      if (context === null) {
        return err({
          code: "invalid_input",
          message: "this group has nothing to restore",
        });
      }
      const applied = applySteps(tx, group.comparison, (tx, step, base) => {
        switch (step.op) {
          case "update": {
            const { op: _op, ...fields } = step;
            return callOf(tx, contextUpdate, { context, ...fields }, base);
          }
          case "set_item":
            return callOf(tx, contextSetItem, {
              context,
              item: step["item"],
              ...(step["position"] === undefined
                ? {}
                : { position: step["position"] }),
            }, base);
          case "remove_item":
            return callOf(tx, contextRemoveItem, {
              context,
              target: step["target"],
            }, base);
          case "archive":
            return callOf(tx, contextArchive, { context }, base);
          case "unarchive":
            return callOf(tx, contextUnarchive, { context }, base);
          default:
            return err({
              code: "invalid_input",
              message: "this step is not a context restore",
            });
        }
      });
      return applied.ok ? ok(undefined) : applied;
    },
  };
}
