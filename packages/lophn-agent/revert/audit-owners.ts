import { err } from "../../base/mod.ts";
import {
  MESSAGE_EVENTS,
  MODEL_CALL_EVENTS,
  QUESTION_EVENTS,
  RUN_EVENTS,
  RUN_WAIT_EVENTS,
  SESSION_EVENTS,
  TOOL_CALL_EVENTS,
} from "../../contracts/lophn-agent/mod.ts";
import { APPROVAL_EVENTS } from "../../contracts/platform/mod.ts";
import {
  type GroupDraft,
  type RevertOwner,
  sortSeqs,
  targetOf,
} from "./model.ts";

// run·tool call·model call·질문·승인 결정 같은 과거 사실은 복원하지 않고 모두 유지한다(R6, R8).
// 이 owner들은 event를 대상별로 묶어 retained로 설명할 뿐이고 복원 command가 없다. 사실·사용량·
// 결정은 revert가 지우거나 고치지 않는다.
function auditOwner(
  concern: string,
  definitions: readonly { type: string }[],
): RevertOwner {
  const types = new Set(definitions.map((definition) => definition.type));
  return {
    concern,
    claims: (type) => types.has(type),
    classify({ events }) {
      const bySubject = new Map<string, string[]>();
      for (const event of events) {
        const key = event.subject ?? "";
        const list = bySubject.get(key) ?? [];
        list.push(event.seq);
        bySubject.set(key, list);
      }
      return [...bySubject.entries()].map(([subject, seqs]): GroupDraft => ({
        owner: concern,
        target: targetOf(subject === "" ? null : subject),
        source_seqs: sortSeqs(seqs),
        capability: "retained",
        reason: "audit_fact",
        comparison: null,
        before_ref: null,
        dependencies: [],
      }));
    },
    restore() {
      return err({
        code: "invalid_input",
        message: "an audit fact is never restored",
      });
    },
  };
}

export function createAuditOwners(): RevertOwner[] {
  return [
    auditOwner("lophn-agent/harness/run-loop", [
      ...RUN_EVENTS,
      ...RUN_WAIT_EVENTS,
    ]),
    auditOwner("lophn-agent/harness/tools", TOOL_CALL_EVENTS),
    auditOwner("lophn-agent/harness/usage", MODEL_CALL_EVENTS),
    auditOwner("lophn-agent/questions", QUESTION_EVENTS),
    auditOwner("lophn-agent/conversation", [
      ...SESSION_EVENTS,
      ...MESSAGE_EVENTS,
    ]),
    auditOwner("platform/approvals", APPROVAL_EVENTS),
  ];
}
