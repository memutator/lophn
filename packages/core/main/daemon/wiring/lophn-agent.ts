// lophn-agent의 정의 쪽(provider login, agent profile). 쓰기 앞 처리기가 두 곳이라
// wiring이 둘이다(assembly.ts의 순서가 접는 순서다).
import { z } from "zod";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import { publishStateChanged } from "../../../../protocol/events/changes.ts";
import {
  agentProfileImageRead,
  agentProfileImageUpload,
  instructionsReadGlobal,
  instructionsWriteGlobal,
  messageImagePath,
  messageImagePrepare,
  messageImageRead,
  messageImageUpload,
  providerConnectKey,
  providerConnectLocal,
  providerDefinitionSchema,
  providerList,
  providerProtocolSchema,
  providerRead,
  type ProviderRecord,
  providerSignIn,
  providerSignInState,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  agentProfileHandlers,
  messageImageHandlers,
} from "../../../lophn-agent/register.ts";
import { createGlobalInstructionsHandlers } from "../../../lophn-agent/instructions/global.ts";
import { imageReferenced } from "../../../lophn-agent/session/message-images.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import { withProviderLogin } from "../../../lophn-agent/providers/login.ts";
import { isStagedSecretName } from "../../../lophn-agent/providers/oauth-secrets.ts";
import {
  builtinTarget,
  TEST_PROVIDER_TARGETS,
  type ConnectTarget,
  type ConnectWay,
  createProviderConnect,
} from "../../../lophn-agent/providers/connect-key.ts";
import { opencodeGoMergeStep } from "./opencode-go-merge.ts";
import { withProviderModelList } from "../../../lophn-agent/providers/model-list.ts";
import { createIssuerRequests } from "../../../lophn-agent/issuer-requests.ts";
import { openCallbackListener } from "../../../lophn-agent/extensions/mcp-auth-control.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { WiringFactory } from "./context.ts";

const PAGE_LIMIT = 20;
const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// e2e가 fake 발급자·fake model server로 로그인을 돌리는 길이다: 정의 key를 이 연결 대상으로 바꾼다(TEST_PROVIDER_TARGETS).
// 사람의 기동에는 없다.
const testTargetsSchema = z.record(
  z.string(),
  z.strictObject({
    definition: providerDefinitionSchema,
    endpoint: z.string(),
    protocol: providerProtocolSchema,
  }),
);

// 틀린 값이면 log 한 줄을 남기고 가짜 대상 없이 돈다. 기동을 막지 않는다.
function targetsFrom(
  raw: string | undefined,
  wrong: () => void,
): (key: string, way: ConnectWay) => Result<ConnectTarget> {
  let fakes: z.infer<typeof testTargetsSchema> = {};
  if (raw !== undefined) {
    let parsed: ReturnType<typeof testTargetsSchema.safeParse> | undefined;
    try {
      parsed = testTargetsSchema.safeParse(JSON.parse(raw));
    } catch {
      parsed = undefined;
    }
    if (parsed?.success === true) fakes = parsed.data;
    else wrong();
  }
  return (key, way) => {
    const fake = fakes[key];
    return fake === undefined
      ? builtinTarget(key, way)
      : ok({ name: fake.definition.display_name, ...fake });
  };
}

