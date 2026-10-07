// plugin·extension으로 event를 주는 제품(OpenCode·pi)의 normalizer다(sessions#R6, R7, T39, 조사 T6). payload는
// plugin·extension이 native event를 그대로 넘긴 JSON이다. 두 제품 모두 ended를 event로 만들지 않는다. process
// 종료는 host evidence이고 plugin·extension의 종료·idle 신호는 turn이나 runtime 사실이다.
import { type Evidence, type Normalizer, recordOf, textOf } from "./model.ts";
import type { SessionState } from "../../../contracts/coding-agent/mod.ts";

function evidenceOf(
  state: SessionState,
  source: "plugin" | "extension",
  ref: string,
  kind: string,
  id: string | null,
  transcriptPath: string | null,
): Evidence {
  return {
    state,
    source,
    ref,
    session: id === null ? null : { kind, id, transcriptPath },
    cwd: null,
    reason: null,
  };
}

// OpenCode plugin의 event는 `{type, properties}`이고 ID는 `properties.sessionID`다. busy·retry는 작업이고 idle은
// turn 끝이며, permission 요청은 대기이고 응답은 작업 재개다. session 삭제 event는 process 종료가 아니라 표에 없다.
// 하위 session attribution은 plugin이 root event만 넘기는 것으로 한다(조사 T6).
export const normalizeOpencode: Normalizer = (payload) => {
  const type = textOf(payload.type);
  const properties = recordOf(payload.properties);
  if (type === null || properties === null) return null;
  const id = textOf(properties.sessionID);
  const ref = `opencode:${type}`;
  if (type === "session.status") {
    const status = textOf(recordOf(properties.status)?.type);
    if (status === "busy" || status === "retry") {
      return evidenceOf("working", "plugin", ref, "opencode_session", id, null);
    }
    if (status === "idle") {
      return evidenceOf("ready", "plugin", ref, "opencode_session", id, null);
    }
    return null;
  }
  if (type === "session.idle") {
    return evidenceOf("ready", "plugin", ref, "opencode_session", id, null);
  }
  if (type === "permission.asked") {
    return evidenceOf(
      "waiting_input",
      "plugin",
      ref,
      "opencode_session",
      id,
      null,
    );
  }
  if (type === "permission.replied") {
    return evidenceOf("working", "plugin", ref, "opencode_session", id, null);
  }
  return null;
};

// pi extension의 payload는 `{event, session_id?, session_file?}`이고 ID와 session file은 extension이
// `ctx.sessionManager`에서 읽어 더한 값이다. ID와 file은 따로 보관한다. `agent_end`는 retry·compaction·queued
// continuation이 남을 수 있어 ready 근거가 아니고 `agent_settled`만 ready다(더 강한 event). `session_shutdown`은
// extension runtime 교체(reload·new·resume·fork)를 포함하므로 ended가 아니다. done·idle 같은 다른 이름도 같다.
export const normalizePi: Normalizer = (payload) => {
  const event = textOf(payload.event);
  if (event === null) return null;
  const id = textOf(payload.session_id);
  const file = textOf(payload.session_file);
  const ref = `pi:${event}`;
  switch (event) {
    case "agent_start":
    case "turn_start":
    case "tool_execution_start":
      return evidenceOf("working", "extension", ref, "pi_session", id, file);
    case "session_start":
    case "agent_settled":
      return evidenceOf("ready", "extension", ref, "pi_session", id, file);
    default:
      return null;
  }
};
