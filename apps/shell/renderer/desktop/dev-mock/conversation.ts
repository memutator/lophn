// mock 모드의 대화 도크와 질문·approval 통로, 그리고 core 연결. 도크와 things-to-confirm이 같은
// 질문을 보고, provider 읽기만 대신 답한다(그 밖의 core 호출은 unavailable이다).
import {
  agentMessage,
  fakeSource,
  messageId,
  runId,
  sessionId,
} from "../../conversation/testdata/fake-source.ts";
import {
  approval,
  fakeRequests,
  notification,
  question,
} from "../lophn-space/things-to-confirm/testdata/fake-source.ts";
import {
  barBlock,
  tableBlock,
} from "../../workspace/visuals/testdata/blocks.ts";
import type {
  BodyPart,
  ConversationSource,
} from "../../conversation/source.ts";
import type { RequestSource } from "../lophn-space/things-to-confirm/source.ts";
import type { ConnectionState, CoreSource } from "../connection/connection.ts";
import {
  DOC_NOTES,
  DOC_REPORT,
} from "../lophn-space/roles/testdata/fake-roles.ts";
import { PROJECT_GROCERY } from "./ids.ts";

const MINUTE = 60 * 1000;

const PROVIDERS = [{
  id: "pvd_01h455vb4pex5v6nkc6gd5fd01",
  name: "Claude",
  enabled: true,
  credentials: [
    { key: "main", state: "available" },
    { key: "backup", state: "available" },
  ],
}, {
  id: "pvd_01h455vb4pex5v6nkc6gd5fd02",
  name: "ChatGPT",
  enabled: true,
  credentials: [{ key: "personal", state: "available" }],
}];

/** 항상 ready인 core 통로. provider 목록만 읽히고 나머지 호출은 unavailable이다. */
export function mockCore(): CoreSource {
  const state: ConnectionState = { state: "ready", confirmedAt: Date.now() };
  return {
    subscribe(listener) {
      listener(state);
      return () => {};
    },
    current: () => state,
    call(input) {
      if (input.resource === "providers" && input.method === "list") {
        return Promise.resolve({
          ok: true,
          value: { providers: PROVIDERS, next_cursor: null },
        });
      }
      return Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "mock mode has no core" },
      });
    },
  };
}

export function mockConversation(): ConversationSource {
  const session = sessionId(1);
  const bodies: Record<string, readonly BodyPart[]> = {
    [messageId(1)]: [{
      kind: "text",
      text:
        "How much did we spend on groceries this week, and is it under the plan?",
    }],
    [messageId(3)]: [{
      kind: "text",
      text: "Please file the week as a report in the grocery project.",
    }],
    [messageId(2)]: [
      {
        kind: "text",
        text:
          "This week came to 142, which is under the 150 weekly share of the plan. Rice and eggs were the biggest lines.",
      },
      { kind: "visual", block: barBlock },
      { kind: "visual", block: tableBlock },
    ],
    [messageId(4)]: [{
      kind: "text",
      text:
        "Filed the weekly report and added a short note about the store prices.",
    }],
  };
  return fakeSource({
    sessions: [{ id: session, state: "open", stateSeq: "10" }],
    messages: {
      [session]: [
        {
          ...agentMessage(1),
          actor: "user",
          mode: "request",
          applied: true,
        },
        {
          ...agentMessage(2),
          run: runId(1),
          applied: true,
        },
        {
          ...agentMessage(3),
          actor: "user",
          mode: "request",
          applied: true,
        },
        {
          ...agentMessage(4, [
            { kind: "document", document: DOC_REPORT },
            { kind: "document", document: DOC_NOTES },
          ]),
          run: runId(2),
          applied: true,
        },
      ],
    },
    bodies,
    titles: {
      [DOC_REPORT]: "Weekly grocery report",
      [DOC_NOTES]: "Store notes",
    },
  }).source;
}

export function mockRequests(): RequestSource {
  const now = Date.now();
  return fakeRequests({
    requests: [
      question(1, { blocking: true, createdAt: now - 4 * MINUTE }),
      approval(2, {
        place: { kind: "project", id: PROJECT_GROCERY },
        createdAt: now - 12 * MINUTE,
      }),
      question(3, {
        status: "answered",
        answer: { kind: "option", option: "keep" },
        applied: true,
        closedAt: now - 60 * MINUTE,
      }),
      question(4, {
        status: "expired",
        closedReason: "expired",
        closedAt: now - 24 * 60 * MINUTE,
      }),
      approval(3, { status: "granted", closedAt: now - 120 * MINUTE }),
    ],
    notifications: [
      {
        ...notification(1, "QuestionCreated", "10"),
        occurredAt: new Date(now - 4 * MINUTE).toISOString(),
      },
      notification(
        2,
        "ApprovalRequestCreated",
        "20",
        "2026-10-09T09:00:00.000Z",
      ),
    ],
  }).source;
}
