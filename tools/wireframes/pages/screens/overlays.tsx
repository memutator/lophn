// 왼쪽 sidebar의 Inbox·Jobs overlay와 두 탭(Jobs, Inbox). 진짜 Desktop(Home workspace)을 mock 데이터로 그리고, overlay와 dialog는 mount 뒤에
// 사람이 하듯이 눌러 연다.
import type { ReactNode } from "react";

import {
  fakeJobs,
  JOB_DIGEST,
  JOB_ORDERS,
  JOB_REVIEW,
} from "../../../../packages/shell/renderer/desktop/jobs/testdata/fake-source.ts";
import { Driven } from "../../mock/driven.tsx";
import { click, press, type Step } from "../../mock/drive.ts";
import { MockDesktop } from "../../mock/mock-desktop.tsx";
import type { Area } from "../types.ts";

const JOBS_TAB = { key: "jobs", kind: "jobs", title: "Jobs" } as const;
const INBOX_TAB = { key: "inbox", kind: "inbox", title: "Inbox" } as const;

const NO_JOBS = fakeJobs({ jobs: [] }).source;

function driven(steps: readonly Step[], children: ReactNode) {
  return <Driven steps={steps}>{children}</Driven>;
}

const expand = (job: string) => () =>
  click(`[data-job="${job}"] [data-job-toggle]`);

export const overlaysArea: Area = {
  id: "overlays",
  title: "Inbox & Jobs",
  summary:
    "왼쪽 sidebar의 Inbox·Jobs 줄이 여는 overlay와, 같은 내용을 한 쪽 전체로 보이는 Inbox·Jobs 탭.",
  pages: [
    {
      id: "overlay-jobs",
      title: "Overlay · Jobs",
      description:
        "왼쪽 sidebar의 Jobs 줄을 누르면 줄 오른쪽 옆으로 여는 panel이다. Inbox panel과 같은 폭과 머리 줄이고 머리 오른쪽의 아이콘 단추([Open in tab])가 Jobs 탭을 연다. 줄은 제목, 주기와 다음 차례, 마지막 결과 표식, 오른쪽 끝 switch다. 바깥을 누르거나 Esc를 누르면 닫힌다.",
      render: () => driven([() => press('[data-nav="jobs"]')], <MockDesktop />),
    },
    {
      id: "overlay-jobs-empty",
      title: "Overlay · Jobs · empty",
      description:
        "job이 하나도 없을 때의 Jobs overlay. 사람은 job을 만들지 못하고 agent에게 만들어 달라고 말하라고 안내한다.",
      render: () =>
        driven(
          [() => press('[data-nav="jobs"]')],
          <MockDesktop jobs={NO_JOBS} />,
        ),
    },
    {
      id: "overlay-inbox",
      title: "Overlay · Inbox",
      description:
        "왼쪽 sidebar의 Inbox 줄이 여는 대기 목록. Jobs overlay와 같이 줄 오른쪽 옆으로 열리고 머리 오른쪽에 [Open in tab] 아이콘 단추가 있다. 누르면 Inbox 탭이 열리고 panel이 닫힌다.",
      render: () =>
        driven([() => press('[data-nav="inbox"]')], <MockDesktop />),
    },
    {
      id: "jobs-tab",
      title: "Jobs tab · list",
      description:
        "Jobs 탭. 모든 workspace의 job을 한곳에 모은 목록이다(job 다섯, 하나는 꺼짐). 줄에는 제목, 주기 글, 다음 차례, 할 일 요약, 만든 agent, 놓친 차례 정책, 마지막 결과가 있고 오른쪽 끝 고정 열에 켜고 끄는 switch, Edit, Delete, 기록 토글이 있다. 어느 workspace에서든 같은 탭이고 desk에 하나다.",
      render: () => <MockDesktop homeTabs={[JOBS_TAB]} />,
    },
    {
      id: "jobs-tab-empty",
      title: "Jobs tab · empty",
      description:
        "job이 하나도 없는 Jobs 탭. 사람은 job을 만들지 못하고 agent에게 만들어 달라고 말하라고 안내한다.",
      render: () => <MockDesktop homeTabs={[JOBS_TAB]} jobs={NO_JOBS} />,
    },
    {
      id: "jobs-tab-history",
      title: "Jobs tab · history",
      description:
        "세 job의 기록을 폈다. 상태 여덟과 건너뜀 이유 셋(내가 건너뜀, 앞 차례가 아직 돎, 제때 온 차례로 바뀜), 놓친 차례를 접은 줄, session과 project를 여는 단추가 보인다. 시작하지 못한 실패는 이유 글이 붙는다.",
      render: () =>
        driven(
          [expand(JOB_REVIEW), expand(JOB_DIGEST), expand(JOB_ORDERS)],
          <MockDesktop homeTabs={[JOBS_TAB]} />,
        ),
    },
    {
      id: "jobs-tab-edit",
      title: "Jobs tab · edit",
      description:
        "Edit dialog다. 제목, 주기(숫자와 단위, 하루 단위일 때만 At), 놓친 차례 정책만 고친다. 할 일은 고치지 않고 만든 agent에게 말하라고 안내한다.",
      render: () =>
        driven(
          [() => click(`[data-job="${JOB_DIGEST}"] [data-job-edit]`)],
          <MockDesktop homeTabs={[JOBS_TAB]} />,
        ),
    },
    {
      id: "jobs-tab-delete",
      title: "Jobs tab · delete",
      description:
        "Delete 확인 dialog다. job과 그 기록을 지우고, 돌고 있는 것은 끝까지 돈다고 말한다.",
      render: () =>
        driven(
          [() => click(`[data-job="${JOB_ORDERS}"] [data-job-delete]`)],
          <MockDesktop homeTabs={[JOBS_TAB]} />,
        ),
    },
    {
      id: "inbox-tab",
      title: "Inbox tab",
      description:
        "Inbox 탭. overlay와 같은 카드(권한 요청, 질문, 앱 업데이트 동의, 놓친 차례)를 탭 본문의 가운데 기둥에 종류별로 보인다. 탭을 떠나면 방금 결정한 줄은 치운다.",
      render: () => <MockDesktop homeTabs={[INBOX_TAB]} />,
    },
  ],
};
