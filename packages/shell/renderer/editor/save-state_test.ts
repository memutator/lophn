import { assertEquals } from "@std/assert";

import type { FileFailure, FileReply } from "../../ipc/files.ts";
import {
  SAVE_QUIET_MS,
  type SaveClock,
  SaveSession,
  type SaveState,
} from "./save-state.ts";

// 수동 clock. advance가 때가 된 timer를 부른다.
function manualClock() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: SaveClock = {
    set(run, ms) {
      next += 1;
      timers.set(next, { at: now + ms, run });
      return next;
    },
    clear(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    async advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.run();
        }
      }
      await settle();
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

// main의 규칙만 흉내 낸 디스크 한 파일. write는 base_hash가 지금 hash와 다르면 conflict다.
function fakeDisk(text: string) {
  let n = 0;
  const disk = { text, hash: `h${n}` as string | null, writes: 0 };
  // 첫 쓰기만 실패시킨다. applied면 실패한 쓰기가 디스크에는 들어갔다(답만 끊김).
  const fail: { write?: FileFailure; read?: FileFailure; applied?: boolean } =
    {};
  const port = {
    write(input: { base_hash: string | null; text: string }) {
      disk.writes += 1;
      if (fail.write) {
        const code = fail.write;
        fail.write = undefined;
        if (fail.applied) {
          disk.text = input.text;
          disk.hash = `h${++n}`;
        }
        return Promise.resolve(
          { ok: false, code } as FileReply<{ hash: string }>,
        );
      }
      if (input.base_hash !== disk.hash) {
        return Promise.resolve(
          { ok: false, code: "conflict" } as FileReply<{ hash: string }>,
        );
      }
      disk.text = input.text;
      disk.hash = `h${++n}`;
      return Promise.resolve({ ok: true, value: { hash: disk.hash } } as const);
    },
    read() {
      if (fail.read) {
        return Promise.resolve(
          { ok: false, code: fail.read } as FileReply<
            { text: string; hash: string }
          >,
        );
      }
      return Promise.resolve(
        { ok: true, value: { text: disk.text, hash: disk.hash! } } as const,
      );
    },
    /** 밖(다른 편집기)이 파일을 바꾼다. */
    outside(text: string) {
      disk.text = text;
      disk.hash = `h${++n}`;
      return disk.hash;
    },
  };
  return { disk, fail, port };
}

function open(text = "one") {
  const fake = fakeDisk(text);
  const time = manualClock();
  const session = new SaveSession({
    port: fake.port,
    text,
    hash: fake.disk.hash,
    clock: time.clock,
  });
  const states: SaveState[] = [];
  session.subscribe((facts) => states.push(facts.state));
  const replaced: string[] = [];
  session.onReplace((next) => replaced.push(next));
  return { ...fake, session, time, states, replaced };
}

Deno.test("충돌에서는 사람이 고르기 전까지 디스크에 쓰지 않고 초안이 남는다", async () => {
  const t = open();
  t.session.edit("mine");
  t.port.outside("theirs");
  await t.time.advance(SAVE_QUIET_MS);
  assertEquals(t.session.facts.state, "conflict");
  assertEquals(t.disk.text, "theirs");
  const writes = t.disk.writes;
  t.session.edit("mine, more");
  await t.time.advance(SAVE_QUIET_MS * 5);
  assertEquals(t.disk.writes, writes);
  assertEquals(t.session.text, "mine, more");
  // 내 것을 남기면 지금 디스크 hash 위에 쓴다.
  await t.session.keepMine();
  assertEquals(t.disk.text, "mine, more");
  assertEquals(t.session.facts.state, "saved");
});

Deno.test("밖에서 바뀐 파일은 고치지 않았을 때만 다시 읽고 고치는 중이면 충돌이 된다", async () => {
  const clean = open();
  await clean.session.external(clean.port.outside("changed"));
  assertEquals(clean.replaced, ["changed"]);
  assertEquals(clean.session.text, "changed");
  assertEquals(clean.session.facts.state, "saved");

  const dirty = open();
  dirty.session.edit("mine");
  await dirty.session.external(dirty.port.outside("theirs"));
  assertEquals(dirty.replaced, []);
  assertEquals(dirty.session.text, "mine");
  assertEquals(dirty.session.facts.state, "conflict");

  // 내 쓰기의 메아리는 읽지도 충돌로 보지도 않는다.
  const echo = open();
  echo.session.edit("mine");
  await echo.time.advance(SAVE_QUIET_MS);
  await echo.session.external(echo.disk.hash);
  assertEquals(echo.replaced, []);
  assertEquals(echo.session.facts.state, "saved");
});

Deno.test("결과를 모르는 쓰기는 다시 쓰지 않고 읽은 hash로 저장됨, 안 써짐, 충돌을 가른다", async () => {
  const cases: {
    name: string;
    applied: boolean;
    outside?: string;
    state: SaveState;
    writes: number;
    diskText: string;
  }[] = [
    // 썼는데 답이 끊김: 읽은 글이 내가 보낸 글이다. 다시 쓰지 않는다.
    {
      name: "saved",
      applied: true,
      state: "saved",
      writes: 1,
      diskText: "mine",
    },
    // 안 써짐: 이전 hash 그대로다. 그제야 한 번 다시 쓴다.
    {
      name: "not written",
      applied: false,
      state: "saved",
      writes: 2,
      diskText: "mine",
    },
    // 그 사이 남이 바꿈: 다시 쓰지 않고 충돌이다.
    {
      name: "conflict",
      applied: false,
      outside: "theirs",
      state: "conflict",
      writes: 1,
      diskText: "theirs",
    },
  ];
  for (const c of cases) {
    const t = open();
    t.fail.write = "unavailable";
    t.fail.applied = c.applied;
    if (c.outside) t.port.outside(c.outside);
    t.session.edit("mine");
    await t.time.advance(SAVE_QUIET_MS);
    assertEquals(t.session.facts.state, c.state, c.name);
    assertEquals(t.disk.writes, c.writes, c.name);
    assertEquals(t.disk.text, c.diskText, c.name);
  }
});
