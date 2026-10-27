// 세 질문
// - contract: boundary `models`(구독 token으로 부르는 길, 갱신, 계정 model 목록)와 `secrets`(회전한 refresh token의 저장).
// - 현실적 회귀: 진짜 ChatGPT 계정이 목록·호출·갱신에서 fake 발급자와 다르게 답하는 것(칸 이름, 만료, 회전).
// - 지금 못 잡는 이유: fake 발급자와 fake model server는 우리가 짠 모양만 안다. 진짜 구독 token은 사람이 한 번 로그인해
//   저장한 live root(root.ts)가 있어야 하고, 이 test는 사람이 `npm run test:live`로 돌릴 때만 의미가 있다.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { providerTokenNames } from "../../packages/core/lophn-agent/providers/oauth-secrets.ts";
import {
  modelCallList,
  modelCatalogRead,
  OAUTH_REFRESH_LEAD_MS,
  providerList,
  providerRead,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  openSession,
  say,
  settle,
  turnsOf,
  until,
} from "../support/core/human.ts";
import { bootLiveCore, LIVE_HOME } from "./root.ts";

const TURN_MS = 90_000;

// refresh token 값은 보관하지 않고 이름별 SHA-256 해시만 둔다.
async function refreshHashes(): Promise<Map<string, string>> {
  const secrets = JSON.parse(
    await readFile(`${LIVE_HOME}/secrets.json`, "utf8"),
  ) as Record<string, string>;
  const hashes = new Map<string, string>();
  for (const [name, value] of Object.entries(secrets)) {
    if (!name.endsWith(".refresh")) continue;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    hashes.set(name, Buffer.from(digest).toString("hex"));
  }
  return hashes;
}

test("구독 token으로 model을 한 번 부르고 갱신이 있으면 회전한 refresh token이 저장된다", async () => {
  const hashesBefore = await refreshHashes();
  const core = await bootLiveCore();
  let stopped = false;
  try {
    const chatgpt = (await core.call(providerList, {})).providers.find(
      (item) => item.definition.oauth?.product === "chatgpt",
    );
    // root가 있다는 것은 gate가 이미 봤다. 쓸 수 없는 root를 조용히 넘기면 만료를 숨긴다.
    assert.ok(
      chatgpt !== undefined && chatgpt.credential.state === "available",
      "ChatGPT 로그인을 쓸 수 없다. `npm run test:live:login`을 다시 하라(필요하면 `chmod -R u+w .dev-data/live && rm -rf .dev-data/live` 뒤)",
    );
    const provider = chatgpt.id;
    const expiresBefore = Date.parse(chatgpt.credential.expires_at ?? "");
    const due = !(expiresBefore - Date.now() > OAUTH_REFRESH_LEAD_MS);

    await settle(core);
    const session = await openSession(core, { role: "lophn" });
    await say(core, session, "Reply with the single word: ok");
    const turn = await until(
      "turn이 끝남",
      async () => {
        const first = (await turnsOf(core, session))[0];
        return first?.state === "finished" ? first : undefined;
      },
      TURN_MS,
    );
    assert.deepStrictEqual(
      turn.outcome?.kind,
      "completed",
      JSON.stringify(turn.outcome),
    );
    const { calls } = await core.call(modelCallList, { session });
    assert.ok(
      calls.length >= 1 && calls.length <= 10,
      `호출 ${calls.length}개`,
    );
    for (const call of calls) {
      assert.deepStrictEqual(call.model.billing_route, "subscription");
    }

    // 목록은 token을 건넨 뒤 뒤에서 읽는다.
    const models = await until(
      "계정 model 목록",
      async () => {
        const read = await core.call(providerRead, { provider });
        return read.provider.credential.reported_models ?? undefined;
      },
      20_000,
    );
    const catalog = await core.call(modelCatalogRead, {
      provider_definition: "openai",
    });
    assert.ok(
      catalog.entries.some((entry) => models.includes(entry.model_name)),
      "계정 model 목록이 catalog와 겹치지 않는다(칸 이름이나 철자를 본다)",
    );

    const after = await core.call(providerRead, { provider });
    await core.stop();
    stopped = true;
    if (!due) {
      console.log(
        `갱신 시점이 아니라 확인하지 못했다(만료까지 ${Math.round(
          (expiresBefore - Date.now()) / 60_000,
        )}분). 만료 5분 전 안에 다시 돌려라.`,
      );
      return;
    }
    assert.ok(
      Date.parse(after.provider.credential.expires_at ?? "") > expiresBefore,
      "갱신했는데 만료가 늦춰지지 않았다",
    );
    const name = `${providerTokenNames(provider).access}.refresh`;
    const hashesAfter = await refreshHashes();
    assert.ok(hashesBefore.has(name) && hashesAfter.has(name));
    assert.ok(
      hashesAfter.get(name) !== hashesBefore.get(name),
      "refresh token이 회전하지 않았다",
    );
  } finally {
    // 실패해도 root를 지우지 않는다. core만 닫는다.
    if (!stopped) await core.kill();
  }
});
