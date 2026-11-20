import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activationsCompare,
  activationsQueue,
  appGet,
  appGrantsList,
  appInvocations,
  appLogs,
  appRewindPlan,
  appRuntime,
  appSdkStatus,
  appsOAuthState,
  appUpdateState,
  noticesList,
  releasesGetRecord,
  releasesListRecords,
} from "../apps/mod.ts";
import { appIcon, appTools } from "../apps/declaration/read.ts";
import { agentRead } from "../lophn-agent/agent-definitions.ts";
import { workspaceSessionRead } from "../lophn-agent/agent-sessions.ts";
import { REMOTE_ALLOWED_ROUTES } from "./allowlist.ts";

// 다른 컴퓨터의 App details는 읽기만 하고 route를 이 목록에서 고른다. 읽기 하나가 목록에서 빠지면 그 절이 통째로 실패한다.
test("다른 컴퓨터의 App details가 읽는 route는 모두 기기의 목록 안이고 사람이 부를 수 있다", () => {
  const allowed = new Set(REMOTE_ALLOWED_ROUTES.map((route) => route.name));
  const reads = [
    appGet,
    appRuntime,
    appLogs,
    appTools,
    appIcon,
    appGrantsList,
    appInvocations,
    appRewindPlan,
    noticesList,
    releasesListRecords,
    releasesGetRecord,
    activationsQueue,
    activationsCompare,
    appSdkStatus,
    appUpdateState,
    appsOAuthState,
    agentRead,
    workspaceSessionRead,
  ];
  for (const route of reads) {
    assert.ok(
      allowed.has(route.name),
      `${route.name} is not in the device list`,
    );
    assert.ok(
      route.actors.includes("user"),
      `${route.name} is not user-callable`,
    );
  }
});
