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
import { click, press, type, type Step } from "../../mock/drive.ts";
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
        "Inbox 탭의 Now. overlay와 같은 카드(권한 요청, 질문, 앱 업데이트 동의, 놓친 차례)가 위에 종류별로 있고(답할 것) 그 아래 Notifications에 끝난 탭과 휘발 알림이 있다. 알림은 [x]로 지우면 끝이다. 탭 머리의 History 옆 숫자는 안 읽은 기록 수이고 sidebar 배지에도 더한다(기록을 놓치지 않게). 탭을 떠나면 방금 결정한 줄은 치운다.",
      render: () => <MockDesktop homeTabs={[INBOX_TAB]} />,
    },
    {
      id: "inbox-history",
      title: "Inbox tab · History",
      description:
        "Inbox 탭의 History. 영구 기록(release 켜짐·실패·되돌림, 앱 멈춤, lophn 업데이트, SDK 업데이트 필요, 앱이 영구로 남긴 알림)이 최근 것부터 있고 안 읽은 줄은 앞에 점이 있다. 위에 기간·앱·project·종류 거르기와 글 검색, 오른쪽 끝에 [Mark all read]가 있다. 줄 오른쪽 끝에 action 단추([Ask lophn])와 읽음 표시 단추가 같은 열에 서고, 앱이 있는 줄을 누르면 그 앱이 열린다. 많으면 [Show more]로 잇는다.",
      render: () =>
        driven(
          [() => press('[role="tab"]', /^History/)],
          <MockDesktop homeTabs={[INBOX_TAB]} />,
        ),
    },
    {
      id: "inbox-history-search",
      title: "Inbox tab · History search",
      description:
        "History에서 글 검색 칸에 release를 쳐서 거른 모양이다. 거르기가 기본과 다르면 [Reset filters]가 나온다. 맞는 줄이 없으면 이유 한 줄만 보인다.",
      render: () =>
        driven(
          [
            () => press('[role="tab"]', /^History/),
            () => type('[data-filter="search"] input', "release"),
          ],
          <MockDesktop homeTabs={[INBOX_TAB]} />,
        ),
    },
    {
      id: "inbox-history-app",
      title: "Inbox tab · History app filter",
      description:
        "History의 앱 거르기를 연 모양이다. 첫 줄이 All apps이고 앱마다 앞에 앱 icon이 붙는다. 하나를 고르면 닫히고 버튼에도 그 앱 icon과 이름이 보인다. overlay에서 열어도 Inbox는 닫히지 않는다.",
      render: () =>
        driven(
          [
            () => press('[role="tab"]', /^History/),
            () => press('[data-filter="select"]'),
          ],
          <MockDesktop homeTabs={[INBOX_TAB]} />,
        ),
    },
    {
      id: "inbox-history-calendar",
      title: "Inbox tab · History custom range",
      description:
        "History의 기간 거르기를 연 모양이다. 왼쪽은 정한 기간 줄, 오른쪽은 직접 기간 달력이다. 달력은 첫 누름이 한쪽 끝, 둘째 누름이 다른 끝이고 둘째에 고르고 닫힌다.",
      render: () =>
        driven(
          [
            () => press('[role="tab"]', /^History/),
            () => press('[data-filter="date-range"]'),
          ],
          <MockDesktop homeTabs={[INBOX_TAB]} />,
        ),
    },
    {
      id: "inbox-history-period",
      title: "Inbox tab · History period",
      description:
        'History에서 기간을 "Last 7 days"로 거른 모양이다. 기간도 거르기가 기본과 다른 것이라 [Reset filters]가 나온다. 기간 안의 줄만 보이고 [Show more]와 [Mark all read]는 그 줄들에만 쓴다.',
      render: () =>
        driven(
          [
            () => press('[role="tab"]', /^History/),
            () => press('[data-filter="date-range"]'),
            () => click('[data-preset="last-7-days"]'),
          ],
          <MockDesktop homeTabs={[INBOX_TAB]} />,
        ),
    },
  ],
};
