// `npm run test:live:login`의 진입. test가 아니라 사람이 한 번 돌리는 task다. 진짜 ChatGPT 로그인을 하고 live 전용 root
// (root.ts)에 token을 저장한다. 같은 컴퓨터의 browser가 필요하다(callback이 127.0.0.1 loopback이다).
// token·code·sign_in 주소의 state는 화면에만 나오고 파일이나 log에 쓰지 않는다.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { providerSecretName } from "../../packages/core/lophn-agent/providers/oauth-secrets.ts";
import {
  codexModelsHeaders,
  codexModelsUrl,
} from "../../packages/core/lophn-agent/providers/adapters/codex.ts";
import { parseReportedRoster } from "../../packages/core/lophn-agent/providers/reported-models.ts";
import {
  loginBegin,
  loginComplete,
  modelCatalogRead,
  modelDefaultChange,
  providerDefinitions,
  providerList,
  providerRead,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { until } from "../support/core/human.ts";
import type { Core } from "../support/core/mod.ts";
import { bootLiveCore, LIVE_HOME } from "./root.ts";

const MODEL_ENV = "LOPHN_LIVE_CHATGPT_MODEL";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function login(core: Core): Promise<number> {
  const known = (await core.call(providerList, {})).providers.find(
    (item) => item.definition.oauth?.product === "chatgpt",
  );
  if (known !== undefined) {
    if (known.credential.state === "available") {
      console.log(
        `이미 로그인돼 있다. access token 만료: ${known.credential.expires_at}`,
      );
      return 0;
    }
    console.log(
      `저장된 로그인을 쓸 수 없다(${known.credential.state}, ${known.credential.unavailable_reason}).\n` +
        `\`chmod -R u+w .dev-data/live && rm -rf .dev-data/live\`로 지우고(core가 깐 sdk 사본이 읽기 전용이다) 다시 실행하라.`,
    );
    return 1;
  }

  const { definitions } = await core.call(providerDefinitions, {});
  const definition = definitions.find((item) => item.key === "openai");
  assert.ok(definition !== undefined, "openai 정의가 없다");
  assert.ok(definition.oauth?.product === "chatgpt", "ChatGPT 로그인이 없다");
  const provider = core.ids.newId("pvd");
  const begun = await core.call(loginBegin, {
    provider,
    name: "ChatGPT",
    definition,
    endpoint: definition.oauth.inference_endpoint,
    protocol: "openai-responses",
  });
  console.log(
    "이 컴퓨터의 browser에서 아래 주소를 열어 ChatGPT로 로그인하라" +
      "(원격이면 callback 포트 1455를 port-forward 해야 한다).\n",
  );
  console.log(begun.sign_in.url);
  console.log("\n로그인을 기다린다…");
  const deadline = Date.parse(begun.expires_at);
  let connected = false;
  while (!connected) {
    if (Date.now() > deadline) {
      console.log("로그인 기한이 지났다. 다시 실행하라.");
      return 1;
    }
    const step = await core.call(loginComplete, {
      provider,
      login: begun.login,
    });
    if (step.state === "connected") connected = true;
    else await sleep(step.interval_ms);
  }
  console.log("로그인됐다. token은 live root에 저장됐다.");

  // core가 읽은 계정 model 목록(연결 직후 읽기는 아직 끝나지 않았을 수 있다).
  const read = async () =>
    (await core.call(providerRead, { provider })).provider.credential
      .reported_models;
  const fromCore = await until(
    "계정 model 목록",
    async () => {
      return (await read()) ?? undefined;
    },
    15_000,
  ).catch(() => null);
  console.log(
    fromCore === null
      ? "core가 계정 model 목록을 아직 읽지 못했다(첫 model 호출 때 다시 읽는다)."
      : `core가 읽은 계정 model: ${fromCore.length}개`,
  );

  // 응답 모양을 직접 확인한다: 칸 이름이 맞는지 보는 진단이다. token은 찍지 않는다.
  const account = (await core.call(providerRead, { provider })).provider
    .credential.account;
  const listed = await diagnose(
    provider,
    codexModelsUrl(definition.oauth.inference_endpoint),
    codexModelsHeaders(account),
  );
  const names = fromCore ?? listed;

  const catalog = await core.call(modelCatalogRead, {
    provider_definition: "openai",
  });
  const usable = catalog.entries
    .filter((entry) => entry.supports_tools !== false)
    .map((entry) => entry.model_name);
  const overlap = names === null ? [] : usable.filter((n) => names.includes(n));
  console.log(
    `계정 model ∩ catalog(tool 지원): ${overlap.length}개` +
      (names !== null && overlap.length === 0
        ? " (0이면 칸 이름이나 model id 철자가 catalog와 다른 것이다)"
        : ""),
  );

  const chosen = process.env[MODEL_ENV] ?? overlap[0];
  if (chosen === undefined) {
    console.log(
      `기본 model을 정하지 못했다. ${MODEL_ENV}에 model 이름을 주고 다시 실행하라.`,
    );
    return 1;
  }
  await core.call(modelDefaultChange, {
    default: { provider, model_name: chosen, option_values: {} },
  });
  console.log(`기본 model: ${chosen}`);
  return names === null || overlap.length === 0 ? 1 : 0;
}

// secrets.json의 access token으로 목록을 한 번 직접 읽어 응답 모양(칸 이름, visibility 값 종류, 개수)만 찍는다.
async function diagnose(
  provider: string,
  endpoint: string,
  headers: Record<string, string>,
): Promise<string[] | null> {
  const secrets = JSON.parse(
    await readFile(`${LIVE_HOME}/secrets.json`, "utf8"),
  ) as Record<string, string>;
  const access = secrets[providerSecretName(provider)];
  if (access === undefined) return null;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { ...headers, authorization: `Bearer ${access}` },
    });
  } catch (error) {
    console.log(
      `GET ${endpoint} 실패: ${error instanceof Error ? error.name : error}`,
    );
    return null;
  }
  const body = await response.text();
  console.log(`GET ${endpoint} -> ${response.status}`);
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    console.log("body가 JSON이 아니다.");
    return null;
  }
  const top = json as Record<string, unknown>;
  console.log(`최상위 칸: ${Object.keys(top ?? {}).join(", ")}`);
  const items = Array.isArray(top?.["models"])
    ? (top["models"] as unknown[])
    : [];
  const first = items[0] as Record<string, unknown> | undefined;
  console.log(
    `models 항목 ${items.length}개, 첫 항목 칸: ${Object.keys(first ?? {}).join(
      ", ",
    )}`,
  );
  const kinds = new Set(
    items.map((item) =>
      String((item as Record<string, unknown>)?.["visibility"]),
    ),
  );
  console.log(`visibility 값 종류: ${[...kinds].join(", ")}`);
  const names = parseReportedRoster(body)?.models ?? null;
  console.log(`파서가 보이는 것으로 읽은 model: ${names?.length ?? "null"}개`);
  return names;
}

const core = await bootLiveCore();
let code = 1;
try {
  code = await login(core);
} catch (error) {
  console.log(`실패: ${error instanceof Error ? error.message : error}`);
} finally {
  await core.stop();
}
process.exit(code);
