import { assertEquals } from "@std/assert";

import {
  chipQueue,
  currentIndex,
  needsReview,
  notificationTarget,
  passes,
  pastOrder,
  placeWaiting,
  stripOrder,
  usableText,
  waitingCounts,
} from "./model.ts";
import {
  approval,
  approvalId,
  notification,
  question,
  questionId,
} from "./testdata/fake-source.ts";

const NOW = Date.parse("2026-10-06T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

Deno.test("shell/desktop#R6: 칸은 run을 멈춘 요청을 먼저, 나머지를 접수 순으로 두고 닫힌 요청은 빼며 고른 요청을 계속 가리킨다", () => {
  const ordered = stripOrder([
    question(3),
    approval(1),
    question(2, { blocking: true }),
    question(4, { status: "answered", closedSeq: "50" }),
    approval(5, { blocking: true }),
  ]);
  assertEquals(ordered.map((request) => request.id), [
    questionId(2),
    approvalId(5),
    approvalId(1),
    questionId(3),
  ]);
  assertEquals(currentIndex(ordered, approvalId(1)), 2);
  // 고른 요청이 닫혀 빠지면 첫 요청으로 돌아간다. 다른 요청을 대신 고른 것으로 보지 않는다.
  assertEquals(currentIndex(ordered, questionId(4)), 0);
  assertEquals(currentIndex([], null), -1);
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
    questionId(6),
    questionId(4),
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

Deno.test("shell/desktop#R9: 질문·approval notification은 원래 생성 event로 그 요청을 가리키고 다른 계기는 가리키지 않는다", () => {
  const requests = [question(1), approval(2)];
  assertEquals(
    notificationTarget(notification(1, "QuestionCreated", "10"), requests)?.id,
    questionId(1),
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

Deno.test("lophn-agent/questions#R6: 공백뿐인 글은 답이 아니고 action 선택지만 review로 간다", () => {
  assertEquals(usableText("  \n "), false);
  assertEquals(usableText("Keep it"), true);
  const withAction = question(1, {
    options: [
      { key: "move", label: "Move it", action: true },
      { key: "stay", label: "Leave it", action: false },
    ],
  });
  assertEquals(needsReview(withAction, "move"), true);
  assertEquals(needsReview(withAction, "stay"), false);
  assertEquals(needsReview(withAction, null), false);
  const term = question(2, {
    options: [
      { key: "use", label: "정산주기", action: true, command: "term.define" },
      { key: "move", label: "Move it", action: true, command: "document.move" },
      { key: "app", label: "Register", action: true, command: "app.create" },
      { key: "set", label: "Change", action: true, command: "apply_settings" },
    ],
  });
  assertEquals(needsReview(term, "set"), false);
  assertEquals(needsReview(term, "use"), false);
  assertEquals(needsReview(term, "app"), false);
  assertEquals(needsReview(term, "move"), true);
});
