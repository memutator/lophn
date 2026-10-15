// mock 모드의 질문·approval 통로, 그리고 core 연결. provider 읽기만 대신 답한다(그 밖의 core 호출은
// unavailable이다).
import {
  approval,
  fakeRequests,
  groupQuestion,
  question,
} from "../lophn-space/things-to-confirm/testdata/fake-source.ts";
import type { RequestSource } from "../lophn-space/things-to-confirm/source.ts";
import type { ConnectionState, CoreSource } from "../connection/connection.ts";
import { PROJECT_GROCERY } from "./ids.ts";

const MINUTE = 60 * 1000;

const PROVIDERS = [{
  id: "pvd_01h455vb4pex5v6nkc6gd5fd01",
  name: "Claude",
  credential: { state: "available" },
}, {
  id: "pvd_01h455vb4pex5v6nkc6gd5fd02",
  name: "ChatGPT",
  credential: { state: "available" },
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
        questions: [
          groupQuestion(3, 1, {
            answer: { kind: "option", option: "keep" },
            applied: true,
          }),
        ],
        closedAt: now - 60 * MINUTE,
      }),
      question(4, {
        status: "expired",
        closedReason: "expired",
        closedAt: now - 24 * 60 * MINUTE,
      }),
      approval(3, { status: "granted", closedAt: now - 120 * MINUTE }),
    ],
  }).source;
}
