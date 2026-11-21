import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import { createHostQueue } from "../../../host-queue/mod.ts";
import { askLogin } from "./input-request.ts";

const WORK = `bpf_${"1".repeat(26)}` as Id<"bpf">;
const PLAIN = `ses_${"1".repeat(26)}` as Id<"ses">;
const WORKER = `ses_${"2".repeat(26)}` as Id<"ses">;
const BROKEN = `ses_${"3".repeat(26)}` as Id<"ses">;
const ORIGIN = "https://example.com";

// 사람이 login 저장 요청 창에서 넣은 login은 이 view의 profile에 저장된다. 깨지면 login이 그 탭이 아닌 profile에 서서
// 다른 cookie의 탭에서 쓰이거나, 다른 profile의 agent가 preview·artifact 탭에서 기본 profile에 login을 넣게 한다.
test("login 요청의 view는 그 탭에서 다룰 login의 profile을 싣고, 다른 profile의 agent가 browser 탭이 아닌 탭에서 낸 save는 거절한다", async () => {
  const clock = manualClock(0);
  const queue = createHostQueue({
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const own: Record<string, Id<"bpf"> | null> = {
    [PLAIN]: null,
    [WORKER]: WORK,
  };
  const place = (
    owner: Id<"ses">,
    target: Parameters<typeof queue.openTab>[0]["target"],
    profile?: Id<"bpf">,
  ) =>
    queue.openTab({
      owner,
      workspace: { kind: "project", id: `prj_${"1".repeat(26)}` as never },
      target,
      relation: null,
      source: null,
      ...(profile === undefined ? {} : { profile }),
    });
  const tabs = {
    workerBrowser: place(WORKER, { browser: { url: ORIGIN } }, WORK),
    workerArtifact: place(WORKER, { artifact: { name: "notes" } }),
    plainBrowser: place(PLAIN, { browser: { url: ORIGIN } }),
    plainArtifact: place(PLAIN, { artifact: { name: "report" } }),
    brokenArtifact: place(BROKEN, { artifact: { name: "draft" } }),
  };
  const asked: { profile: string | null }[] = [];
  let measured = 0;
  const request = (session: Id<"ses">, tab: string, mode: "save" | "once") =>
    askLogin(
      {
        queue,
        ownProfile: (session) =>
          session === BROKEN
            ? err({ code: "unavailable", message: "unknown profile" })
            : ok(own[session] ?? null),
        measure: () => {
          measured += 1;
          return Promise.resolve(ok({ origin: ORIGIN, title: "Sign in" }));
        },
        ask: (view) => {
          asked.push(view);
          return Promise.resolve(ok({ login: `lgn_${"0".repeat(26)}` }));
        },
      },
      session,
      { tab, ref: "e2", mode },
    );
  const profileOf = async (
    session: Id<"ses">,
    tab: string,
    mode: "save" | "once" = "save",
  ) => {
    const reply = await request(session, tab, mode);
    assert.ok(reply.ok, JSON.stringify(reply));
    return asked.pop()!.profile;
  };
  assert.equal(await profileOf(WORKER, tabs.workerBrowser), WORK);
  assert.equal(await profileOf(PLAIN, tabs.plainBrowser), null);
  assert.equal(await profileOf(PLAIN, tabs.plainArtifact), null);
  // once는 저장하지 않아 다른 profile의 agent도 preview·artifact 탭에서 낸다.
  assert.equal(await profileOf(WORKER, tabs.workerArtifact, "once"), null);

  const before = measured;
  for (const [session, tab, code] of [
    [WORKER, tabs.workerArtifact, "forbidden"],
    [BROKEN, tabs.brokenArtifact, "unavailable"],
    [PLAIN, tabs.workerBrowser, "not_found"],
  ] as const) {
    const refused = await request(session, tab, "save");
    assert.ok(!refused.ok);
    assert.equal(refused.error.code, code);
  }
  assert.equal(measured, before);
  assert.deepEqual(asked, []);
});
