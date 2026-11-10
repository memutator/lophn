import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSessionNotices,
  routeNotice,
  type SessionNotice,
} from "./rule.ts";

test("보고 있으면 알리지 않고, 아니면 focus 창의 toast, 창이 없으면 OS 알림이다", () => {
  assert.equal(routeNotice({ looking: true, toastable: true }), "none");
  assert.equal(routeNotice({ looking: false, toastable: true }), "toast");
  assert.equal(routeNotice({ looking: false, toastable: false }), "os");
});

const sessionsOf = (unseen: { session: string }[]) =>
  unseen.map((one) => one.session);

test("못 본 turn 끝은 탭이 보이거나 다음 turn이 시작하면 지우고, 끊은 turn과 모르는 session은 알리지 않는다", async () => {
  const sent: SessionNotice[] = [];
  const published: string[][] = [];
  let looking = false;
  const notices = createSessionNotices({
    who: (session) =>
      Promise.resolve(
        session === "ses_unknown"
          ? null
          : {
              session,
              agent: "lophn_home",
              profile: { kind: "character", shape: "square", color: "coral" },
            },
      ),
    bodyOf: () => Promise.resolve(undefined),
    looking: () => looking,
    appSession: (session) => Promise.resolve(session === "ses_app"),
    notify: (notice) => {
      sent.push(notice);
      return !looking;
    },
    publish: (unseen) => published.push(unseen.map((one) => one.session)),
  });
  // core가 내는 TurnEnded payload 꼴 그대로다(outcome은 kind와 reason).
  const ended = (session: string, kind: string) =>
    notices.event({
      type: "TurnEnded",
      session,
      payload: { outcome: { kind, reason: "answer_completed" }, messages: [] },
    });

  await ended("ses_a", "interrupted");
  await ended("ses_unknown", "completed");
  // 앱 화면이 연 session은 turn이 끝나도 알리지 않고 못 본 점도 찍지 않지만, 물음은 알린다.
  await ended("ses_app", "completed");
  await ended("ses_app", "failed");
  assert.equal(sent.length, 0);
  assert.deepEqual(sessionsOf(notices.unseen()), []);
  await notices.event({ type: "QuestionAsked", session: "ses_app" });
  assert.deepEqual(
    sent.splice(0).map((notice) => notice.kind),
    ["permission"],
  );

  await ended("ses_a", "completed");
  await ended("ses_b", "failed");
  await notices.event({ type: "QuestionAsked", session: "ses_a" });
  assert.deepEqual(
    sent.map((notice) => notice.kind),
    ["finished", "failed", "permission"],
  );
  // 물음은 점이 아니라 waiting 상태가 보인다.
  assert.deepEqual(sessionsOf(notices.unseen()), ["ses_a", "ses_b"]);

  await notices.event({ type: "TurnStarted", session: "ses_a" });
  assert.deepEqual(sessionsOf(notices.unseen()), ["ses_b"]);

  looking = true;
  notices.recheck();
  assert.deepEqual(sessionsOf(notices.unseen()), []);
  assert.deepEqual(published.at(-1), []);

  // 보고 있는 탭의 turn 끝은 못 본 것이 아니다.
  await ended("ses_a", "completed");
  assert.deepEqual(sessionsOf(notices.unseen()), []);
});
