import { assert, assertEquals } from "@std/assert";

import type {
  EditorReply,
  LookupReport,
  SaveReport,
  WatchReport,
} from "../../ipc/editor.ts";
import {
  RETRY_DELAYS_MS,
  SAVE_QUIET_MS,
  type SaveClock,
  saveDetails,
  saveHeadline,
  saveNotices,
  SaveSession,
  topNotice,
} from "./save-state.ts";

const H0 = "00".repeat(32);
const decoder = new TextDecoder();

function manualClock() {
  let now = 1_000;
  let next = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const clock: SaveClock = {
    set(callback, ms) {
      next += 1;
      pending.set(next, { at: now + ms, callback });
      return next;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
    now: () => now,
  };
  return {
    clock,
    pending,
    /** ms만큼 흘리고 그때까지 온 timer를 부른다. */
    async advance(ms: number) {
      now += ms;
      for (
        const [id, entry] of [...pending].sort((a, b) => a[1].at - b[1].at)
      ) {
        if (entry.at > now) continue;
        pending.delete(id);
        entry.callback();
      }
      await flushPromises();
    },
  };
}

async function flushPromises() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Sent {
  text: string;
  base: string | null;
  end: boolean;
  key: string;
  baseVersion?: string;
}

function report(over: Partial<SaveReport> = {}): SaveReport {
  return {
    disk: "written",
    written_hash: null,
    observed_hash: null,
    observed_at: null,
    changed_again: false,
    recording: "recorded",
    version: null,
    saved_version: null,
    latest_version: null,
    problems: null,
    failure: null,
    ...over,
  };
}

function harness(
  answer: (sent: Sent, index: number) => EditorReply<SaveReport> = (
    sent,
    index,
  ) => ({
    ok: true,
    value: report({
      written_hash: `h${index + 1}`.padEnd(64, "0"),
      version: sent.end ? "preparing" : null,
    }),
  }),
  lookup: (key: string) => EditorReply<LookupReport> = () => ({
    ok: true,
    value: { state: "unknown", observed_hash: null, observed_at: null },
  }),
) {
  const time = manualClock();
  const sent: Sent[] = [];
  const lookups: string[] = [];
  let keys = 0;
  const session = new SaveSession({
    port: {
      write(input) {
        const item: Sent = {
          text: decoder.decode(input.bytes),
          base: input.base_hash,
          end: input.end,
          key: input.request_key,
          ...(input.base_version ? { baseVersion: input.base_version } : {}),
        };
        sent.push(item);
        return Promise.resolve(answer(item, sent.length - 1));
      },
      lookup(key) {
        lookups.push(key);
        return Promise.resolve(lookup(key));
      },
    },
    baseHash: H0,
    text: "start",
    clock: time.clock,
    newKey: () => `key-${++keys}`.padEnd(20, "x"),
  });
  return { session, sent, lookups, time };
}

Deno.test("shell/editor#R12: 저장 버튼 없이 입력이 멈추면 마지막 글 하나만 파일로 쓰고 다음 쓰기는 쓴 hash를 기준으로 한다", async () => {
  const { session, sent, time } = harness();
  session.edit("a");
  session.edit("ab");
  session.edit("abc");
  assertEquals(saveHeadline(session.facts).kind, "saving");
  await time.advance(SAVE_QUIET_MS - 1);
  assertEquals(sent.length, 0);
  await time.advance(1);
  assertEquals(sent.map((item) => [item.text, item.base, item.end]), [
    ["abc", H0, false],
  ]);
  assertEquals(session.facts.disk.state, "saved");
  assertEquals(session.facts.version.state, "waiting");
  assertEquals(saveHeadline(session.facts).kind, "saved");
  session.edit("abcd");
  await time.advance(SAVE_QUIET_MS);
  assertEquals(sent[1]!.base, "h1".padEnd(64, "0"));
});

Deno.test("shell/editor#R1: 편집 종료는 남은 고침을 한 번에 version 준비와 함께 보내고, 고침이 없으면 종료를 다시 보내지 않는다", async () => {
  const { session, sent, time } = harness();
  // 고친 적이 없으면 종료할 것도 없다.
  assert(await session.flush(true));
  assertEquals(sent.length, 0);
  session.edit("one");
  assert(await session.flush(true));
  assertEquals(sent.map((item) => [item.text, item.end]), [["one", true]]);
  assertEquals(session.facts.version.state, "preparing");
  assertEquals(session.needsEnd(), false);
  assert(await session.flush(true));
  assertEquals(sent.length, 1);
  // 자동 저장 뒤의 종료는 지금 바이트로 종료를 한 번 보낸다.
  session.edit("two");
  await time.advance(SAVE_QUIET_MS);
  assertEquals(session.needsEnd(), true);
  assert(await session.flush(true));
  assertEquals(sent.map((item) => [item.text, item.end]), [
    ["one", true],
    ["two", false],
    ["two", true],
  ]);
  assert(await session.flush(true));
  assertEquals(sent.length, 3);
});

Deno.test("shell/editor#R2: 디스크 저장·기록 확인·version 확정·형식 검사를 따로 기억하고 뒤 단계 실패를 파일 저장 실패로 바꾸지 않는다", async () => {
  const { session } = harness((_sent, index) => ({
    ok: true,
    value: report({
      written_hash: `h${index}`.padEnd(64, "0"),
      recording: "unverified",
      version: "validation_failed",
      problems: [{
        severity: "error",
        message: "Heading is missing",
        file: "plan.md",
        start_line: 2,
      }],
    }),
  }));
  session.edit("bad");
  await session.flush(true);
  const facts = session.facts;
  assertEquals(facts.disk.state, "saved");
  assertEquals(facts.record.state, "unverified");
  assertEquals(facts.version.state, "validation_failed");
  assertEquals(facts.format.state, "failed");
  // 메타 줄은 결과 하나와 다음 행동 하나다.
  assertEquals(saveHeadline(facts), {
    kind: "format-failed",
    tone: "warning",
    action: "problems",
    count: 1,
  });
  // 단계별 사실은 상세에서 구별한다.
  assertEquals(
    saveDetails(facts).map((detail) => [detail.stage, detail.value]),
    [
      ["file", "saved"],
      ["record", "unverified"],
      ["version", "validation_failed"],
      ["format", "failed"],
    ],
  );
  assert(saveDetails(facts).every((detail) => detail.at !== null));
});

Deno.test("shell/editor#R12: 쓰기 실패는 정한 간격으로 다시 시도하고, 다 쓰면 실패와 다시 시도를 보이며 정상 저장으로 보이지 않는다", async () => {
  let fail = true;
  const { session, sent, time } = harness((_sent, index) =>
    fail
      ? { ok: true, value: report({ disk: "failed", failure: "unavailable" }) }
      : {
        ok: true,
        value: report({ written_hash: `h${index}`.padEnd(64, "0") }),
      }
  );
  session.edit("x");
  await time.advance(SAVE_QUIET_MS);
  assertEquals(sent.length, 1);
  assertEquals(saveHeadline(session.facts).kind, "saving");
  for (const delay of RETRY_DELAYS_MS) await time.advance(delay);
  assertEquals(sent.length, 1 + RETRY_DELAYS_MS.length);
  assertEquals(saveHeadline(session.facts), {
    kind: "failed",
    tone: "critical",
    action: "retry",
  });
  assert(session.unsettled());
  // 더는 혼자 다시 쓰지 않는다.
  await time.advance(60_000);
  assertEquals(sent.length, 1 + RETRY_DELAYS_MS.length);
  fail = false;
  session.retry();
  await flushPromises();
  assertEquals(session.facts.disk.state, "saved");
  assertEquals(session.unsettled(), false);
});

Deno.test("shell/editor#R12: 연결이 끊긴 쓰기는 연결 끊김으로 보이고 정상 저장으로 보이지 않는다", async () => {
  const { session, time } = harness(() => ({
    ok: true,
    value: report({ disk: "failed", failure: "offline" }),
  }));
  session.edit("x");
  await time.advance(SAVE_QUIET_MS);
  for (const delay of RETRY_DELAYS_MS) await time.advance(delay);
  assertEquals(saveHeadline(session.facts).kind, "offline");
  assertEquals(session.facts.disk.state, "offline");
});

Deno.test("shell/editor#R12: 결과를 모르는 쓰기는 다시 쓰지 않고 documents 결과 조회부터 하며, 조회가 그 바이트를 찾으면 저장으로 본다", async () => {
  let found: LookupReport["state"] = "unknown";
  const { session, sent, lookups, time } = harness(
    () => ({
      ok: true,
      value: report({ disk: "unknown", failure: "unknown" }),
    }),
    () => ({
      ok: true,
      value: {
        state: found,
        observed_hash: found === "written" ? "f".repeat(64) : null,
        observed_at: null,
      },
    }),
  );
  session.edit("maybe");
  await time.advance(SAVE_QUIET_MS);
  assertEquals(sent.length, 1);
  assertEquals(lookups.length, 1);
  assertEquals(saveHeadline(session.facts), {
    kind: "unknown",
    tone: "warning",
    action: "check",
  });
  // 모르는 동안 고쳐도 쓰지 않는다.
  session.edit("maybe more");
  await time.advance(SAVE_QUIET_MS * 10);
  assertEquals(sent.length, 1);
  assert(session.unsettled());
  found = "written";
  await session.check();
  assertEquals(session.facts.disk.state, "saved");
  assertEquals(session.facts.record.state, "unverified");
  assertEquals(session.baseHash, "f".repeat(64));
  // 조회 뒤 남은 고침은 그 hash 위에 쓴다.
  await time.advance(SAVE_QUIET_MS);
  assertEquals(sent[1]!.text, "maybe more");
  assertEquals(sent[1]!.base, "f".repeat(64));
});

Deno.test("shell/editor#R15: 충돌이면 쓰기를 멈추고 초안을 그대로 두며, 사람이 고른 쪽만 쓴다", async () => {
  let conflict = true;
  const { session, sent, time } = harness((_sent, index) =>
    conflict
      ? { ok: true, value: report({ disk: "conflict", failure: "conflict" }) }
      : {
        ok: true,
        value: report({ written_hash: `h${index}`.padEnd(64, "0") }),
      }
  );
  session.edit("mine");
  await time.advance(SAVE_QUIET_MS);
  assertEquals(session.facts.disk.state, "conflict");
  assertEquals(topNotice(saveNotices(session.facts)), "conflict");
  assertEquals(saveHeadline(session.facts), {
    kind: "conflict",
    tone: "warning",
    action: "compare",
  });
  session.edit("mine 2");
  await time.advance(SAVE_QUIET_MS * 5);
  assertEquals(sent.length, 1);
  assertEquals(session.text, "mine 2");
  assertEquals(await session.flush(true), false);
  assertEquals(sent.length, 1);
  // 바깥 상태가 바뀌어도 충돌 중에는 받지 않는다.
  assertEquals(
    session.applyStatus({
      state: "tracked",
      observed_hash: "e".repeat(64),
      observed_at: "",
      compared_version: null,
      cursor: "c",
    }),
    "ignore",
  );
  // 사람이 내 글을 고르면 지금 디스크 hash 위에 쓴다.
  conflict = false;
  await session.keepMine("e".repeat(64));
  assertEquals(sent[1]!.text, "mine 2");
  assertEquals(sent[1]!.base, "e".repeat(64));
  assertEquals(session.facts.disk.state, "saved");
  assertEquals(saveNotices(session.facts), []);
});

Deno.test("shell/editor#R15: 디스크 글을 고르면 초안을 그 글로 바꾸고 더 쓰지 않는다", async () => {
  const { session, sent, time } = harness(() => ({
    ok: true,
    value: report({ disk: "conflict", failure: "conflict" }),
  }));
  session.edit("mine");
  await time.advance(SAVE_QUIET_MS);
  session.takeTheirs("theirs", "d".repeat(64));
  assertEquals(session.text, "theirs");
  assertEquals(session.baseHash, "d".repeat(64));
  assertEquals(session.unsettled(), false);
  await time.advance(SAVE_QUIET_MS * 5);
  assertEquals(sent.length, 1);
});

Deno.test("shell/editor#R2 shell/editor#R15: version 충돌은 파일 저장을 지우지 않고, 사람이 최신 판을 새 기준으로 고르면 그 판으로 다시 확정한다", async () => {
  let round = 0;
  const { session, sent } = harness((_sent, index) => {
    round += 1;
    return {
      ok: true,
      value: report({
        written_hash: `h${index}`.padEnd(64, "0"),
        version: round === 1 ? "conflict" : "confirmed",
        latest_version: round === 1 ? "ver_latest" : null,
      }),
    };
  });
  session.edit("mine");
  await session.flush(true);
  assertEquals(session.facts.disk.state, "saved");
  assertEquals(session.facts.version, {
    state: "conflict",
    at: session.facts.version.at,
    latest: "ver_latest",
  });
  assertEquals(topNotice(saveNotices(session.facts)), "version-conflict");
  await session.keepMineAsVersion("ver_latest");
  assertEquals(sent[1]!.end, true);
  assertEquals(sent[1]!.baseVersion, "ver_latest");
  assertEquals(session.facts.version.state, "confirmed");
});

Deno.test("shell/editor#R1: 유휴 종료는 documents가 알린 상태로만 반영하고 shell은 version timer를 두지 않는다", async () => {
  const { session, sent, time } = harness();
  session.edit("draft");
  await time.advance(SAVE_QUIET_MS);
  const written = session.baseHash;
  // 입력 멈춤 timer 밖에는 아무 timer도 남지 않는다.
  assertEquals(time.pending.size, 0);
  await time.advance(60 * 60_000);
  assertEquals(sent.length, 1);
  assertEquals(session.facts.version.state, "waiting");
  const status: WatchReport = {
    state: "tracked",
    observed_hash: written,
    observed_at: "2026-10-06T00:00:00.000Z",
    compared_version: "ver_idle",
    cursor: "c1",
  };
  assertEquals(session.applyStatus(status), "same");
  assertEquals(session.facts.version.state, "confirmed");
  // documents가 판을 만들었으니 닫을 때 종료를 다시 보내지 않는다.
  assertEquals(session.needsEnd(), false);
  assert(await session.flush(true));
  assertEquals(sent.length, 1);
});

Deno.test("shell/editor#R15: 고침이 없을 때 바깥에서 바뀐 파일은 다시 읽고, 고침이 있으면 받지 않는다", async () => {
  const { session, time } = harness();
  const outside: WatchReport = {
    state: "version_pending",
    observed_hash: "b".repeat(64),
    observed_at: "",
    compared_version: null,
    cursor: "c",
  };
  assertEquals(session.applyStatus(outside), "reload");
  session.reloaded("outside", "b".repeat(64));
  assertEquals(session.text, "outside");
  assertEquals(session.baseHash, "b".repeat(64));
  session.edit("typing");
  assertEquals(
    session.applyStatus({ ...outside, observed_hash: "c".repeat(64) }),
    "ignore",
  );
  await time.advance(SAVE_QUIET_MS);
});

Deno.test("shell/editor#R15: notice는 가장 높은 우선순위 하나이고 디스크 재읽기 안내가 가장 낮다", () => {
  assertEquals(topNotice([]), null);
  assertEquals(topNotice(["reloaded", "width-failed"]), "width-failed");
  assertEquals(
    topNotice(["reloaded", "version-conflict", "conflict"]),
    "conflict",
  );
  assertEquals(topNotice(["reloaded"]), "reloaded");
});

Deno.test("shell/editor#R1: 명시 폐기는 남은 고침을 버리고 더 쓰지 않는다", async () => {
  const { session, sent, time } = harness(() => ({
    ok: true,
    value: report({ disk: "failed", failure: "unavailable" }),
  }));
  session.edit("gone");
  await time.advance(SAVE_QUIET_MS);
  session.discard();
  assertEquals(session.unsettled(), false);
  await time.advance(60_000);
  assertEquals(sent.length, 1);
});
