// lophn-agent의 정의 쪽(provider login, agent profile). 쓰기 앞 처리기가 두 곳이라
// wiring이 둘이다(assembly.ts의 순서가 접는 순서다).
import { ok } from "../../../../base/mod.ts";
import {
  profileImageRead,
  profileImageUpload,
} from "../../../../protocol/lophn-agent/mod.ts";
import { agentProfileHandlers } from "../../../lophn-agent/register.ts";
import { appCreate } from "../../../../protocol/apps/mod.ts";
import { ROLE_TABLE } from "../../../agent-roles/agents/role-table.ts";
import { withAppEngineer } from "../../../agent-roles/agents/app-engineer.ts";
import {
  ensureAppEngineer,
  ensureLophn,
} from "../../../agent-roles/agents/ensure.ts";
import type { AgentFileSystem } from "../../../lophn-agent/agents/ports.ts";
import { withProviderLogin } from "../../../lophn-agent/providers/login.ts";
import type { WiringFactory } from "./context.ts";

// 동기 file API는 core 프로세스의 module graph에 정적으로 두지 않는다. adapter는 URL로 연다.
const NODE_AGENT_FILES = new URL(
  "../../../lophn-agent/agents/adapters/node-fs.ts",
  import.meta.url,
).href;
const { createNodeAgentFiles } = await import(NODE_AGENT_FILES) as {
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
    const profiles = agentProfileHandlers(
      ctx.runtime.readers,
      ctx.root.path,
      ROLE_TABLE,
    );
    return ok({
      writer: (inner) =>
        withAppEngineer(
          inner,
          // 앱을 등록하면 그 앱의 App Engineer 정의 파일을 만든다.
          (app) => {
            ensureAppEngineer(
              { files: createNodeAgentFiles(), root: ctx.root.path },
              app,
            );
          },
          appCreate.name,
        ),
      // profile 이미지 올리기: agent는 reader가 보고 파일은 core가 비동기로 쓴다.
      uploads: [[
        `${profileImageUpload.resource}/${profileImageUpload.method}`,
        profiles.upload,
      ]],
      // 큰 파일을 core 메모리에 모으지 않고 창 단위로 흘리는 file route.
      // profile 이미지 읽기: 정의의 profile이 가리키는 파일을 실제 형식의 Content-Type으로 흘린다.
      fileStreams: [[
        `${profileImageRead.resource}/${profileImageRead.method}`,
        profiles.file,
      ]],
    });
  },
});

// OAuth 로그인도 writer queue 앞에서 listener와 network를 기다린다. login 세션은 처리기 메모리에만 있다.
export const lophnAgentProviderLoginWiring: WiringFactory = () => ({
  name: "lophn-agent-provider-login",
  build: () => ok({ writer: (inner) => withProviderLogin(inner) }),
});
