import type { Result } from "../../../base/mod.ts";
import type { NoticeRecordInput } from "../../../protocol/apps/notice.ts";
import type { AppSdkStatus } from "../../../protocol/apps/sdk-status.ts";

export const SDK_UPDATE_NOTICE_KEY = "sdk_update_needed";

// program 줄의 매개변수는 200자까지다. 많으면 앞에서 자르고 나머지 수를 적는다.
const LIST_MAX = 180;

function requiredList(status: AppSdkStatus): string {
  const items = status.sdks
    .filter((sdk) => sdk.level === "required")
    .map((sdk) => `${sdk.sdk} ${sdk.pinned} -> ${sdk.current}`);
  let text = "";
  for (const [at, item] of items.entries()) {
    const next = text === "" ? item : `${text}, ${item}`;
    if (next.length > LIST_MAX) return `${text} and ${items.length - at} more`;
    text = next;
  }
  return text;
}

// 필수 SDK가 하나라도 있는 앱마다 줄 하나(key가 같아 되풀이되는 기동이 줄을 늘리지 않고 그 줄을 안 읽음으로 되돌린다).
// 이미 지난 앱의 옛 줄은 건드리지 않는다: 줄은 그때 lophn 판의 기록이고, 지금 상태는 SDK 상태 read가 말한다.
export async function recordSdkUpdates(
  statuses: readonly AppSdkStatus[],
  record: (input: NoticeRecordInput) => Promise<Result<{ id: string }>>,
): Promise<Result<unknown> | null> {
  let failed: Result<unknown> | null = null;
  for (const status of statuses) {
    if (!status.sdks.some((sdk) => sdk.level === "required")) continue;
    const done = await record({
      kind: "sdk_update_needed",
      app: status.app,
      key: SDK_UPDATE_NOTICE_KEY,
      params: { sdks: requiredList(status) },
      action: {
        kind: "open_home_skill",
        skill: "update-apps",
        args: status.name.slice(0, 500),
      },
    });
    if (!done.ok) failed = done;
  }
  return failed;
}

// 가능(available)만 있는 앱의 수다. lophn 업데이트 줄 한 줄에 싣는다.
export function optionalUpdateCount(statuses: readonly AppSdkStatus[]): number {
  return statuses.filter(
    (status) =>
      !status.sdks.some((sdk) => sdk.level === "required") &&
      status.sdks.some((sdk) => sdk.level === "available"),
  ).length;
}
