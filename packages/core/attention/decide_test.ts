import assert from "node:assert/strict";
import { test } from "node:test";
import type { BusEvent } from "../../protocol/events/mod.ts";
import { decide } from "./decide.ts";
import type { PushDevice, PushPrefs } from "./ports.ts";
import {
  DESKTOP_IDLE_LIMIT_MS,
  PRESENCE_TTL_MS,
  type PresenceReport,
} from "./presence.ts";
import { type Cause, causeOf, type SessionInfo } from "./triggers.ts";

const NOW = 1_000_000;
const ALL_ON: PushPrefs = {
  needs_you: true,
  long_finish: true,
  app_update: true,
  job_missed: true,
  app_notify: true,
  quiet_when_present: true,
  show_names: true,
};
const phone = (id: string, prefs: Partial<PushPrefs> = {}): PushDevice => ({
  id,
  token: `ExponentPushToken[${id}]`,
  prefs: { ...ALL_ON, ...prefs },
});
const WHO = { title: "t", agent: "a", harness: null };
const NEEDS_YOU: Cause = { kind: "approval", session: "ses_a", who: WHO };
const report = (patch: Partial<PresenceReport> = {}): PresenceReport => ({
  at: NOW,
  phone: false,
  focused: true,
  idle_ms: 0,
  looking: [],
  ...patch,
});
const run = (
  cause: Cause,
  devices: PushDevice[],
  presence: Record<string, PresenceReport> = {},
) =>
  decide({
    cause,
    devices,
    presence: new Map(Object.entries(presence)),
    now: NOW,
    host: "host",
  }).map((message) => message.to);

test("앞에 있는 desktop은 quiet_when_present가 켜진 기기에만 보내지 않게 한다", () => {
  const devices = [
    phone("quiet"),
    phone("loud", { quiet_when_present: false }),
  ];
  assert.deepEqual(run(NEEDS_YOU, devices), [
    "ExponentPushToken[quiet]",
    "ExponentPushToken[loud]",
  ]);
  assert.deepEqual(run(NEEDS_YOU, devices, { user: report() }), [
    "ExponentPushToken[loud]",
  ]);
});

test("오래된 보고와 idle이 한도를 넘은 보고는 막지 않는다", () => {
  const devices = [phone("a")];
  const stale = report({ at: NOW - PRESENCE_TTL_MS });
  const idle = report({ idle_ms: DESKTOP_IDLE_LIMIT_MS });
  assert.equal(run(NEEDS_YOU, devices, { user: stale }).length, 1);
  assert.equal(run(NEEDS_YOU, devices, { user: idle }).length, 1);
  // 포커스가 없는 desktop도 앞에 있는 것이 아니다.
  assert.equal(
    run(NEEDS_YOU, devices, { user: report({ focused: false }) }).length,
    1,
  );
});

test("앞에 있는 폰은 자기에게만 보내지 않는다", () => {
  const devices = [phone("one"), phone("two")];
  const sent = run(NEEDS_YOU, devices, {
    "device:one": report({ phone: true, idle_ms: null }),
  });
  assert.deepEqual(sent, ["ExponentPushToken[two]"]);
});

test("kind computer 기기의 보고는 desktop 규칙을 따른다", () => {
  const devices = [phone("a")];
  const desk = (patch: Partial<PresenceReport>) => ({
    "device:desk": report(patch),
  });
  assert.equal(run(NEEDS_YOU, devices, desk({})).length, 0);
  assert.equal(
    run(NEEDS_YOU, devices, desk({ idle_ms: DESKTOP_IDLE_LIMIT_MS })).length,
    1,
  );
});

test("꺼진 설정 칸은 그 계기를 보내지 않는다", () => {
  const causes: [Cause, keyof PushPrefs][] = [
    [NEEDS_YOU, "needs_you"],
    [
      {
        kind: "long_finish",
        session: "ses_a",
        outcome: "finished",
        active_ms: 90_000,
        who: WHO,
      },
      "long_finish",
    ],
    [{ kind: "consent", app: "app_a", app_name: "A" }, "app_update"],
    [{ kind: "program_notice", app: null, title: "t" }, "app_update"],
    [
      { kind: "app_notify", app: "app_a", app_name: "A", title: "t" },
      "app_notify",
    ],
    [{ kind: "job_held", job_title: "j" }, "job_missed"],
  ];
  for (const [cause, setting] of causes) {
    assert.equal(run(cause, [phone("on")]).length, 1, cause.kind);
    assert.equal(
      run(cause, [phone("off", { [setting]: false })]).length,
      0,
      cause.kind,
    );
  }
});

test("to_parent와 app이 연 session의 turn 끝은 계기가 되지 않는다", () => {
  const info: SessionInfo = {
    title: "t",
    agent: "a",
    harness: null,
    opened_by_app: false,
  };
  const request = (to_parent: boolean) =>
    ({
      type: "TurnRequestOpened",
      session: "ses_a",
      payload: { request: { to_parent } },
    }) as unknown as BusEvent;
  assert.equal(causeOf(request(true), info), null);
  assert.equal(causeOf(request(false), info)?.kind, "approval");
  const question = (to_parent: boolean) =>
    ({
      type: "QuestionAsked",
      session: "ses_a",
      payload: { to_parent },
    }) as unknown as BusEvent;
  assert.equal(causeOf(question(true), info), null);
  assert.equal(causeOf(question(false), info)?.kind, "question");
  const ended = {
    type: "TurnEnded",
    session: "ses_a",
    payload: { outcome: { kind: "completed" }, active_ms: 90_000 },
  } as unknown as BusEvent;
  assert.equal(causeOf(ended, info)?.kind, "long_finish");
  assert.equal(causeOf(ended, { ...info, opened_by_app: true }), null);
});
