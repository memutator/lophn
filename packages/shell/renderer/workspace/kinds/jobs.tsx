// jobs 탭 kind. Scheduled jobs 전체를 보고 고치는 탭이고 desk마다 하나다. 값은 모두 core의 jobs 표에 있어 layout에는
// 탭이 있다는 사실만 남는다. 어느 place에서든 모든 job을 보인다.
import { t } from "@lophn/i18n";

import { runToastAction } from "../../desktop/connection/toasts/toast-actions.ts";
import { JobsPage } from "../../desktop/jobs/jobs-page.tsx";
import { shellIcons } from "../../icons/mod.ts";
import { PaddedTab } from "../padded-tab.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

// 고정 key라 다시 열면 열려 있는 탭을 고른다(openTab은 같은 key면 고르기만 한다).
const JOBS_KEY = "jobs";

/** Jobs 탭을 연다. 이미 열려 있으면 고르기만 한다. */
export function openJobs(host: TabHost): void {
  host.openTab({
    key: JOBS_KEY,
    kind: "jobs",
    title: t("project-workspace.label.kind-jobs"),
  });
}

export const jobsKind: TabKindDef = {
  kind: "jobs",
  labelKey: "project-workspace.label.kind-jobs",
  icon: shellIcons.jobs,
  // 창마다 같은 목록이라 다른 창으로 떼어 내지 않는다.
  noDetach: true,
  fromStored: (_stored, { key }) => ({
    key,
    kind: "jobs",
    title: t("project-workspace.label.kind-jobs"),
  }),
  toStored: (tab) =>
    tab.key === JOBS_KEY ? { kind: "jobs", key: tab.key } : null,
  render(_tab, _active, host) {
    const source = host.props.jobs;
    if (source === undefined) return null;
    return (
      <PaddedTab bare>
        <JobsPage
          source={source}
          onOpenSession={(session) =>
            runToastAction({ kind: "session", session })
          }
          onOpenProject={(project) =>
            host.props.onPlace?.({ kind: "project", id: project })
          }
        />
      </PaddedTab>
    );
  },
};
