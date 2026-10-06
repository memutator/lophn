import { err, ok, type Result } from "../../base/mod.ts";
import {
  type acceptRun,
  handoffSubmit,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  type Compare,
  type Input,
  type Output,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import {
  bodyBlob,
  checkReferences,
  directionAllowed,
  HANDOFF_BODY_FIELD,
  HANDOFF_BODY_OWNER_KIND,
  HANDOFF_CONTENT_MAX_BYTES,
  handoffContentBytes,
  humanOrigin,
  loadAssignmentRef,
  loadByDedup,
  loadRunRef,
  sameHandoff,
} from "./model.ts";

// SubmitHandoff는 AcceptRun의 출처 검사 wrapper다. 보낸 run·방향·원래 사람 요청·
// 근거를 검사한 뒤 run-loop의 AcceptRun handler를 같은 Tx에서 불러 받는 assignment의
// 독립 run 하나를 접수한다. 송신 사실(받는 run의 source)과 접수·내용 blob 참조 등록이
// 한 transaction이라 하나라도 실패하면 이전 판 전체가 남는다(R9). 등록 순서는 입력
// 검사 → 상태 재검사 → 쓰기다. 새 command 권한은 받는 쪽에 옮기지 않는다: 접수한
// run은 자기 assignment의 scope와 tool 판정을 처음부터 다시 적용받는다(R6).

export type HandoffDeps = {
  // 같은 Tx에서 run을 접수한다(run-loop AcceptRun). 조립이 handler를 건다.
  acceptRun: (
    tx: Tx,
    ctx: RequestContext,
    input: Input<typeof acceptRun>,
    compare: Compare<typeof acceptRun>,
  ) => Result<Output<typeof acceptRun>>;
};

type Code = "invalid_input" | "conflict" | "not_found" | "unavailable";

function reject(code: Code, message: string): Result<never> {
  return err({ code, message });
}

export function createHandoffCommands(deps: HandoffDeps): {
  submit: CommandDefinition<typeof handoffSubmit>;
} {
  return {
    submit: {
      route: handoffSubmit,
      handle(tx, ctx, input: Input<typeof handoffSubmit>) {
        const actor = parseActor(ctx.actor);
        if (actor === undefined || actor.kind !== "agent") {
          return err({
            code: "forbidden",
            message: "only an agent hands off",
          });
        }
        // 보낸 run은 이 자격이 묶인 run이고 그 run의 assignment가 보낸다. 그 밖의 run은
        // 없는 run과 똑같이 답한다.
        const sender = loadRunRef(tx, input.sender_run);
        if (
          sender === undefined || sender.assignment !== actor.id ||
          ctx.run !== sender.id
        ) {
          return reject("not_found", "run not found");
        }
        // 같은 요청의 재전송은 저장된 결과만 돌려주고 새 run을 만들지 않는다. 받는
        // assignment가 그 사이 멈췄거나 회수돼도 같다(plan Q24).
        const prior = loadByDedup(tx, input.sender_run, input.dedup_key);
        if (prior !== undefined) {
          if (!sameHandoff(prior, input, input.sender_run, input.dedup_key)) {
            return reject(
              "conflict",
              "the same handoff key had other content",
            );
          }
          return ok({
            receiver_run: prior.id,
            accepted_seq: prior.accepted_seq,
            replayed: true,
          });
        }
        if (sender.state !== "running") {
          return reject("conflict", "only a running run hands off");
        }
        const origin = humanOrigin(sender.source);
        if (origin === null) {
          return reject(
            "invalid_input",
            "only a run that continues a human request hands off",
          );
        }
        if (origin !== input.original_message) {
          return reject(
            "invalid_input",
            "the original request is not the sender's request",
          );
        }
        const from = loadAssignmentRef(tx, sender.assignment);
        if (from === undefined || from.role !== input.from_role) {
          return reject("invalid_input", "from_role is not the sender's role");
        }
        const to = loadAssignmentRef(tx, input.receiver_assignment);
        if (to === undefined) {
          return reject("unavailable", "no assignment can take this handoff");
        }
        if (to.role !== input.to_role) {
          return reject("invalid_input", "to_role is not the receiver's role");
        }
        if (!directionAllowed(from.role, to.role)) {
          return reject("invalid_input", "handoff direction is not allowed");
        }
        if (input.receiver_assignment === sender.assignment) {
          return reject("invalid_input", "a handoff must cross assignments");
        }
        // 담당이 멈췄거나 회수됐으면 시작하지 않는다. 담당 없는 대기열은 없다(R2).
        if (to.state !== "enabled") {
          return reject("unavailable", "no assignment can take this handoff");
        }
        const checked = checkReferences(tx, to.role, input.references);
        if (!checked.ok) return checked;
        // 내용 값은 core가 redaction해 blob으로 준비했다. command는 같은 값에서 같은
        // hash를 다시 만들어 맞는지 본다.
        const bytes = handoffContentBytes(input.content);
        if (bytes.length > HANDOFF_CONTENT_MAX_BYTES) {
          return reject("invalid_input", "handoff content is too large");
        }
        const blob = bodyBlob(ctx.principal, input.content);
        if (blob.hash !== input.body) {
          return reject("invalid_input", "body does not match the content");
        }
        const accepted = deps.acceptRun(
          tx,
          { ...ctx, actor: "machine" },
          {
            id: input.receiver_run,
            assignment: input.receiver_assignment,
            session: null,
            source: {
              kind: "handoff",
              sender_run: input.sender_run,
              original_message: input.original_message,
              body: input.body,
              references: input.references,
              dedup_key: input.dedup_key,
            },
            continued_from: null,
            start_after: null,
          },
          { assignment_revision: to.revision },
        );
        if (!accepted.ok) return accepted;
        const registered = tx.registerBlobRef({
          owner_kind: HANDOFF_BODY_OWNER_KIND,
          owner_key: accepted.value.id,
          field: HANDOFF_BODY_FIELD,
          registered_seq: accepted.value.accepted_seq,
          source: { kind: "prepared", blob: blob.evidence },
        });
        if (!registered.ok) return registered;
        return ok({
          receiver_run: accepted.value.id,
          accepted_seq: accepted.value.accepted_seq,
          replayed: false,
        });
      },
    },
  };
}
