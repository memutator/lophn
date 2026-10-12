// app-detail의 순수 계산. 안쪽 값(상태 enum·command key·ID)을 사람 말로 바꾸는 자리이고, 원문은
// 화면의 자세히 보기에서만 쓴다.
import type { StatusTone } from "@lophn/design";
import { t } from "@lophn/wording";

import type {
  AccessKind,
  ActivityRow,
  ActivityStatus,
  BlueprintAutomation,
  Comparison,
  TaskChecks,
  TestResultKind,
  VersionStatus,
} from "./source.ts";

/** 앱 공간에 열려 있는 운영과 분리된 preview. */
export interface PreviewOpen {
  readonly release: string;
  readonly number: number;
  readonly screen: string;
  readonly nonce: string;
}

export function versionStatusText(status: VersionStatus): string {
  switch (status) {
    case "prepared":
      return t("app-detail.label.status-prepared");
    case "activating":
      return t("app-detail.label.status-applying");
    case "active":
      return t("app-detail.label.status-current");
    case "failed":
      return t("app-detail.label.status-failed");
    case "superseded":
      return t("app-detail.label.status-older");
  }
}

export function versionStatusTone(status: VersionStatus): StatusTone {
  switch (status) {
    case "active":
      return "good";
    case "activating":
      return "warning";
    case "failed":
      return "serious";
    default:
      return "neutral";
  }
}

/** 적용 결과. 준비(저장)와 다르다. */
export function appliedText(status: VersionStatus): string {
  switch (status) {
    case "active":
      return t("app-detail.label.applied-yes");
    case "activating":
      return t("app-detail.label.applied-working");
    case "failed":
      return t("app-detail.label.applied-failed");
    case "superseded":
      return t("app-detail.label.applied-before");
    case "prepared":
      return t("app-detail.label.applied-no");
  }
}

export function testResultText(result: TestResultKind): string {
  switch (result) {
    case "pass":
      return t("app-detail.label.test-pass");
    case "fail":
      return t("app-detail.label.test-fail");
    case "inconclusive":
      return t("app-detail.label.test-inconclusive");
  }
}

/** Task의 확인 결과. 보고 접수와 실제 통과를 구별한다. */
export function taskChecksText(checks: TaskChecks): string {
  if (!checks.reported) return t("app-detail.label.task-pending");
  if (checks.failed > 0) return t("app-detail.label.task-failed");
  if (checks.unclear > 0) return t("app-detail.label.task-unclear");
  if (checks.passed === 0) return t("app-detail.label.task-none");
  return t("app-detail.label.task-passed");
}

export interface ChangeLine {
  readonly key: string;
  readonly text: string;
}

/** 바뀐 것의 요약. 개수만 말하고 이름은 자세히 보기에 둔다. */
export function changeLines(c: Comparison): readonly ChangeLine[] {
  const lines: ChangeLine[] = [];
  const add = (key: string, text: string, count: number) => {
    if (count > 0) lines.push({ key, text });
  };
  add(
    "commands-added",
    t("app-detail.label.change-actions-added", {
      count: c.addedCommands.length,
    }),
    c.addedCommands.length,
  );
  add(
    "commands-removed",
    t("app-detail.label.change-actions-removed", {
      count: c.removedCommands.length,
    }),
    c.removedCommands.length,
  );
  add(
    "commands-changed",
    t("app-detail.label.change-actions-changed", {
      count: c.changedCommands.length,
    }),
    c.changedCommands.length,
  );
  add(
    "commands-external",
    t("app-detail.label.change-actions-external", {
      count: c.externalCommands.length,
    }),
    c.externalCommands.length,
  );
  const screens = c.addedScreens.length + c.removedScreens.length +
    c.changedScreens.length;
  add(
    "screens",
    t("app-detail.label.change-screens", { count: screens }),
    screens,
  );
  const automations = c.addedAutomations.length +
    c.removedAutomations.length + c.changedAutomations.length;
  add(
    "automations",
    t("app-detail.label.change-automations", { count: automations }),
    automations,
  );
  add(
    "access-added",
    t("app-detail.label.change-access-added", {
      count: c.addedPermissions.length,
    }),
    c.addedPermissions.length,
  );
  add(
    "access-removed",
    t("app-detail.label.change-access-removed", {
      count: c.removedPermissions.length,
    }),
    c.removedPermissions.length,
  );
  if (c.dataFrom !== c.dataTo || c.dataChanges.length > 0) {
    lines.push({
      key: "data",
      text: t("app-detail.label.change-data", {
        from: String(c.dataFrom),
        to: String(c.dataTo),
      }),
    });
  }
  return lines;
}

