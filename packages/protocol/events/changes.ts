// 상태를 바꾸는 route가 무엇을 바꾸는지 적는 이름이다. 이름은 화면이 읽는 단위이고 표 이름이 아니다.
// 화면은 자기가 읽는 이름의 `StateChanged`를 받으면 다시 읽는다. id는 그 단위 안의 대상이고 null이면 단위 전체다.
// route/base가 이 file의 type을 쓰므로 이 file은 아무것도 import하지 않는다.
export const CHANGE_NAMES = [
  "agents",
  "projects",
  "apps",
  "app_runtime",
  "app_grants",
  "app_activity",
  "releases",
  "activation_consents",
  "share_requests",
  "notices",
  "annotations",
  "packages",
  "sessions",
  "runs",
  "jobs",
  "workflow_instances",
  "settings",
  "tray",
  "widgets",
  "secrets",
  "logins",
  "providers",
  "models",
  "extension_settings",
  "remote_devices",
  "unseen",
  "coding_sessions",
  "terminal_saved_sessions",
  "browser_pages",
  "carry_files",
] as const;

export type ChangeName = (typeof CHANGE_NAMES)[number];

export type StateChange = { name: ChangeName; id: string | null };

// route 정의의 `changes` 항목. 이름만 적으면 id는 null이다. id는 handler가 받은 입력과 성공 결과에서 뽑는다.
// method 꼴이라 입력·결과 type이 다른 route 정의도 한 목록(Route)에 든다.
export type RouteChange<I = unknown, O = unknown> =
  | ChangeName
  | { name: ChangeName; id(input: I, output: O): string | null };

export function resolveChanges(
  changes: readonly RouteChange[] | undefined,
  input: unknown,
  output: unknown,
): StateChange[] {
  return (changes ?? []).map((change) =>
    typeof change === "string"
      ? { name: change, id: null }
      : { name: change.name, id: change.id(input, output) },
  );
}

type StateChangedEvent = {
  type: "StateChanged";
  subject: null;
  at: string;
  payload: { changes: StateChange[] };
};

// route 밖에서 상태를 바꾸는 곳도 이것으로 낸다. 같은 {name, id}는 한 번만 싣고, 빈 목록이면 내지 않는다.
export function publishStateChanged(
  bus: { publish(event: StateChangedEvent): void },
  at: string,
  changes: readonly StateChange[],
): void {
  const seen = new Set<string>();
  const unique: StateChange[] = [];
  for (const change of changes) {
    const key = JSON.stringify([change.name, change.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ name: change.name, id: change.id });
  }
  if (unique.length === 0) return;
  bus.publish({
    type: "StateChanged",
    subject: null,
    at,
    payload: { changes: unique },
  });
}
