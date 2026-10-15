import type {
  AgentRef,
  sendMessage,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Result } from "../../../base/mod.ts";
import type {
  Input,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import type { PermanentBlobReference } from "../../../protocol/storage/mod.ts";
import { type MessageRouter, sendToNewSession } from "./message-commands.ts";

// 사람이 다른 concern의 화면에서 누른 단추 한 번(예: 위반을 붙여 Project Manager 부르기)을 그 agent의
// 새 session과 사람 요청 message로 접수한다. 새 session은 Router가 연다(`to: new_session`). session 열기,
// message 저장, 입력함 넣기가 부른 쪽의 transaction 안에서 끝나므로 하나라도 실패하면 아무것도 남지 않는다.
// 사람이 글을 쓰지 않았어도 요청의 actor는 user이고 이후 turn은 일반 사람 메시지의 turn과 같다.

// 요청 본문의 blob은 부른 쪽이 이미 저장하고 영구 참조를 등록해 둔다. message의 body 참조는 그 참조를
// 가리키는 기존 참조로 등록한다(내용이 같은 blob 하나를 나눠 쓴다).
export type StartRequestInput = {
  agent: AgentRef;
  content: Input<typeof sendMessage>["content"];
  body: PermanentBlobReference;
};

export type StartedRequest = { session: string; message: string };

export type StartRequestDeps = { router: MessageRouter };

// 이 자격은 사람이 누른 단추의 효과라서 actor가 user이고, command 안의 사람 검사에만 쓰인다.
const REQUESTER: RequestContext = {
  principal: "user",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user",
};

export function startRequest(
  deps: StartRequestDeps,
  tx: Tx,
  input: StartRequestInput,
): Result<StartedRequest> {
  return sendToNewSession(deps, tx, REQUESTER, {
    id: tx.newId("msg"),
    agent: input.agent,
    content: input.content,
  }, input.body);
}
