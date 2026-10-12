import { assertEquals } from "@std/assert";

import {
  chipQueue,
  notificationTarget,
  passes,
  pastOrder,
  placeWaiting,
  reviewTarget,
  stripOrder,
  usableText,
  waitingCounts,
} from "./model.ts";
import {
  approval,
  approvalId,
  groupId,
  groupQuestion,
  notification,
  question,
  questionId,
} from "./testdata/fake-source.ts";

const NOW = Date.parse("2026-10-06T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

Deno.test("shell/desktop#R9 [I45]: 기다리는 요청은 run을 멈춘 요청을 먼저, 나머지를 접수 순으로 두고 닫힌 요청은 뺀다", () => {
  const ordered = stripOrder([
    question(3),
    approval(1),
    question(2, { blocking: true }),
    question(4, { status: "answered", closedSeq: "50" }),
    approval(5, { blocking: true }),
  ]);
  assertEquals(ordered.map((request) => request.id), [
    groupId(2),
    approvalId(5),
    approvalId(1),
    groupId(3),
  ]);
});

Deno.test("shell/desktop#R9: 기다리는 것은 종류별로 세고 지난 일은 닫힌 순서의 최신부터 둔다", () => {
  const requests = [
    question(1),
    question(2),
    approval(3),
    question(4, { status: "answered", closedSeq: "40" }),
    approval(5, { status: "granted", closedSeq: "90" }),
    question(6, {
      status: "expired",
      closedSeq: "60",
      closedReason: "expired",
    }),
  ];
  assertEquals(waitingCounts(requests), { questions: 2, decisions: 1 });
  assertEquals(pastOrder(requests).map((request) => request.id), [
    approvalId(5),
    groupId(6),
    groupId(4),
  ]);
});

Deno.test("shell/desktop#R9: 역할·기간으로 거르고 역할을 모르는 요청은 모든 역할에서, 시각을 모르는 요청은 어느 기간에서나 보인다", () => {
  const old = question(1, { createdAt: NOW - 10 * DAY });
  const recent = question(2, { createdAt: NOW - 2 * 60 * 60 * 1000 });
  const operator = approval(3, { role: "operator", createdAt: NOW - DAY / 2 });
  const undated = question(4, { createdAt: null });
  const unknownRole = question(5, { role: null, createdAt: NOW });
  const closedLate = question(6, {
    createdAt: NOW - 40 * DAY,
    closedAt: NOW - DAY / 2,
    status: "answered",
    closedSeq: "70",
  });
  const day = { role: "all", period: "day" } as const;
  assertEquals(
    [old, recent, operator, undated, unknownRole, closedLate]
      .filter((request) => passes(request, day, NOW))
      .map((request) => request.id),
    [
      recent.id,
      operator.id,
      undated.id,
      unknownRole.id,
      closedLate.id,
    ],
  );
  assertEquals(passes(old, { role: "all", period: "month" }, NOW), true);
  assertEquals(passes(operator, { role: "lophn", period: "all" }, NOW), false);
  assertEquals(
    passes(operator, { role: "operator", period: "all" }, NOW),
    true,
  );
  assertEquals(
    passes(unknownRole, { role: "lophn", period: "all" }, NOW),
    false,
  );
});

Deno.test("shell/desktop#R9: 많은 요청도 종류나 개수로 버리지 않는다", () => {
  const many = Array.from(
    { length: 150 },
    (_, index) => index % 2 === 0 ? question(index + 1) : approval(index + 1),
  );
  assertEquals(stripOrder(many).length, 150);
  assertEquals(waitingCounts(many), { questions: 75, decisions: 75 });
});

Deno.test("shell/desktop#R10: chip은 읽지 않았고 이 창에서 닫지 않은 notification을 먼저 온 것부터 올린다", () => {
  const rows = [
    notification(3, "QuestionCreated", "30"),
    notification(1, "ProblemOpened", "10"),
    notification(2, "ApprovalRequestCreated", "20", "2026-10-06T08:00:00.000Z"),
    notification(4, "TicketConfirmed", "40"),
  ];
  assertEquals(
    chipQueue(rows, new Set([rows[3]!.id])).map((row) => row.sourceSeq),
    ["10", "30"],
  );
});

Deno.test("shell/desktop#R9 [I45]: 질문 묶음·approval notification은 원래 생성 event로 그 요청을 가리키고 다른 계기는 가리키지 않는다", () => {
  const requests = [question(1), approval(2)];
  assertEquals(
    notificationTarget(notification(1, "QuestionCreated", "10"), requests)?.id,
    groupId(1),
  );
  assertEquals(
    notificationTarget(
      notification(2, "ApprovalRequestCreated", "20"),
      requests,
    )?.id,
    approvalId(2),
  );
  assertEquals(
    notificationTarget(notification(3, "ProblemOpened", "10"), requests),
    null,
  );
  // 같은 seq라도 종류가 다르면 가리키지 않는다.
  assertEquals(
    notificationTarget(notification(4, "QuestionCreated", "20"), requests),
    null,
  );
});

Deno.test("shell/desktop#R26, R27: 공간의 대기 수는 그 공간만 세고 런처 카드는 approval만 센다", () => {
  const project = {
    kind: "project",
    id: "prj_01h455vb4pex5v6nkc6gd5fd01",
  } as const;
  const other = {
    kind: "project",
    id: "prj_01h455vb4pex5v6nkc6gd5fd02",
  } as const;
  const requests = [
    question(1, { place: project }),
    approval(2, { place: project }),
    approval(3, { place: project, status: "granted", closedSeq: "30" }),
    approval(4, { place: other }),
    approval(5, { place: null }),
  ];
  assertEquals(placeWaiting(requests, project, "all"), 2);
  assertEquals(placeWaiting(requests, project, "approvals"), 1);
  assertEquals(placeWaiting(requests, other, "all"), 1);
  assertEquals(placeWaiting(requests, { kind: "global" }, "all"), 0);
});

Deno.test("lophn-agent/questions#R6 [I45]: 공백뿐인 글은 답이 아니다", () => {
  assertEquals(usableText("  \n "), false);
  assertEquals(usableText("Keep it"), true);
});

Deno.test("lophn-agent/questions#R4, R13 [I45]: 보호 창을 여는 것은 질문 하나짜리 묶음에서 고른 action 선택지뿐이고 term.define·app.create·apply_settings는 열지 않는다", () => {
  const withAction = question(1, {
    questions: [groupQuestion(1, 1, {
      options: [
        {
          key: "move",
          label: "Move it",
          action: true,
          command: "document.move",
        },
        { key: "stay", label: "Leave it", action: false },
      ],
    })],
  });
  const pick = (key: string) => [{
    question: questionId(1, 1),
    answer: { kind: "option" as const, option_key: key },
  }];
  // 정본 참조는 묶음이다. 질문 id를 싣지 않는다.
  assertEquals(reviewTarget(withAction, pick("move")), {
    group: groupId(1),
    option_key: "move",
  });
  assertEquals(reviewTarget(withAction, pick("stay")), null);
  // 질문이 둘 이상인 묶음에는 확인 창으로 가는 길이 없다(action 선택지는 질문 하나짜리에만 있다).
  const two = question(1, {
    questions: [
      withAction.questions[0]!,
      groupQuestion(1, 2, {
        options: [{ key: "ok", label: "Fine", action: false }],
      }),
    ],
  });
  assertEquals(reviewTarget(two, pick("move")), null);
  assertEquals(reviewTarget(withAction, []), null);
  assertEquals(
    reviewTarget(withAction, [{
      question: questionId(1, 1),
      answer: { kind: "text", text: "Another place" },
    }]),
    null,
  );
  const term = question(2, {
    questions: [groupQuestion(2, 1, {
      options: [
        { key: "use", label: "정산주기", action: true, command: "term.define" },
        { key: "app", label: "Register", action: true, command: "app.create" },
        {
          key: "set",
          label: "Change",
          action: true,
          command: "apply_settings",
        },
      ],
    })],
  });
  for (const key of ["use", "app", "set"]) {
    assertEquals(
      reviewTarget(term, [{
        question: questionId(2, 1),
        answer: { kind: "option", option_key: key },
      }]),
      null,
      key,
    );
  }
});
