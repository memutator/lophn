// 질문 묶음 카드 test의 fake. 값은 lophn-agent/questions 묶음 읽기·글 읽기의 모양이고 id는 고정이다.
import type {
  GroupAnswer,
  QuestionGroupView,
  QuestionView,
} from "../question-card/model.ts";

function fakeId(prefix: string, n: number): string {
  return `${prefix}_01h455vb4pex5v6nkc6gd5f${String(n).padStart(3, "0")}`;
}

export const AGENT_NAME = "Context Engineer";

/** 시각은 주입한다: 2026-10-06T09:00:00Z. */
export const NOW = Date.parse("2026-10-06T09:00:00Z");

/** REPORT_GROUP에 NOW 기준 남은 시간 ms 뒤의 기한을 단 묶음. */
export function expiringGroup(remainingMs: number): QuestionGroupView {
  return {
    ...REPORT_GROUP,
    expires_at: new Date(NOW + remainingMs).toISOString(),
  };
}

export const QUESTION_PLACE: QuestionView = {
  id: fakeId("qst", 1),
  prompt: "Where should the weekly report go?",
  reason: "The report path decides where the weekly job writes next.",
  options: [
    {
      key: "reports",
      label: "docs/reports/",
      description: "next to last week's reports",
    },
    {
      key: "eval",
      label: "eval/reports/",
      description: "inside the eval folder",
    },
    { key: "ask", label: "Ask me each week", description: "no fixed place" },
  ],
  recommendation: {
    option_key: "reports",
    explanation: "Last week's report is already there.",
  },
};

export const QUESTION_REGRESSIONS: QuestionView = {
  id: fakeId("qst", 2),
  prompt: "Include regressions in the report?",
  reason: "Regressions make the report longer and change who reads it.",
  options: [
    {
      key: "yes",
      label: "Yes",
      description: "list each regression with its scenario",
    },
    { key: "no", label: "No", description: "only improvements" },
  ],
  recommendation: {
    option_key: "yes",
    explanation: "The reader acts on regressions first.",
  },
};

/** 질문 둘: 한 카드에 모두 펼친다. */
export const REPORT_GROUP: QuestionGroupView = {
  id: fakeId("qgr", 1),
  agentName: AGENT_NAME,
  expires_at: null,
  questions: [QUESTION_PLACE, QUESTION_REGRESSIONS],
};

/** 질문 count개(1~4). 질문 i의 prompt는 "Question i?", 선택지는 key a·b·c(라벨 "Choice i-a" …). */
export function numberedGroup(count: number): QuestionGroupView {
  const questions: QuestionView[] = [];
  for (let i = 1; i <= count; i += 1) {
    questions.push({
      id: fakeId("qst", 10 + i),
      prompt: `Question ${i}?`,
      reason: `Reason ${i}`,
      options: ["a", "b", "c"].map((key) => ({
        key,
        label: `Choice ${i}-${key}`,
        description: `Detail ${i}-${key}`,
      })),
      recommendation: null,
    });
  }
  return {
    id: fakeId("qgr", 10 + count),
    agentName: AGENT_NAME,
    expires_at: null,
    questions,
  };
}

/** REPORT_GROUP에 선택지로 답한 값. */
export const REPORT_ANSWERS: readonly GroupAnswer[] = [
  {
    question: QUESTION_PLACE.id,
    answer: { kind: "option", option_key: "reports" },
  },
  {
    question: QUESTION_REGRESSIONS.id,
    answer: { kind: "option", option_key: "yes" },
  },
];
