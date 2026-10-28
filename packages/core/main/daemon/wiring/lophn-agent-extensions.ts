import { ok } from "../../../../base/mod.ts";
import { createMcpOAuthVault } from "../../../lophn-agent/extensions/mod.ts";
import { createMcpToolRequests } from "../../../lophn-agent/extensions/mcp-tool-requests.ts";
import {
  createMcpAuthControl,
  openCallbackListener,
} from "../../../lophn-agent/extensions/mcp-auth-control.ts";
import { registeredMcpServers } from "../../../lophn-agent/extensions/mcp-snapshot.ts";
import { PROJECT_LAYER } from "../../../agent-places/place/project-layer.ts";
import type { McpAuthControl, WiringFactory } from "./context.ts";

export const lophnAgentExtensionsWiring: WiringFactory = () => {
  let control: McpAuthControl | undefined;
  return {
    name: "lophn-agent-extensions",
    // MCP OAuth의 시작·완료·상태·취소 입구다. 업무 규칙은 extensions의 mcp-oauth에 있고
    // 여기는 core의 memory route 입구와 재료를 끼운다.
    // - verifier·state·token은 core 안에만 있다: 응답·ledger·event·log 어디에도 옮기지 않는다.
    // - token은 `secrets.json`의 서버 몫 `mcp-oauth.` 이름에만 두고 설정에는 쓰지 않는다. secret store가 값을 알려진
    //   값으로 올려 model로 가는 글과 저장할 글에서 지운다.
    // core module graph에는 외부 fetch가 없다. 발급자(token endpoint) 호출은 provider 로그인 wiring이 낸 대기열에
    // 놓고 agent runtime이 가져가 대신 보낸다(issuer-requests.ts).
    build(ctx) {
      const created = createMcpAuthControl({
        fetch: ctx.issuerRequests.fetch,
        openListener: openCallbackListener,
        registered: () =>
          registeredMcpServers(ctx.ledgerPath, { projectLayer: PROJECT_LAYER }),
        vault: createMcpOAuthVault({ secrets: ctx.secretStore }),
        nowMs: () => ctx.clock.nowMs(),
      });
      control = created;
      ctx.provide("mcpAuthControl", created);
      // handler는 등록한 http 서버의 oauth2 인증 방식만 잡는다.
      // Grants의 MCP tool 목록 요청 대기열이다. runtime이 가져가 서버를 읽고 답한다(mcp-tool-requests.ts).
      const tools = createMcpToolRequests({ newId: () => crypto.randomUUID() });
      return ok({
        memory: [...created.handlers, ...tools.handlers],
      });
    },
    // 기다리는 MCP 로그인은 사람이 돌아오기를 기다리는 요청이라 서버 정지 전에 끝낸다.
    async closeIntake() {
      await control?.endAll();
    },
  };
};
