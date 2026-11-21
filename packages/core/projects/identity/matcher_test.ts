import assert from "node:assert/strict";
import { test } from "node:test";

import { err, ok, type Result } from "../../../base/mod.ts";
import type { SharedProject } from "../../../protocol/folder/mod.ts";
import type { MatchAction, MatchProject } from "./match.ts";
import { createMatcher } from "./matcher.ts";

const KEY = "github.com/me/notes";
const pri = (n: number) => `pri_0000000000000000000000000${n}`;

// 이 기계의 project 하나와 명단·기록을 들고, 바꾸기는 기록만 하는 가짜. refuse면 command가 conflict로 거절한다.
function setup(refuse = false) {
  let mine: MatchProject = {
    id: "prj_notes",
    identity: pri(5),
    former_identities: [],
    status: "active",
    repo: "git",
    separated: false,
    remote: { key: KEY },
  };
  const state = {
    roster: new Set<string>(),
    peers: [] as { machine: string; projects: SharedProject[] }[],
    writes: [] as MatchAction[],
    published: 0,
    reads: 0,
  };
  const matcher = createMatcher({
    local: () => {
      state.reads += 1;
      return [mine];
    },
    peers: () => state.peers,
    roster: () => state.roster,
    isPrivate: () => false,
    write(action): Promise<Result<unknown>> {
      state.writes.push(action);
      if (refuse) {
        return Promise.resolve(err({ code: "conflict", message: "stale" }));
      }
      if ("identity" in action) {
        mine = {
          ...mine,
          identity: action.identity,
          former_identities: [mine.identity],
        };
      }
      return Promise.resolve(ok(undefined));
    },
    publish: () => {
      state.published += 1;
    },
    warn: () => {},
    stopping: () => false,
  });
  const peer = (identity: string): SharedProject[] => [
    { identity, remote_key: KEY, separated: false },
  ];
  return { matcher, state, peer };
}

test("명단 컴퓨터의 바뀐 기록은 match 한 번과 기록 다시 쓰기를 부르고, 같은 기록이 다시 알려지면 ledger를 읽지 않는다", async () => {
  const { matcher, state, peer } = setup();
  state.roster = new Set(["a"]);
  state.peers = [{ machine: "a", projects: peer(pri(1)) }];
  await matcher.peersChanged();
  assert.deepEqual(state.writes, [
    { project: "prj_notes", from: pri(5), identity: pri(1) },
  ]);
  assert.equal(state.published, 1);
  const reads = state.reads;
  await matcher.peersChanged();
  assert.equal(state.reads, reads);
  assert.equal(state.writes.length, 1);
});

test("거절된 match는 기록 다시 쓰기도 다시 돌기도 부르지 않는다", async () => {
  const { matcher, state, peer } = setup(true);
  state.roster = new Set(["a"]);
  state.peers = [{ machine: "a", projects: peer(pri(1)) }];
  await matcher.peersChanged();
  assert.equal(state.writes.length, 1);
  assert.equal(state.published, 0);
});

test("기록이 이미 있는 컴퓨터가 명단에 들어오면 그 알림으로 맞춘다", async () => {
  const { matcher, state, peer } = setup();
  state.peers = [{ machine: "a", projects: peer(pri(1)) }];
  await matcher.peersChanged();
  assert.equal(state.writes.length, 0);
  state.roster = new Set(["a"]);
  await matcher.peersChanged();
  assert.equal(state.writes.length, 1);
});
