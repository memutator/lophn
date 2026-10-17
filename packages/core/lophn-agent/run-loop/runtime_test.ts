import { assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import type { CredentialRegistry } from "../../server/identity/mod.ts";
import type { Supervisor } from "../../supervision/responsiveness/mod.ts";
import { createInbox } from "./inbox.ts";
import { startAgentRuntimeChild } from "./runtime.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => resolve = r);
  return { promise, resolve };
}

// 이 시험은 위험 하나를 지킨다: 도는 turn이 있는데 child가 바뀌어 그 turn이 끊기는 것.
Deno.test("도는 turn이 있으면 child를 바꾸지 않고, turn이 끝나면 마지막 목록으로 한 번 바꾼다", async () => {
  const inbox = createInbox();
  inbox.setRunning("ses_s1" as never, true);
  let folders = ["/a"];
  let reads = 0;
  let updates = 0;
  let readsAt = 0;
  let readsReached = deferred();
  const updated = deferred();
  const waitReads = (count: number) => {
    readsAt = reads + count;
    readsReached = deferred();
    return readsReached.promise;
  };
  const io = {
    start: () => Promise.resolve({ ok: true }),
    updateSpec: () => {
      updates += 1;
      updated.resolve();
      return Promise.resolve({ ok: true });
    },
    send: () => Promise.resolve({ ok: true }),
  } as unknown as Supervisor;
  const registry = {
    issue: () => Promise.resolve(ok({ credential_ref: "c", token: "t" })),
    revalidate: () => ok({}),
    endBy: () => {},
  } as unknown as CredentialRegistry;

  const started = await startAgentRuntimeChild({
    io,
    registry,
    record: () => Promise.resolve(ok(undefined)),
    operationsFor: () => [],
    conditionsFor: () => ({}),
    epoch: "e",
    dataRoot: "/data",
    apiPort: 1,
    gauge: undefined as never,
    prepareBlob: undefined as never,
    readProviders: () => Promise.resolve(ok([])),
    readPlaceFolders: () => {
      reads += 1;
      if (reads >= readsAt) readsReached.resolve();
      return Promise.resolve(ok({ read: folders, write: folders }));
    },
    read: undefined as never,
    known: () => undefined,
    secrets: undefined as never,
    socketRoot: "/sock",
    bundledSkillsRoot: "/skills",
    inbox,
    pollMs: 1,
  });
  if (!started.ok) throw new Error(started.error.message);
  try {
    // turn이 도는 동안 폴더가 두 번 바뀌어도 child는 그대로다.
    folders = ["/a", "/b"];
    await waitReads(5);
    folders = ["/a", "/b", "/c"];
    await waitReads(5);
    assertEquals(updates, 0);

    inbox.setRunning("ses_s1" as never, false);
    await updated.promise;
    await waitReads(5);
    assertEquals(updates, 1);
  } finally {
    started.value.stop();
  }
});
