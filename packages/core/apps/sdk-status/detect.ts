import type { Result } from "../../../base/mod.ts";
import type { NoticeRecordInput } from "../../../protocol/apps/notice.ts";
import type { AppSdkStatus } from "../../../protocol/apps/sdk-status.ts";
import type { WorkflowFlowSdkStatus } from "../../../protocol/apps/updates.ts";
import { compareVersion } from "./status.ts";

export const SDK_UPDATE_NOTICE_KEY = "sdk_update_needed";
export const WORKSPACE_UPDATE_NOTICE_KEY = "workspace_update_needed";

export type WorkspaceUpdateCounts = {
  required_apps: number;
  required_workflows: number;
  unreviewed_apps: number;
  unreviewed_workflows: number;
  unreviewed_notes: number;
};

// 앱을 필수(옮겨야 한다)와 가능(필수는 없고 아직 검토하지 않은 새 메모가 있다)으로 센다. 한 앱은 한 쪽에만 든다. 그대로 두기로 한 앱은
// 새 판이 나와도 새 메모가 없으면 세지 않는다.
export function countSdkUpdates(statuses: readonly AppSdkStatus[]): {
  required: number;
  available: number;
} {
  let required = 0;
  let available = 0;
  for (const status of statuses) {
    if (status.sdks.some((sdk) => sdk.level === "required")) required += 1;
    else if (status.sdks.some((sdk) => sdk.unreviewed.length > 0))
      available += 1;
  }
  return { required, available };
}

// 활성 작업 공간 전체(앱 SDK, workflow flow_sdk, 플랫폼 역량 메모)의 5종 건수를 센다.
// required인 앱·workflow는 unreviewed에 중복으로 세지 않는다.
export function countWorkspaceUpdates(input: {
  apps: readonly AppSdkStatus[];
  workflows: readonly WorkflowFlowSdkStatus[];
  unreviewedNotes: number;
}): WorkspaceUpdateCounts {
  const apps = countSdkUpdates(input.apps);
  let required_workflows = 0;
  let unreviewed_workflows = 0;
  for (const wf of input.workflows) {
    if (wf.level === "required") {
      required_workflows += 1;
    } else if (
      wf.level === "available" &&
      (wf.reviewed_through === null ||
        compareVersion(wf.reviewed_through, wf.current) < 0)
    ) {
      unreviewed_workflows += 1;
    }
  }
  return {
    required_apps: apps.required,
    required_workflows,
    unreviewed_apps: apps.available,
    unreviewed_workflows,
    unreviewed_notes: Math.max(0, input.unreviewedNotes),
  };
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

// 통합 작업 공간 업데이트 알림 한 줄(`workspace_update_needed`)을 남기거나 갱신한다.
// 다섯 건수가 모두 0이면 열린 알림을 읽음으로 닫는다(program 행은 삭제하지 않는다).
export async function recordWorkspaceUpdates(
  input: {
    apps: readonly AppSdkStatus[];
    workflows: readonly WorkflowFlowSdkStatus[];
    unreviewedNotes: number;
    hasOpenNotice?: () => boolean;
  },
  record: (input: NoticeRecordInput) => Promise<Result<{ id: string }>>,
): Promise<Result<unknown> | null> {
  const counts = countWorkspaceUpdates(input);
  const total =
    counts.required_apps +
    counts.required_workflows +
    counts.unreviewed_apps +
    counts.unreviewed_workflows +
    counts.unreviewed_notes;
  if (total === 0) {
    if (input.hasOpenNotice !== undefined && !input.hasOpenNotice()) {
      return null;
    }
    const resolved = await record({
      kind: "workspace_update_needed",
      key: WORKSPACE_UPDATE_NOTICE_KEY,
      params: counts,
      action: { kind: "open_home_skill", skill: "update", args: "" },
    });
    if (!resolved.ok && resolved.error.code === "not_found") return null;
    return resolved;
  }
  return await record({
    kind: "workspace_update_needed",
    key: WORKSPACE_UPDATE_NOTICE_KEY,
    params: counts,
    action: { kind: "open_home_skill", skill: "update", args: "" },
  });
}
