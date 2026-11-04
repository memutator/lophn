// 앱 view의 agent 통로. page의 `lophnApp.agent`가 부르는 세 channel(`open`·`snapshot`·`send`)은 앱 preload가
// main에 보내고, 갱신은 main이 그 view로 보낸다. 앱·place는 보내지 않는다: main이 sender view에서 정한다.
// main·preload가 함께 부르므로 import가 없다.

export const APP_AGENT_OPEN_CHANNEL = "app:agent-open";
export const APP_AGENT_SNAPSHOT_CHANNEL = "app:agent-snapshot";
export const APP_AGENT_SEND_CHANNEL = "app:agent-send";
/** main → page. 값은 `{session, update}`(`AcpUpdated`의 payload)다. */
export const APP_AGENT_UPDATE_CHANNEL = "app:agent-update";
