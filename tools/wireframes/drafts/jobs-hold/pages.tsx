// job hold card의 page. 동작하는 project 창 위에 대기 목록 panel을 열어 둔다. 기존 permission·activation 카드는 실제 component다.
import { useState } from "react";

import { createEventClient } from "../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import {
  ACTIVATION,
  createFakeWaiting,
  SHELL_COMMAND,
} from "../../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import type { Page } from "../../pages/types.ts";
import { ProjectApp } from "../../pages/screens/project-app.tsx";
import { documentTab } from "../../mock/phroner-data.ts";
import { click, runSteps, type Step, useDrive } from "../../mock/drive.ts";
import {
  HOLD_AGENT,
  HOLD_TOOL,
  HOLD_WORKFLOW,
  type JobHoldView,
} from "../../mock/jobs-hold-data.ts";
import { HoldLayer } from "./panel.tsx";

const DOC = documentTab("eval/experiments/exp-008-query-tools.md");

type Items = Parameters<typeof createFakeWaiting>[0];

function Over(
  { items = [], holds, conflicts, steps = [] }: {
    items?: Items;
    holds: readonly JobHoldView[];
    conflicts?: readonly string[];
    steps?: readonly Step[];
  },
) {
  const [client] = useState(() => createEventClient(createFakeWaiting(items)));
  useDrive(() => runSteps(steps));
  return (
    <EventsProvider client={client}>
      <ProjectApp
        sidebar={{ foldersClosed: true }}
        panes={[{ tabs: [DOC], selected: DOC.key }]}
        titleExtra={<HoldLayer holds={holds} conflicts={conflicts} />}
      />
    </EventsProvider>
  );
}

export const jobsHoldPages: readonly Page[] = [
  {
    id: "draft-jobs-hold-list",
    title: "Waiting · scheduled jobs",
    description:
      "대기 목록에 job hold가 셋째 묶음 Scheduled jobs로 섞여 있다(위는 기존 permission과 앱 업데이트 카드). 놓친 차례를 [Skip]이나 [Start now]로 정한다. 묶음 이름과 카드가 대기 목록에 어울리는지 정한다.",
    render: () => (
      <Over
        items={[SHELL_COMMAND(), ACTIVATION()]}
        holds={[HOLD_AGENT]}
      />
    ),
  },
  {
    id: "draft-jobs-hold-kinds",
    title: "Waiting · job kinds",
    description:
      "hold card의 세 가지 할 일: agent 호출(받는 agent), 앱 tool 호출(tool과 앱의 짧은 id), workflow 시작(workflow 이름). 카드에는 job 제목, 만든 agent와 place, 놓친 수(1·3)와 마지막 차례 시각이 있고 단추는 오른쪽 끝에 [Skip], [Start now] 순이다. 카드에 보이는 정보를 정한다. 앱과 project는 짧은 id인데 이름이 필요하면 JobHold에 이름을 싣는 계약 바꾸기가 필요하다.",
    render: () => <Over holds={[HOLD_AGENT, HOLD_WORKFLOW, HOLD_TOOL]} />,
  },
  {
    id: "draft-jobs-hold-conflict",
    title: "Waiting · start blocked",
    description:
      "앞 차례가 아직 돌아 [Start now]가 막힌 상태다(Weekly review). card는 남고 사유 글이 단추 위에 보이며 [Skip]은 쓸 수 있다. 앞 차례가 끝난 뒤 다시 누르면 된다. 사유 글을 정한다. 결정이 접수되면 card는 목록에서 빠지고 남는 줄과 toast는 없다.",
    render: () => (
      <Over
        holds={[HOLD_AGENT, HOLD_WORKFLOW]}
        conflicts={[HOLD_WORKFLOW.job.id]}
        steps={[() =>
          click(
            `[data-job-hold="${HOLD_WORKFLOW.job.id}"] [data-start-now]`,
          )]}
      />
    ),
  },
];
