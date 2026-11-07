import type { Result } from "../../../base/mod.ts";
import type { NoticeRecordInput } from "../../../protocol/apps/notice.ts";
import type { AppSdkStatus } from "../../../protocol/apps/sdk-status.ts";

export const SDK_UPDATE_NOTICE_KEY = "sdk_update_needed";

// 앱을 필수(옮겨야 한다)와 가능(필수는 없고 새 SDK 판만 있다)으로 센다. 한 앱은 한 쪽에만 든다.
export function countSdkUpdates(statuses: readonly AppSdkStatus[]): {
  required: number;
  available: number;
} {
  let required = 0;
  let available = 0;
  for (const status of statuses) {
    if (status.sdks.some((sdk) => sdk.level === "required")) required += 1;
    else if (status.sdks.some((sdk) => sdk.level === "available"))
      available += 1;
  }
  return { required, available };
}

// 앱마다 줄을 만들지 않는다: 각 앱을 두고 갈지 올릴지 보는 일(숲)은 사람이 아니라 home lophn의 몫이고, 줄은 그 대화를 여는 입구
// 하나다. key가 같아 되풀이되는 기동이 줄을 늘리지 않고 그 줄을 새 개수로 바꿔 안 읽음으로 되돌린다.
// 이미 지난 앱의 옛 줄(앱마다 있던 것)은 건드리지 않는다: 줄은 그때 lophn 판의 기록이고, 지금 상태는 SDK 상태 read가 말한다.
export async function recordSdkUpdates(
  statuses: readonly AppSdkStatus[],
  record: (input: NoticeRecordInput) => Promise<Result<{ id: string }>>,
): Promise<Result<unknown> | null> {
  const counts = countSdkUpdates(statuses);
  if (counts.required + counts.available === 0) return null;
  return await record({
    kind: "sdk_update_needed",
    key: SDK_UPDATE_NOTICE_KEY,
    params: counts,
    action: { kind: "open_home_skill", skill: "update-apps", args: "" },
  });
}
