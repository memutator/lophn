import assert from "node:assert/strict";
import { test } from "node:test";
import type { BusEvent } from "../../protocol/events/mod.ts";
import { buildMessage } from "./message.ts";
import type { PushDevice } from "./ports.ts";
import {
  causeOf,
  codingAcpCauseOf,
  type SessionInfo,
  signalCause,
} from "./triggers.ts";

// 마지막 답, shell 명령, 질문 글, 앱 notice의 body에 심은 값. 어떤 push 글에도 나오면 안 된다.
const SECRET = "sk-secret-do-not-leak";
const info: SessionInfo = {
  title: "Deploy",
  agent: "Mia",
  harness: "claude",
  opened_by_app: false,
};
const notice = (source: "app" | "program", kind: string) =>
  ({
    type: "NoticePosted",
    subject: "app_x",
    payload: {
      source,
      kind,
      app: "app_x",
      app_name: "Notes",
      title: "Title",
      body: SECRET,
      read_at: null,
    },
  }) as unknown as BusEvent;
const events: BusEvent[] = [
  {
    type: "TurnRequestOpened",
    session: "ses_a",
    payload: {
      request: {
        to_parent: false,
        subject: { kind: "shell", command: `curl -H ${SECRET} x` },
      },
    },
  },
  {
    type: "QuestionAsked",
    session: "ses_a",
    payload: { to_parent: false, question: SECRET },
  },
  {
    type: "TurnEnded",
    session: "ses_a",
    payload: {
      outcome: { kind: "failed" },
      active_ms: 125_000,
      messages: [SECRET],
      error: { code: "x", message: SECRET },
    },
  },
  {
    type: "ActivationConsentRequested",
    payload: { app: "app_x", app_name: "Notes", release: "rel_x" },
  },
  { type: "ShareRequestOpened", payload: { app: "app_x", app_name: "Notes" } },
  {
    type: "JobHeld",
    payload: { job: "job_x", run: "jbr_x", job_title: "Nightly" },
  },
  notice("app", "app"),
  notice("program", "release_failed"),
  notice("program", "sdk_update_needed"),
].map((event) => event as unknown as BusEvent);

test("push 글과 data 어디에도 대화 글, 명령, 질문 글, 앱 body가 없다", () => {
  const causes = events.map((event) => causeOf(event, info));
  causes.push(
    signalCause({
      terminal_ref: "t1",
      harness: "codex",
      title: "Tab",
      kind: "waiting",
      active_ms: null,
    }),
    signalCause({
      terminal_ref: "t1",
      harness: "codex",
      title: "Tab",
      kind: "finished",
      active_ms: 600_000,
    }),
    codingAcpCauseOf(
      {
        type: "approval_opened",
        approval: {
          id: "apr_1",
          subject: { kind: "shell", command: `curl -H ${SECRET} x` },
          choices: ["once", "reject"],
          always_patterns: [],
        },
      } as never,
      { terminal_ref: "trm_gui", harness: "claude", title: "GUI Tab" },
    ),
    codingAcpCauseOf(
      {
        type: "question_asked",
        group: "grp_1",
        tool_call: "tcl_1",
        questions: [
          {
            header: "H",
            question: SECRET,
            options: [{ label: SECRET, description: SECRET }],
            multiple: false,
          },
        ],
      } as never,
      { terminal_ref: "trm_gui", harness: "claude", title: "GUI Tab" },
    ),
  );
  assert.equal(
    causes.every((cause) => cause !== null),
    true,
  );
  for (const show_names of [true, false]) {
    const device: PushDevice = {
      id: "dev_1",
      token: "ExponentPushToken[x]",
      prefs: {
        needs_you: true,
        long_finish: true,
        app_update: true,
        job_missed: true,
        app_notify: true,
        quiet_when_present: true,
        show_names,
      },
    };
    for (const cause of causes) {
      const message = buildMessage(cause!, device, "host");
      assert.equal(
        JSON.stringify(message).includes(SECRET),
        false,
        cause!.kind,
      );
      assert.ok(message.title.length <= 120);
    }
  }
});
