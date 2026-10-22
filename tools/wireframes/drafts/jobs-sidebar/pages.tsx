// project sidebar Scheduled jobs panel의 page. 켜고 끄기는 gallery 안 상태로 움직인다.
import { useState } from "react";

import type { Page } from "../../pages/types.ts";
import { JOBS, PROJECT } from "../../mock/jobs-sidebar-data.ts";
import { JobsSidebarFrame } from "./frame.tsx";
import { JobPanel } from "./job-panel.tsx";

const noop = () => {};

function Panel({ jobs = JOBS }: { jobs?: typeof JOBS }) {
  const [list, setList] = useState(jobs);
  return (
    <JobsSidebarFrame title={PROJECT.title}>
      <JobPanel
        jobs={list}
        project={PROJECT.id}
        onEnabled={(id, enabled) =>
          setList((now) =>
            now.map((job) => job.id === id ? { ...job, enabled } : job)
          )}
        onOpenSettings={noop}
      />
    </JobsSidebarFrame>
  );
}

export const jobsSidebarPages: readonly Page[] = [
  {
    id: "draft-jobs-sidebar-list",
    title: "Project sidebar · scheduled jobs",
    description:
      "project 창 activity bar의 Workflows 아래에 Scheduled jobs 항목(Settings와 같은 달력 아이콘)을 두고, 그 project에 걸린 job만 줄로 보인다(다른 project의 job 하나는 보이지 않는다). 줄은 제목, 오른쪽 끝 고정 열의 switch, 아래 줄(주기 글과 상태 하나, 실패는 표시)이고 누르면 Settings의 Scheduled jobs로 간다. 항목 자리와 줄 칸, 걸린 job의 범위(그 project의 PM이 만든 것, 그 project의 agent를 부르거나 workflow를 시작하는 것)를 정한다.",
    render: () => <Panel />,
  },
  {
    id: "draft-jobs-sidebar-empty",
    title: "Project sidebar · no scheduled jobs",
    description:
      "이 project에 걸린 job이 하나도 없을 때의 panel이다(다른 project의 job은 있어도 보이지 않는다). 사람은 job을 만들지 못하고 agent에게 만들어 달라고 말하라고 안내하며, 맨 아래 단추로 모든 job 화면(Settings)에 간다. 빈 상태 글과 단추가 있는 것을 정한다.",
    render: () => <Panel jobs={JOBS.slice(-1)} />,
  },
];
