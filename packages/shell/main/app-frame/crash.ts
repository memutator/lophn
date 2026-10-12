// 깨진 앱 view의 상태와 새 view 열기(architecture/shell 실패 표 "앱 view
// crash·무한 loop"). renderer process가 사라지면 crashed, 응답이 없으면 unresponsive다. 이
// 상태는 연결 상태와 함께 그 창의 shell 크롬에 알린다. main은 깨진 view를 스스로 다시
// load하거나 앱을 다시 부르지 않는다: 사람이 [새 view 열기]를 누를 때만 지금 연결(같은
// binding)로 새 contents를 만든다. 다른 view·shell 크롬은 각자의 process라 그대로 동작하지만
// WebContents 분리가 CPU·메모리 격리를 약속하지는 않는다(architecture/shell 보장하지 않는 것).
export type ViewHealth = "ok" | "unresponsive" | "crashed";

/** Electron webContents에서 오는 view 상태 신호. */
export type ViewHealthSignal = "gone" | "unresponsive" | "responsive";

/**
 * 다음 상태. crashed는 새 view를 열 때까지 그대로다(늦은 responsive로 되살리지 않는다).
 * 바뀌지 않으면 같은 값을 돌려준다.
 */
export function nextHealth(
  current: ViewHealth,
  signal: ViewHealthSignal,
): ViewHealth {
  if (current === "crashed") return current;
  if (signal === "gone") return "crashed";
  if (signal === "unresponsive") return "unresponsive";
  return "ok";
}

/** 새 view 열기는 깨진 view에만 준다. 건강한 view를 다시 여는 길이 아니다. */
export function reopenable(health: ViewHealth): boolean {
  return health !== "ok";
}
