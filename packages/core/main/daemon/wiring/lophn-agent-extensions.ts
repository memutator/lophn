import { ok } from "../../../../base/mod.ts";
import { randomSealedRef } from "../../../secrets/mod.ts";
import {
  createMcpOAuthVault,
  type McpOAuthVault,
} from "../../../lophn-agent/extensions/mod.ts";
import { createMcpAuthRequests } from "../../../lophn-agent/extensions/mcp-auth-requests.ts";
import {
  createMcpAuthControl,
  openMcpCallbackListener,
} from "../../../lophn-agent/extensions/mcp-auth-control.ts";
import { registeredMcpServers } from "../../../lophn-agent/extensions/mcp-snapshot.ts";
import type { McpAuthControl, WiringFactory } from "./context.ts";

export const lophnAgentExtensionsWiring: WiringFactory = () => {
  // MCP OAuth token 보관이다. 값은 OS keychain에만 있고, 보관이 가진 참조는 알려진 값 registry에
  // 올라 model로 가는 글과 저장할 글에서 지워진다.
  let vault: McpOAuthVault | undefined;
  let control: McpAuthControl | undefined;
  return {
    name: "lophn-agent-extensions",
    environment(ctx) {
      const created = createMcpOAuthVault({
        keychain: () => ctx.options.codingKeychain,
        randomRef: randomSealedRef,
      });
      vault = created;
      return { mcpOAuthRefs: () => created.refs() };
    },
    // MCP OAuth의 시작·완료·상태·취소 입구다. 업무 규칙은 extensions의 mcp-oauth에 있고
    // 여기는 core의 memory route 입구와 재료를 끼운다.
    // - verifier·state·token은 core 안에만 있다: 응답·ledger·event·log 어디에도 옮기지 않는다.
    // - token은 OS keychain(mcpVault)에만 두고 설정에는 쓰지 않는다. 서버(place와 이름)에서 정해지는 참조가 보관을 가리킨다.
    // core module graph에는 외부 fetch가 없다. 발급자(token endpoint) 호출은 대기열에 놓고 agent runtime이 가져가 대신
    // 보낸다(mcp-auth-requests.ts).
    build(ctx) {
      const requests = createMcpAuthRequests({
        newId: () => crypto.randomUUID(),
      });
      const created = createMcpAuthControl({
        fetch: requests.fetch,
        openListener: openMcpCallbackListener,
        registered: () => registeredMcpServers(ctx.ledgerPath),
        vault: vault!,
        nowMs: () => ctx.clock.nowMs(),
        syncSecrets: () => ctx.runtime.syncSecrets(),
      });
      control = created;
      ctx.provide("mcpAuthControl", created);
      // handler는 등록한 http 서버의 oauth2 인증 방식만 잡는다.
      return ok({ memory: [...created.handlers, ...requests.handlers] });
    },
    // 기다리는 MCP 로그인은 사람이 돌아오기를 기다리는 요청이라 서버 정지 전에 끝낸다.
    async closeIntake() {
      await control?.endAll();
    },
  };
};