export const lophnAgentWiring: WiringFactory = () => ({
  name: "lophn-agent",
  build(ctx) {
    const profiles = agentProfileHandlers(ctx.runtime.readers, ctx.root.path);
    const globalInstructions = createGlobalInstructionsHandlers(
      ctx.root.path,
      ctx.random,
    );
    const images = messageImageHandlers(ctx.root.path, {
      relay: () => ctx.bodyPrepare,
      referenced: (session, blob) =>
        ledgerSnapshot(ctx.ledgerPath, ({ sql }) =>
          imageReferenced(sql, session, blob),
        ),
    });
    return ok({
      // 받은 이미지 풀이(image block의 hash, image.read의 `attachment:<id>`): agent가 자기 session의 이미지만 푼다.
      // 이미지 올리기: agent는 바이트를 JSON으로 싣고 blob 준비는 core가 한다.
      // 전역 지침(LOPHN.md): 이 컴퓨터와 다른 컴퓨터의 Settings › Agents가 같이 쓴다.
      memory: [
        [key(instructionsReadGlobal), () => globalInstructions.read()],
        [
          key(instructionsWriteGlobal),
          (_who, input) =>
            globalInstructions.write(
              input as { text: string; base_hash: string | null },
            ),
        ],
        [key(messageImagePath), images.path],
        [key(messageImagePrepare), images.prepare],
      ],
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
    dataSteps: [opencodeGoMergeStep],
    async build(ctx) {
      // 연결 중에 core가 죽어 남은 임시 key(`provider.<id>.new.<꼬리>`)를 치운다. API가 열리기 전이라 진행 중인 연결의 것을
      // 지우지 않는다(secrets wiring이 먼저 저장소를 연다). 못 지운 이름은 log에 남기고 기동은 잇는다.
      const names = ctx.secretStore.names();
      for (const name of names.ok
        ? names.value.filter(isStagedSecretName)
        : []) {
        const removed = await ctx.secretStore.delete(name);
        if (!removed.ok) {
          ctx.telemetry.logger.warn({
            component: "lophn-agent/providers",
            event: "staged_key_left",
            fields: { name },
          });
        }
      }
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const requests = createIssuerRequests({
        newId: () => ids.newId("irq"),
      });
      ctx.provide("issuerRequests", requests);
      const readProviders = async (
        who: AuthenticatedContext,
      ): Promise<Result<ProviderRecord[]>> => {
        const rows: ProviderRecord[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < PAGE_LIMIT; page += 1) {
          const read = await ctx.runtime.readers.read(
            providerList,
            who,
            cursor === undefined ? {} : { cursor },
          );
          if (!read.ok) return read;
          const value = read.value as {
            providers: ProviderRecord[];
            next_cursor: string | null;
          };
          rows.push(...value.providers);
          if (value.next_cursor === null) break;
          cursor = value.next_cursor;
        }
        return ok(rows);
      };
      const target = targetsFrom(process.env[TEST_PROVIDER_TARGETS], () =>
        ctx.telemetry.logger.warn({
          component: "lophn-agent/providers",
          event: "test_targets_ignored",
          message: `${TEST_PROVIDER_TARGETS} is not valid; using the built-in targets`,
        }),
      );
      // 접은 writer로 보낸다: 임시 key를 옮기는 이 처리기(login)와 commit 뒤 층을 사람이 낸 command와 똑같이 지난다.
      const connect = createProviderConnect({
        writer: () => ctx.writer,
        secrets: ctx.secretStore,
        listProviders: readProviders,
        target,
        newId: () => ids.newId("pvd"),
        newKey: () => ids.newId("idk"),
        tail: () => ids.newId("stg").slice("stg_".length),
      });
      // agent의 provider 요청도 같은 id를 받는다: 끊은 정의를 다시 이으면 같은 id다.
      ctx.provide("providerFreshId", connect.freshId);
      let login: ReturnType<typeof withProviderLogin> | undefined;
      const readProvider = async (
        who: AuthenticatedContext,
        provider: string,
      ): Promise<Result<ProviderRecord | null>> => {
        const read = await ctx.runtime.readers.read(providerRead, who, {
          provider,
        });
        if (read.ok) {
          return ok((read.value as { provider: ProviderRecord }).provider);
        }
        return read.error.code === "not_found" ? ok(null) : read;
      };
      // writer를 접기 전에는 부르지 못한다(API가 그 뒤에 열린다).
      const unready = (): Result<never> =>
        err({ code: "unavailable", message: "provider login is not ready" });
      return ok({
        writer: (inner) => {
          login = withProviderLogin(inner, {
            http: requests.fetch,
            openListener: openCallbackListener,
            secrets: ctx.secretStore,
            newKey: () => ids.newId("idk"),
            nowMs: () => ctx.clock.nowMs(),
            random: ctx.random,
            target,
            freshId: connect.freshId,
            readProvider,
            rememberId: connect.remember,
            requests: ctx.questionWaits,
            granted: (principal) =>
              ctx.peek.terminalInputGrant?.(principal) ?? false,
            changed: (provider) =>
              publishStateChanged(ctx.bus, ctx.clock.now(), [
                { name: "providers", id: provider },
              ]),
          });
          ending = login.endAll;
          // custom provider의 model 목록 읽기. login 바깥에 있어 ChatGPT 연결은 거치지 않는다.
          return withProviderModelList(login, {
            http: requests.fetch,
            secrets: ctx.secretStore,
            readProvider,
            newKey: () => ids.newId("idk"),
          });
        },
        memory: [
          ...requests.handlers,
          [key(providerConnectLocal), connect.handlers.connectLocal],
          [
            key(providerSignIn),
            ((who, input) =>
              login?.signIn(who, input) ?? unready()) satisfies MemoryHandler,
          ],
          [
            key(providerSignInState),
            ((_who, input) =>
              login?.signInState(input) ?? unready()) satisfies MemoryHandler,
          ],
        ],
        uploads: [[key(providerConnectKey), connect.handlers.connectKey]],
      });
    },
    // 기다리는 로그인의 callback listener를 서버 정지 전에 닫는다.
    async closeIntake() {
      await ending?.();
    },
  };
};
