// job 화면의 page. 켜고 끄기와 지우기는 gallery 안 상태로 움직이고, 열린 dialog와 펼친 기록은 mount 뒤에 사람이 하듯 눌러 만든다.
import { useState } from "react";

import type { Page } from "../../pages/types.ts";
import { click, runSteps, type Step, useDrive } from "../../mock/drive.ts";
import {
  HISTORIES,
  JOB_DIGEST,
  JOB_ORDERS,
  JOB_REVIEW,
  JOBS,
  type JobView,
  NAMES,
} from "../../mock/jobs-screen-data.ts";
import { JobsFrame } from "./frame.tsx";
import { JobsPanel } from "./jobs-panel.tsx";

const noop = () => {};

function Screen(
  { jobs = JOBS, steps = [], saveFails = false }: {
    jobs?: readonly JobView[];
    steps?: readonly Step[];
    /** 저장이 실패한다. Save를 누르면 탭 위쪽에 toast가 뜬다. */
    saveFails?: boolean;
  },
) {
  const [list, setList] = useState(jobs);
  useDrive(() => runSteps(steps));
  return (
    <JobsFrame>
      <JobsPanel
        jobs={list}
        histories={HISTORIES}
        names={NAMES}
        onEnabled={(id, enabled) =>
          setList((now) =>
            now.map((job) => job.id === id ? { ...job, enabled } : job)
          )}
        onSave={(id, change) => {
          if (saveFails) return Promise.resolve(false);
          setList((now) =>
            now.map((job) => job.id === id ? { ...job, ...change } : job)
          );
          return Promise.resolve(true);
        }}
        onDelete={(id) => {
          setList((now) => now.filter((job) => job.id !== id));
          return Promise.resolve(true);
        }}
        onOpenSession={noop}
        onOpenProject={noop}
      />
    </JobsFrame>
  );
}

const expand = (job: string): Step => () =>
  click(`[data-job="${job}"] [data-job-toggle]`);

export const jobsScreenPages: readonly Page[] = [
  {
    id: "draft-jobs-screen-empty",
    title: "Scheduled jobs · empty",
    description:
      "Settings의 System 묶음에 Scheduled jobs 항목이 있고(자리 추천), job이 하나도 없을 때의 본문이다. 사람은 job을 만들지 못하고 agent에게 만들어 달라고 말하라고 안내한다. 자리와 안내 글을 정한다.",
    render: () => <Screen jobs={[]} />,
  },
  {
    id: "draft-jobs-screen-list",
    title: "Scheduled jobs · list",
    description:
      "모든 place의 job을 한곳에 모은 목록이다(job 다섯, 하나는 꺼짐). 줄에는 제목, 주기 글, 다음 차례, 할 일 요약, 만든 agent, 놓친 차례 정책, 마지막 결과가 있고 오른쪽 끝 고정 열에 켜고 끄는 switch, Edit, Delete, 기록 토글이 있다. 자리(Settings 항목)와 줄이 보이는 칸을 정한다.",
    render: () => <Screen />,
  },
  {
    id: "draft-jobs-screen-history",
    title: "Scheduled jobs · history",
    description:
      "세 job의 기록을 폈다. 상태 여덟(Queued, Running, Done, Failed, Cancelled, Waiting, Skipped, Interrupted)과 건너뜀 이유 셋(내가 건너뜀, 앞 차례가 아직 돎, 제때 온 차례로 바뀜), 놓친 차례를 접은 줄, session과 project를 여는 단추의 글을 정한다. 시작하지 못한 실패는 이유 글이 붙는다. 화면을 아래로 내리면 나머지 기록이 보인다.",
    render: () => (
      <Screen
        jobs={JOBS.filter((job) =>
          [JOB_REVIEW, JOB_DIGEST, JOB_ORDERS].includes(job.id)
        )}
        steps={[expand(JOB_REVIEW), expand(JOB_DIGEST), expand(JOB_ORDERS)]}
      />
    ),
  },
  {
    id: "draft-jobs-screen-edit",
    title: "Scheduled jobs · edit",
    description:
      "Edit dialog다. 제목, 주기(숫자와 단위, 하루 단위일 때만 At), 놓친 차례 정책만 고친다. 할 일은 고치지 않고 만든 agent에게 말하라고 안내한다. Save를 누르면 저장 실패 알림(탭 위쪽 toast)을 볼 수 있다. 고치는 칸을 정한다.",
    render: () => (
      <Screen
        saveFails
        steps={[() => click(`[data-job="${JOB_DIGEST}"] [data-job-edit]`)]}
      />
    ),
  },
  {
    id: "draft-jobs-screen-delete",
    title: "Scheduled jobs · delete",
    description:
      "Delete 확인 dialog다. job과 그 기록을 지우고, 돌고 있는 것은 끝까지 돈다고 말한다. 지우기 문구를 정한다.",
    render: () => (
      <Screen
        steps={[() => click(`[data-job="${JOB_ORDERS}"] [data-job-delete]`)]}
      />
    ),
  },
];
