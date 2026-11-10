// 앱 view가 agent에게 call을 보내고 session을 끝내고 agent 명함을 읽는 길. page의 `lophnApp.calls`·`lophnApp.agents`·`lophnApp.sessions.end`가
// 한 channel로 부른다(`{ op, input }`). 앱은 자기를 보내지 않는다: main이 sender view에서 앱을 정하고 core가 그 앱의 시야(앱 workspace에서
// call로 닿을 수 있는 workspace)로 판정한다. main·preload가 함께 부르므로 import가 없다.

export const APP_AGENTS_CHANNEL = "app:agents";

export const APP_AGENTS_OPS = [
  "sessions.end",
  "calls.send",
  "calls.read",
  "calls.cancel",
  "calls.list",
  "agents.list",
] as const;
export type AppAgentsOp = (typeof APP_AGENTS_OPS)[number];
