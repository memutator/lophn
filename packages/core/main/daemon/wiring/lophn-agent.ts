// lophn-agent의 정의 쪽(provider login, agent profile). 쓰기 앞 처리기가 두 곳이라
// wiring이 둘이다(assembly.ts의 순서가 접는 순서다).
import { createIdSource, ok } from "../../../../base/mod.ts";
import {
  agentProfileImageRead,
  agentProfileImageUpload,
  messageImagePath,
  messageImageRead,
  messageImageUpload,
  providerRead,
  type ProviderRecord,
} from "../../../../protocol/lophn-agent/mod.ts";
import {
  agentProfileHandlers,
  messageImageHandlers,
} from "../../../lophn-agent/register.ts";
import { ensureLophn } from "../../../agent-places/agents/ensure.ts";
import type { AgentFileSystem } from "../../../lophn-agent/agents/ports.ts";
import { withProviderLogin } from "../../../lophn-agent/providers/login.ts";
import { withProviderModelList } from "../../../lophn-agent/providers/model-list.ts";
import { createIssuerRequests } from "../../../lophn-agent/issuer-requests.ts";
import { openCallbackListener } from "../../../lophn-agent/extensions/mcp-auth-control.ts";
import type { WiringFactory } from "./context.ts";

// 동기 file API는 core 프로세스의 module graph에 정적으로 두지 않는다. adapter는 URL로 연다.
const NODE_AGENT_FILES = new URL(
  "../../../lophn-agent/agents/adapters/node-fs.ts",
  import.meta.url,
).href;
const { createNodeAgentFiles } = (await import(NODE_AGENT_FILES)) as {
  createNodeAgentFiles(): AgentFileSystem;
};

export const lophnAgentWiring: WiringFactory = () => ({
  name: "lophn-agent",
  // 첫 기동 때 lophn 정의 파일이 없으면 만든다. 이미 있으면 그대로다.
  start(ctx) {
    return Promise.resolve(
      ensureLophn({ files: createNodeAgentFiles(), root: ctx.root.path }),
    );
  },
  build(ctx) {
    const profiles = agentProfileHandlers(ctx.runtime.readers, ctx.root.path);
    const images = messageImageHandlers(
      ctx.runtime.readers,
      ctx.root.path,
      createIdSource({ clock: ctx.clock, random: ctx.random }),
    );
    const key = (route: { resource: string; method: string }) =>
      `${route.resource}/${route.method}`;
    return ok({
      // image.read의 `attachment:<id>` 풀이: agent가 자기 session의 이미지만 푼다.
      memory: [[key(messageImagePath), images.path]],
      // profile 이미지 올리기: agent는 reader가 보고 파일은 core가 비동기로 쓴다.
      uploads: [
        [key(agentProfileImageUpload), profiles.upload],
        [key(messageImageUpload), images.upload],
      ],
      // 큰 파일을 core 메모리에 모으지 않고 창 단위로 흘리는 file route.
      // profile 이미지 읽기: 정의의 profile이 가리키는 파일을 실제 형식의 Content-Type으로 흘린다.
      fileStreams: [
        [key(agentProfileImageRead), profiles.file],
        [key(messageImageRead), images.file],
      ],
    });
  },
});

// 구독 OAuth 로그인은 writer queue 앞에서 listener와 발급자 network를 다룬다. login 세션은 처리기 메모리에만 있다.
// 발급자 요청 대기열을 여기서 만든다: MCP OAuth(extensions wiring)와 provider 갱신(runtime wiring)이 뒤에서
// 같이 쓴다. core에는 외부 fetch가 없어 agent runtime이 machine 입구로 가져가 대신 보낸다.
export const lophnAgentProviderLoginWiring: WiringFactory = () => {
  let ending: (() => Promise<void>) | undefined;
  return {
    name: "lophn-agent-provider-login",
    build(ctx) {
      const requests = createIssuerRequests({
        newId: () => crypto.randomUUID(),
      });
      ctx.provide("issuerRequests", requests);
      return ok({
        writer: (inner) => {
          const login = withProviderLogin(inner, {
            http: requests.fetch,
            openListener: openCallbackListener,
            secrets: ctx.secretStore,
            newKey: () => crypto.randomUUID(),
            nowMs: () => ctx.clock.nowMs(),
            random: ctx.random,
          });
          ending = login.endAll;
          // custom provider의 model 목록 읽기. login 바깥에 있어 ChatGPT 연결은 거치지 않는다.
          return withProviderModelList(login, {
            http: requests.fetch,
            secrets: ctx.secretStore,
            async readProvider(who, provider) {
              const read = await ctx.runtime.readers.read(providerRead, who, {
                provider,
              });
              if (read.ok) {
                return ok(
                  (read.value as { provider: ProviderRecord }).provider,
                );
              }
              return read.error.code === "not_found" ? ok(null) : read;
            },
            newKey: () => crypto.randomUUID(),
          });
        },
        memory: [...requests.handlers],
      });
    },
    // 기다리는 로그인의 callback listener를 서버 정지 전에 닫는다.
    async closeIntake() {
      await ending?.();
    },
  };
};
