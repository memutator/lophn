import type { Area } from "../types.ts";
import {
  ContextContractPage,
  ContextGlossaryAddPage,
  ContextGlossaryDeletePage,
  ContextGlossaryEditPage,
  ContextGlossaryPage,
  ContextOverviewPage,
  ContextRestoredPage,
  ContextsArchivedPage,
  ContextSearchesPage,
  ContextsTabPage,
  ContextVersionsPage,
  ContextViolationsPage,
  ViolationSessionNewPage,
  ViolationSessionOpenPage,
} from "./contexts/context-pages.tsx";

export const contextsArea: Area = {
  id: "contexts",
  title: "Contexts",
  summary:
    "Contexts 목록과 context 상세(Overview, versions, Searches, Violations, Glossary, Contract), 위반을 넘긴 Project Manager session.",
  pages: [
    {
      id: "new-contexts",
      title: "Contexts · list",
      description:
        "project의 context 목록이다. 카드에 이름, 목적, 개체 종류 수, 적용된 판과 검사 결과, 위반 수, [Open]과 [Archive]가 있다. [New context]와 쓰는 Operator 수는 없다. context는 Project Manager가 대화에서 만든다.",
      render: () => <ContextsTabPage />,
    },
    {
      id: "new-contexts-archived",
      title: "Contexts · archived",
      description:
        "보관한 context 목록을 펼친 상태다. 보관한 context는 검색과 위반에서 빠진다는 한 줄과 [Unarchive]가 있다.",
      render: () => <ContextsArchivedPage />,
    },
    {
      id: "new-context-overview",
      title: "Context · Overview",
      description:
        "Context 탭의 첫 하위 탭이다. 머리는 이름, 목적, 적용된 판과 [Versions]이고 [Ask …]와 [History]는 없다. 도메인 그림과 Composition 트리가 있다.",
      render: () => <ContextOverviewPage />,
    },
    {
      id: "new-context-versions",
      title: "Context · versions",
      description:
        "머리의 [Versions]를 펼친 상태다. 판마다 시각과 바뀐 것 한 줄이 있고, 옛 판 줄의 [Restore]로 확인 없이 되돌린다. 판 목록은 배경 없이 테두리만 있다.",
      render: () => <ContextVersionsPage />,
    },
    {
      id: "new-context-restored",
      title: "Context · version restored",
      description:
        "옛 판으로 되돌린 직후다. 탭 위쪽에 toast가 뜨고 판 목록의 Current와 머리의 판이 바뀐다.",
      render: () => <ContextRestoredPage />,
    },
    {
      id: "new-context-searches",
      title: "Context · Searches",
      description:
        "이 context에 선언된 검색과 saved view 목록이다. 누르면 Search 탭이 열린다.",
      render: () => <ContextSearchesPage />,
    },
    {
      id: "new-context-violations",
      title: "Context · Violations",
      description:
        "위반 목록이다. 줄마다 파일(눌러 열기), 어긴 규칙, [Send to Project Manager]가 있고 위에 [Send all to Project Manager]가 있다. 누르면 위반 근거가 붙은 Project Manager session이 열린다. 진행 중 표시는 없다.",
      render: () => <ContextViolationsPage />,
    },
    {
      id: "new-context-glossary",
      title: "Context · Glossary",
      description:
        "용어집 하위 탭이다. 맨 위 머리 줄에 Glossary와 용어 수, 오른쪽 끝에 [Add term]이 있다. 사람과 Project Manager 둘 다 용어를 더하고 고치고 지운다. 줄 오른쪽 끝의 [Edit]과 [Delete]는 hover했을 때만 보인다.",
      render: () => <ContextGlossaryPage />,
    },
    {
      id: "new-context-glossary-add",
      title: "Context · Glossary (add)",
      description:
        "[Add term]을 눌러 목록 맨 위에 빈 인라인 줄이 생긴 상태다. 용어와 뜻을 줄에서 바로 쓰고 Enter나 ✓로 저장, Esc나 ×로 취소한다.",
      render: () => <ContextGlossaryAddPage />,
    },
    {
      id: "new-context-glossary-edit",
      title: "Context · Glossary (edit)",
      description:
        "한 줄의 [Edit]을 눌러 그 줄이 같은 칸 배치 그대로 글자 칸이 된 상태다. ✓와 ×는 오른쪽 끝에 있다.",
      render: () => <ContextGlossaryEditPage />,
    },
    {
      id: "new-context-glossary-delete",
      title: "Context · Glossary (delete)",
      description:
        "[Delete]를 눌러 화면 가운데에 지우기 확인 modal이 뜬 상태다.",
      render: () => <ContextGlossaryDeletePage />,
    },
    {
      id: "new-context-contract",
      title: "Context · Contract",
      description:
        "계약 세부 하위 탭이다. 개체 종류별 자료 위치와 field, 관계, 선언된 검색과 test 결과가 있다.",
      render: () => <ContextContractPage />,
    },
    {
      id: "new-agent-toast-opened",
      title: "Violation · Project Manager session (new)",
      description:
        "reaction이 꺼져 있어 toast를 누를 때 새로 연 Project Manager session이다. 어느 파일이 어느 규칙을 어겼는지가 chip으로 붙고 입력칸은 비어 있다.",
      render: () => <ViolationSessionNewPage />,
    },
    {
      id: "new-violation-session-open",
      title: "Violation · Project Manager session (open)",
      description:
        "reaction이 이미 연 session으로 간 경우다. Project Manager가 위반 문서와 계약을 읽고 일하는 중이고, 새로 누른 위반이 chip으로 붙어 다음에 보내는 말에 실린다.",
      render: () => <ViolationSessionOpenPage />,
    },
  ],
};
