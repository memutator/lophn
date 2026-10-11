// 계기별 ask_agent와 Ask가 내는 탭 값(platform/notifications#R13, R14).
// 계약 위반 계기(ContextWatchedItemChanged)는 context track을 합친 뒤 채우므로 여기서
// 단언하지 않는다. App Engineer 두 계기와 agent 없는 계기만 본다.

import { assert, assertEquals } from "@std/assert";
import { askAgentOf, type AskSource, askTab } from "./ask-agent.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const PROBLEM = "prb_01arz3ndektsv4rrffq69g5fav";
const RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";

const NO_AGENT_EVENTS = [
  "ProblemReopened",
  "ProblemClosed",
  "ApprovalRequestCreated",
  "QuestionCreated",
  "TicketConfirmed",
  "TicketCheckFailed",
  "AssignmentPaused",
] as const;

Deno.test("platform/notifications#R13 [agent-I18]: 문제 열림과 release activation 실패는 App Engineer, 그 밖은 agent 없음", () => {
  assertEquals(askAgentOf("ProblemOpened"), {
    role: "app_engineer",
    first_context: { work_place: "app", target: "problem" },
  });
  assertEquals(askAgentOf("ReleaseActivationFailed"), {
    role: "app_engineer",
    first_context: { work_place: "app", target: "release" },
  });
  for (const event of NO_AGENT_EVENTS) {
    assertEquals(askAgentOf(event), null, event);
  }
});

Deno.test("platform/notifications#R13 [agent-I18]: 표 밖 event는 agent가 없고 같은 종류는 항상 같은 agent다", () => {
  for (const event of ["RunFinished", "TicketCreated", "DocumentSaved", ""]) {
    assertEquals(askAgentOf(event), null, event);
  }
  // 입력이 event 이름뿐이라 내용에 따라 달라질 수 없다.
  assertEquals(askAgentOf("ProblemOpened"), askAgentOf("ProblemOpened"));
});

Deno.test("platform/notifications#R14 [agent-I18]: 문제 열림 Ask는 앱 자리의 App Engineer 탭과 문제 참조를 낸다", () => {
  const source: AskSource = {
    event: "ProblemOpened",
    source_seq: "41",
    subject: PROBLEM,
    app: APP,
  };
  assertEquals(askTab(source), {
    role: "app_engineer",
    work_place: { kind: "app", id: APP },
    opening_context: {
      source_seq: "41",
      target: { kind: "problem", id: PROBLEM },
    },
  });
});

Deno.test("platform/notifications#R14 [agent-I18]: release activation 실패 Ask는 그 앱 자리의 App Engineer 탭과 release 참조를 낸다", () => {
  assertEquals(
    askTab({
      event: "ReleaseActivationFailed",
      source_seq: "57",
      subject: RELEASE,
      app: APP,
    }),
    {
      role: "app_engineer",
      work_place: { kind: "app", id: APP },
      opening_context: {
        source_seq: "57",
        target: { kind: "release", id: RELEASE },
      },
    },
  );
});

Deno.test("platform/notifications#R14 [agent-I18]: agent 없는 계기는 탭 값이 없다", () => {
  for (const event of NO_AGENT_EVENTS) {
    assertEquals(
      askTab({ event, source_seq: "9", subject: PROBLEM, app: APP }),
      null,
      event,
    );
  }
});

Deno.test("platform/notifications#R14 [agent-I18]: 탭 값은 참조뿐이다 - run·message·읽음·본문 복사본이 없고 입력을 바꾸지 않는다", () => {
  const source: AskSource = {
    event: "ProblemOpened",
    source_seq: "41",
    subject: PROBLEM,
    app: APP,
  };
  const before = structuredClone(source);
  const tab = askTab(source);
  assert(tab !== null);
  assertEquals(source, before);
  assertEquals(Object.keys(tab).sort(), [
    "opening_context",
    "role",
    "work_place",
  ]);
  assertEquals(Object.keys(tab.opening_context).sort(), [
    "source_seq",
    "target",
  ]);
  assertEquals(Object.keys(tab.opening_context.target).sort(), ["id", "kind"]);
  // 같은 입력은 같은 값이고 Ask를 여러 번 골라도 늘어나는 것이 없다(읽음과 독립).
  assertEquals(askTab(source), tab);
  const text = JSON.stringify(tab);
  for (const forbidden of ["run", "message", "read_at", "title", "body"]) {
    assert(!text.includes(`"${forbidden}"`), forbidden);
  }
});
