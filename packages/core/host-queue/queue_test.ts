import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdSource, manualClock, seededRandom } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import { createHostQueue } from "./queue.ts";

const OWNER = "ses_owner" as Id<"ses">;
const OTHER = "ses_other" as Id<"ses">;
const HOME = { kind: "home" } as const;

function setup() {
  const clock = manualClock(1_700_000_000_000);
  const ids = createIdSource({ clock, random: seededRandom(1) });
  return { clock, queue: createHostQueue({ clock, ids }) };
}

test("다른 session이 연 탭은 닫지도 읽지도 못한다", () => {
  const { queue } = setup();
  const tab = queue.openTab({
    opener: OWNER,
    workspace: HOME,
    target: { browser: { url: "https://example.com" } },
    place: null,
    source: OWNER,
  });
  queue.report(tab, {
    url: "https://example.com/",
    title: "t",
    loading: false,
  });

  const read = queue.read(tab, OTHER);
  assert.equal(!read.ok && read.error.code, "not_found");
  const close = queue.close(tab, OTHER);
  assert.equal(!close.ok && close.error.code, "forbidden");
  assert.equal(queue.close("tab_missing" as Id<"tab">, OWNER).ok, false);

  // 연 session은 읽고 닫는다. 닫으면 표에서 빠져 다시 닫지 못한다.
  assert.equal(queue.read(tab, OWNER).ok, true);
  assert.equal(queue.close(tab, OWNER).ok, true);
  const again = queue.close(tab, OWNER);
  assert.equal(!again.ok && again.error.code, "not_found");
});

test("retry한 요청은 뒤로 가서 다음 요청을 막지 않는다", () => {
  const { queue } = setup();
  const open = (url: string) =>
    queue.openTab({
      opener: OWNER,
      workspace: HOME,
      target: { browser: { url } },
      place: null,
      source: OWNER,
    });
  open("https://a.example");
  open("https://b.example");

  const first = queue.take([HOME])!;
  queue.done(first.id as Id<"hrq">, "retry");
  const next = queue.take([HOME])!;
  assert.notEqual(next.id, first.id);
});
