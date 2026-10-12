import { err, ok, type Result } from "../../base/mod.ts";
import type {
  openSession,
  receiveMessage,
} from "../../contracts/lophn-agent/mod.ts";
import type {
  Input,
  PermanentBlobReference,
  RequestContext,
  Tx,
} from "../../contracts/platform/mod.ts";
import {
  type ConversationDeps,
  createConversationCommands,
} from "./commands.ts";
import { receiveWith } from "./message-commands.ts";

// 사람이 다른 concern의 화면에서 누른 단추 한 번(예: 위반 넘기기)을, 그 역할 assignment의 새
// 세션과 사람 요청 message, 담당 run 하나로 접수한다. 세션 개설·message 저장·run 접수가 부른 쪽의
// transaction 안에서 끝나므로 하나라도 실패하면 아무것도 남지 않는다. 사람이 글을 쓰지 않았어도
// 요청의 actor는 user이고, 이후 run은 일반 사람 요청의 run과 같다(message 출처, human_request).

// 요청 본문의 blob은 부른 쪽이 이미 저장하고 영구 참조를 등록해 둔다. message의 body 참조는 그
// 참조를 가리키는 기존 참조로 등록한다(내용이 같은 blob 하나를 나눠 쓴다).
export type StartRequestInput = {
  role: "context_engineer";
  work_place: Input<typeof openSession>["work_place"];
  content: Input<typeof receiveMessage>["content"];
  body: PermanentBlobReference;
};

export type StartedRequest = { session: string; message: string; run: string };

// 이 요청 경로가 보내는 자격이다. 사람이 누른 단추의 효과라서 actor는 user이고, 이 자격은 command
// 안의 사람 검사에만 쓰인다(ledger의 event·권한은 바깥 command의 것이 그대로다).
const REQUESTER: RequestContext = {
  principal: "user",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user",
};

// 받을 assignment는 그 역할의 enabled 하나다. 없거나 paused면 unavailable이다. 주체 없는 대기열은
// 만들지 않는다(handoff와 같은 정책).
function receiverOf(
  tx: Tx,
  role: string,
): { id: string; revision: number } | undefined {
  const row = tx.sql.get(
    `select id, revision from assignments
     where role = ? and state = 'enabled' order by id limit 1`,
    [role],
  );
  return row === undefined
    ? undefined
    : { id: String(row["id"]), revision: Number(row["revision"]) };
}

// 이 경로는 세션을 열고 message를 받을 뿐 지우지 않는다. 그래서 run 접수 하나만 받고, 세션 삭제에 쓰는 의존은
// 부르면 오류가 나는 것으로 채운다.
export type StartRequestDeps = Pick<ConversationDeps, "acceptRun">;

const NEVER_DELETES = (): Result<void> =>
  err({ code: "internal", message: "a started request never deletes" });

export function startRequest(
  deps: StartRequestDeps,
  tx: Tx,
  input: StartRequestInput,
): Result<StartedRequest> {
  const receiver = receiverOf(tx, input.role);
  if (receiver === undefined) {
    return err({
      code: "unavailable",
      message: `no enabled ${input.role} assignment can take this request`,
    });
  }
  const commands = createConversationCommands({
    ...deps,
    deleteSessionRecords: NEVER_DELETES,
    eraseBlobRefs: NEVER_DELETES,
  });
  const session = tx.newId("ses");
  const opened = commands.open.handle(tx, REQUESTER, {
    id: session,
    assignment: receiver.id,
    work_place: input.work_place,
    opening_context: null,
  }, { assignment_revision: receiver.revision, assignment_state: "enabled" });
  if (!opened.ok) return opened;
  const message = tx.newId("msg");
  const received = receiveWith(deps.acceptRun, tx, REQUESTER, {
    id: message,
    session,
    content: input.content,
    mode: "request",
  }, {
    session_state: "open",
    session_state_seq: opened.value.state_seq,
    assignment_revision: receiver.revision,
    assignment_state: "enabled",
  }, input.body);
  if (!received.ok) return received;
  const run = tx.sql.get("select id from runs where source_message = ?", [
    message,
  ]);
  if (run === undefined) {
    return err({ code: "internal", message: "the request started no run" });
  }
  return ok({ session, message, run: String(run["id"]) });
}
