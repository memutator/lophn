import assert from "node:assert/strict";
import { test } from "node:test";

import type { Id } from "../../protocol/base/ids.ts";
import { readComputers } from "./computers.ts";

const id = (text: string) => `mch_${text}` as Id<"mch">;

// 앱이 이 컴퓨터를 고르는 것과 다른 컴퓨터를 `on`으로 고르는 것이 이 값에 달렸다.
test("컴퓨터 명단은 이 컴퓨터를 current로 맨 앞에 두고 다른 컴퓨터는 connected를 online으로 옮기며 기록이 없으면 always_on이 null이다", () => {
  const computers = readComputers({
    machine: () => ({ id: id("HOME"), name: "Home" }),
    keepsRunning: () => true,
    others: () => [
      { machine: id("SRV"), name: "Server", status: "connected" },
      { machine: id("LAP"), name: "Laptop", status: "offline" },
      // 명단에 이 컴퓨터가 섞여 와도 두 번 나오지 않는다.
      { machine: id("HOME"), name: "Home", status: "connected" },
    ],
    recordedKeepsRunning: (machine) => (machine === id("SRV") ? true : null),
  });
  assert.deepEqual(computers, [
    {
      id: id("HOME"),
      name: "Home",
      status: "online",
      current: true,
      always_on: true,
    },
    {
      id: id("SRV"),
      name: "Server",
      status: "online",
      current: false,
      always_on: true,
    },
    {
      id: id("LAP"),
      name: "Laptop",
      status: "offline",
      current: false,
      always_on: null,
    },
  ]);
});
