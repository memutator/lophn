// 보낸 session의 call 블록. 그리는 일은 renderer의 CallBlock이고, 이 file은 app-space/side-pane이 쓰는 props(받는 곳, 맡긴
// 글, 답 방식, 상태)로 맞추는 adapter다.
import type {
  AgentTabSource,
  CallFailReason,
  CallReply,
  CallState,
} from "../../../../../packages/shell/renderer/conversation/agent-tab-source.ts";
import { CallBlock as ThreadCallBlock } from "../../../../../packages/shell/renderer/conversation/thread/call-block.tsx";

export interface CallBlockCall {
  readonly to: string;
  readonly task: string;
  readonly reply: CallReply;
  readonly state: CallState;
  readonly reason?: CallFailReason;
  /** 옛 화면이 싣던 시각. 그리지 않는다. */
  readonly time?: string;
}

// 상태를 다시 읽거나 취소하는 길이 없는 화면이다. 읽으면 처음 상태를 그대로 돌려준다.
function sourceOf(
  call: CallBlockCall,
): Pick<AgentTabSource, "callState" | "cancelCall"> {
  return {
    callState: () =>
      Promise.resolve({
        ok: true,
        value: { state: call.state, reason: call.reason ?? null },
      }),
    cancelCall: () => Promise.resolve({ ok: true, value: undefined }),
  };
}

export function CallBlock(
  { call, defaultOpen = false }: {
    call: CallBlockCall;
    defaultOpen?: boolean;
  },
) {
  return (
    <ThreadCallBlock
      call={{
        call: "cal_01h455vb4pex5v6nkc6gd5f001",
        to: call.to,
        task: call.task,
        reply: call.reply,
        status: { state: call.state, reason: call.reason ?? null },
      }}
      source={sourceOf(call)}
      defaultOpen={defaultOpen}
    />
  );
}