/** 자세히 보기에 보이는 바뀐 이름 묶음. 이름은 앱이 지은 원문이다. */
export interface DetailGroup {
  readonly key: string;
  readonly heading: string;
  readonly items: readonly {
    sign: "add" | "delete" | "change";
    name: string;
  }[];
}

export function detailGroups(c: Comparison): readonly DetailGroup[] {
  const groups: DetailGroup[] = [
    {
      key: "actions",
      heading: t("app-detail.heading.detail-actions"),
      items: [
        ...c.addedCommands.map((name) => ({ sign: "add" as const, name })),
        ...c.removedCommands.map((name) => ({ sign: "delete" as const, name })),
        ...c.changedCommands.map((change) => ({
          sign: "change" as const,
          name: change.command,
        })),
      ],
    },
    {
      key: "screens",
      heading: t("app-detail.heading.detail-screens"),
      items: [
        ...c.addedScreens.map((name) => ({ sign: "add" as const, name })),
        ...c.removedScreens.map((name) => ({ sign: "delete" as const, name })),
        ...c.changedScreens.map((name) => ({ sign: "change" as const, name })),
      ],
    },
    {
      key: "automations",
      heading: t("app-detail.heading.detail-automations"),
      items: [
        ...c.addedAutomations.map((name) => ({ sign: "add" as const, name })),
        ...c.removedAutomations.map((name) => ({
          sign: "delete" as const,
          name,
        })),
        ...c.changedAutomations.map((name) => ({
          sign: "change" as const,
          name,
        })),
      ],
    },
    {
      key: "access",
      heading: t("app-detail.heading.detail-access"),
      items: [
        ...c.addedPermissions.map((name) => ({ sign: "add" as const, name })),
        ...c.removedPermissions.map((name) => ({
          sign: "delete" as const,
          name,
        })),
      ],
    },
    {
      key: "data",
      heading: t("app-detail.heading.detail-data"),
      items: c.dataChanges.map((name) => ({ sign: "change" as const, name })),
    },
  ];
  return groups.filter((group) => group.items.length > 0);
}

/** 이 비교로 저장된 데이터가 바뀌면 이전 Version으로 돌아가도 되돌아가지 않는다. */
export function dataConverts(c: Comparison): boolean {
  return c.dataFrom !== c.dataTo || c.dataChanges.length > 0;
}

export function scheduleText(when: BlueprintAutomation["when"]): string {
  if (when.kind === "on_start") return t("app-detail.label.schedule-start");
  return t("app-detail.label.schedule-interval", {
    minutes: Math.max(1, Math.round(when.intervalMs / 60000)),
  });
}

export function activityStatusText(status: ActivityStatus): string {
  switch (status) {
    case "succeeded":
      return t("app-detail.label.status-done");
    case "failed":
      return t("app-detail.label.status-didnt-finish");
    case "denied":
      return t("app-detail.label.status-blocked");
    case "unknown":
      return t("app-detail.label.status-result-unknown");
    case "running":
      return t("app-detail.label.status-working");
    case "accepted":
      return t("app-detail.label.status-waiting");
  }
}

export function activityTone(status: ActivityStatus): StatusTone {
  switch (status) {
    case "succeeded":
      return "good";
    case "failed":
      return "serious";
    case "denied":
      return "warning";
    case "unknown":
      return "warning";
    default:
      return "neutral";
  }
}

/** 이 행이 그 automation의 활동인지. */
export function isAutomationActivity(row: ActivityRow, key: string): boolean {
  return row.trigger.kind === "automation" && row.trigger.key === key;
}

/** Access 탭이 파일·host 같은 범위를 묶는 갈래. app.call·automation.run은 다른 탭이다. */
export const ACCESS_GROUPS: readonly {
  readonly kind: AccessKind;
  readonly heading: () => string;
}[] = [
  { kind: "fs.read", heading: () => t("app-detail.heading.access-files-read") },
  {
    kind: "fs.write",
    heading: () => t("app-detail.heading.access-files-write"),
  },
  { kind: "net.fetch", heading: () => t("app-detail.heading.access-network") },
  { kind: "net.listen", heading: () => t("app-detail.heading.access-listen") },
  {
    kind: "secret.use",
    heading: () => t("app-detail.heading.access-secrets"),
  },
  {
    kind: "document.save",
    heading: () => t("app-detail.heading.access-documents"),
  },
  {
    kind: "agent.commands",
    heading: () => t("app-detail.heading.access-agents"),
  },
];

/** apps가 정한 조합 경고 key를 화면 말로. 모르는 key는 일반 경고다. */
export function warningText(key: string): string {
  if (key === "permissions.warning.file-read-and-network") {
    return t("app-detail.note.warning-read-network");
  }
  if (key === "permissions.warning.outside-link") {
    return t("app-detail.note.warning-outside-link");
  }
  return t("app-detail.note.warning-other");
}
