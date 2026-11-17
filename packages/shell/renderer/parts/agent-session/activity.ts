// agent session 하나의 상태 점과 sidebar의 자리를 정하는 규칙. DOM이 없어 desktop sidebar와 폰 sidebar가 같이 쓴다.
// 그래서 점의 뜻이나 Recent의 경계를 고치면 두 곳이 같이 바뀐다.

/** 기다림, 도는 중, 끝남, 사람이 보지 않는 사이 turn이 끝남. */
export type SessionDot = "waiting" | "working" | "ended" | "finished";

/** session 안 agent의 지금. unseen은 사람이 보지 않는 사이 turn이 끝난 것이다. */
export interface AgentSessionActivity {
  readonly state: "running" | "waiting" | "idle" | "unknown";
  readonly unseen: boolean;
  readonly ended: boolean;
}

/** 도는 중이나 기다리는 중이 먼저고, 아니면 못 본 turn 끝이 finished다. */
export function activityDot(activity: AgentSessionActivity): SessionDot | null {
  if (activity.ended) return "ended";
  if (activity.state === "running") return "working";
  if (activity.state === "waiting") return "waiting";
  return activity.unseen ? "finished" : null;
}

export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 최근 7일 안에 움직였고 사람이 지운 뒤 움직였다. 시각을 모르는 줄(at 0)은 7일 경계로 지우지 않는다. */
export function recentVisible(
  at: number,
  now: number,
  hiddenAt?: number,
): boolean {
  if (hiddenAt !== undefined && at <= hiddenAt) return false;
  return at === 0 || now - at <= RECENT_WINDOW_MS;
}

/**
 * session 줄의 자리. 탭이 열렸거나 끝나지 않았고 점이 있으면(도는 중, 기다리는 중, 못 본 turn 끝) current, 아니면 Recent의
 * 경계 안이면 recent, 그 밖은 줄이 없다. 탭이 없는 폰은 open이 늘 false다.
 */
export function sessionPlace(input: {
  readonly dot: SessionDot | null;
  readonly open: boolean;
  readonly at: number;
  readonly now: number;
  readonly hiddenAt?: number;
}): "current" | "recent" | null {
  if (input.open || (input.dot !== null && input.dot !== "ended"))
    return "current";
  return recentVisible(input.at, input.now, input.hiddenAt) ? "recent" : null;
}

/** current 줄의 순서: session id는 시각 순이라 만든 순이다. 상태가 바뀌어도 자리를 지키고 새 줄은 끝에 붙는다. */
export const byCreated = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** Recent 줄의 순서: 최근 움직인 것이 먼저다. */
export const byNewest = (a: { at: number }, b: { at: number }): number =>
  b.at - a.at;
