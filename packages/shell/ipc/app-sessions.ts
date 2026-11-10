// 앱 view의 session 길. page의 `lophnApp.sessions`(list·status·stop)가 부른다. 앱은 보내지 않는다: main이 sender view에서 앱을 정하고
// core가 그 앱의 시야(앱 workspace에 사는 agent가 call로 닿을 수 있는 workspace)로 판정한다. main·preload가 함께 부르므로 import가 없다.

export const APP_SESSIONS_LIST_CHANNEL = "app:sessions-list";
export const APP_SESSIONS_STATUS_CHANNEL = "app:sessions-status";
export const APP_SESSIONS_STOP_CHANNEL = "app:sessions-stop";
