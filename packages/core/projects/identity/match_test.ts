import assert from "node:assert/strict";
import { test } from "node:test";

import type { SharedProject } from "../../../protocol/folder/mod.ts";
import {
  type MatchAction,
  matchActions,
  type MatchProject,
  sharedProjects,
} from "./match.ts";

const KEY = "github.com/me/notes";
const pri = (n: number) => `pri_0000000000000000000000000${n}`;

function project(
  identity: string,
  extra: Partial<MatchProject> = {},
): MatchProject {
  return {
    id: `prj_for_${identity}`,
    identity,
    former_identities: [],
    status: "active",
    repo: "git",
    separated: false,
    remote: { key: KEY },
    ...extra,
  };
}

// 컴퓨터 하나는 project 목록을 들고, 다른 컴퓨터의 기계 기록을 받으면 matchActions대로 바꾼다. command의 조건 검사는 따로 본다.
type Computer = { name: string; projects: MatchProject[] };

function apply(computer: Computer, actions: readonly MatchAction[]) {
  for (const action of actions) {
    computer.projects = computer.projects.map((one) => {
      if (one.id !== action.project || one.identity !== action.from) {
        return one;
      }
      return "identity" in action
        ? {
            ...one,
            identity: action.identity,
            former_identities: [...one.former_identities, one.identity],
          }
        : { ...one, separated: true };
    });
  }
}

// `from`이 `to`의 기록을 받는다(link, 폰, 같이 보는 폴더 어느 길이든 같다).
function meet(to: Computer, from: Computer, roster = [from.name]) {
  apply(
    to,
    matchActions(
      to.projects,
      [{ machine: from.name, projects: sharedProjects(from.projects) }],
      new Set(roster),
    ),
  );
}

const identities = (...computers: Computer[]) =>
  computers.map((computer) => computer.projects[0]!.identity);

test("같은 저장소의 project는 셋 이상이 어느 순서로 만나도(가운데 컴퓨터를 거쳐서도) 가장 작은 id 하나에 서고 다시 만나도 그대로다", () => {
  const orders: [number, number][][] = [
    [
      [0, 1],
      [1, 0],
      [2, 1],
      [1, 2],
      [0, 1],
    ],
    // C만 B를 거쳐 A의 id를 안다.
    [
      [2, 1],
      [1, 2],
      [1, 0],
      [2, 1],
      [0, 1],
    ],
    [
      [1, 2],
      [0, 2],
      [2, 0],
      [1, 0],
      [2, 1],
    ],
  ];
  for (const order of orders) {
    // 셋째 컴퓨터가 가장 오래된 id를 든다.
    const computers: Computer[] = [
      { name: "a", projects: [project(pri(5))] },
      { name: "b", projects: [project(pri(7))] },
      { name: "c", projects: [project(pri(2))] },
    ];
    for (const [to, from] of order) meet(computers[to]!, computers[from]!);
    assert.deepEqual(identities(...computers), [pri(2), pri(2), pri(2)]);
    const before = JSON.stringify(computers);
    for (const [to, from] of order) meet(computers[to]!, computers[from]!);
    assert.equal(JSON.stringify(computers), before);
  }
});

test("한쪽에 같은 저장소의 project가 둘이면 그쪽과 맞추지 않고, 하나를 나누면 남은 하나가 맞춰진다", () => {
  const here: Computer = {
    name: "here",
    projects: [project(pri(5)), project(pri(6), { id: "prj_copy" })],
  };
  const there: Computer = { name: "there", projects: [project(pri(1))] };
  meet(here, there);
  assert.deepEqual(
    here.projects.map((one) => one.identity),
    [pri(5), pri(6)],
  );
  // 저쪽에 둘이어도 그 컴퓨터와는 맞추지 않는다.
  meet(there, here);
  assert.equal(there.projects[0]!.identity, pri(1));

  here.projects[1] = { ...here.projects[1]!, separated: true };
  meet(here, there);
  assert.deepEqual(
    here.projects.map((one) => one.identity),
    [pri(1), pri(6)],
  );
});

test("나눈 project는 어느 쪽에서도 맞춰지지 않고, 더 오래된 id를 든 셋째 컴퓨터가 와도 나눈 것이 풀리지 않는다", () => {
  const a: Computer = { name: "a", projects: [project(pri(3))] };
  // b는 pri(3)으로 맞춰진 뒤 사람이 나눠 pri(9)가 되었다.
  const b: Computer = {
    name: "b",
    projects: [
      project(pri(9), { separated: true, former_identities: [pri(3)] }),
    ],
  };
  const e: Computer = { name: "e", projects: [project(pri(1))] };
  meet(a, e);
  meet(b, a);
  meet(b, e);
  meet(a, b);
  meet(e, b);
  assert.deepEqual(identities(a, b, e), [pri(1), pri(9), pri(1)]);

  // 시계가 늦어 나눈 id가 더 작아도 다른 쪽이 그리로 가지 않는다.
  const late: Computer = {
    name: "late",
    projects: [project(pri(0), { separated: true })],
  };
  meet(a, late);
  assert.equal(a.projects[0]!.identity, pri(1));

  // 나눈 project의 id를 clone해 온 project는 나눈 것이 된다.
  const cloned: Computer = { name: "d", projects: [project(pri(9))] };
  meet(cloned, b);
  meet(cloned, a);
  assert.deepEqual(
    [cloned.projects[0]!.identity, cloned.projects[0]!.separated],
    [pri(9), true],
  );
});

test("자기 옛 id와 이 컴퓨터의 다른 project가 가진 id로는 가지 않고, 명단에 없는 기계의 기록은 쓰지 않는다", () => {
  const peer: SharedProject[] = [
    { identity: pri(1), remote_key: KEY, separated: false },
  ];
  const record = [{ machine: "peer", projects: peer }];
  const roster = new Set(["peer"]);

  assert.deepEqual(
    matchActions(
      [project(pri(5), { former_identities: [pri(1)] })],
      record,
      roster,
    ),
    [],
  );
  // 보관한 project가 그 id를 갖는다(보관한 것은 같은 저장소 수에 들지 않는다).
  assert.deepEqual(
    matchActions(
      [project(pri(5)), project(pri(1), { id: "prj_old", status: "archived" })],
      record,
      roster,
    ),
    [],
  );
  assert.deepEqual(matchActions([project(pri(5))], record, new Set()), []);
  assert.deepEqual(matchActions([project(pri(5))], record, roster), [
    {
      project: "prj_for_pri_00000000000000000000000005",
      from: pri(5),
      identity: pri(1),
    },
  ]);
});
