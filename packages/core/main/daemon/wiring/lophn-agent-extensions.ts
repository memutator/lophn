import { err, ok } from "../../../../base/mod.ts";
import { BUNDLED_SKILLS_ROOT } from "../../../agent-workspaces/skills/root.ts";
import { PROJECT_LAYER } from "../../../agent-workspaces/workspace/project-layer.ts";
import { appSourcePath, sharedSkillFolders } from "../../../apps/lookups.ts";
import {
  createMcpAuthControl,
  openCallbackListener,
} from "../../../lophn-agent/extensions/mcp-auth-control.ts";
import { registeredMcpServers } from "../../../lophn-agent/extensions/mcp-snapshot.ts";
import { createMcpToolRequests } from "../../../lophn-agent/extensions/mcp-tool-requests.ts";
import {
  createMcpOAuthVault,
  createSkillCommandHandlers,
  skillFoldersSetting,
  skillsOffSetting,
} from "../../../lophn-agent/extensions/mod.ts";
import {
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import { workspaceDepsOf } from "../../../lophn-agent/workspaces/mod.ts";
import { projectFolderPaths } from "../../../projects/lookups.ts";
import { workspaceReadScopeOf } from "../workspace-folders-glue.ts";
import { readAgentMcp } from "./agent-mcp.ts";
import type { McpAuthControl, WiringFactory } from "./context.ts";
import { agentSkillAccess } from "./lophn-agent-team.ts";

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
          registeredMcpServers(ctx.ledgerPath, {
            projectLayer: PROJECT_LAYER,
            agents: () => readAgentMcp(ctx.ledgerPath),
          }),
        vault: createMcpOAuthVault({ secrets: ctx.secretStore }),
        secrets: ctx.secretStore,
        nowMs: () => ctx.clock.nowMs(),
      });
      control = created;
      ctx.provide("mcpAuthControl", created);
      // handler는 등록한 http 서버의 oauth2 인증 방식만 잡는다.
      // Grants의 MCP tool 목록 요청 대기열이다. runtime이 가져가 서버를 읽고 답한다(mcp-tool-requests.ts).
      const tools = createMcpToolRequests({ newId: () => crypto.randomUUID() });
      const skills = createSkillCommandHandlers({
        dataRoot: ctx.root.path,
        projectLayer: PROJECT_LAYER,
        bundledSkillsRoot: BUNDLED_SKILLS_ROOT,
        globalSettings: () => ({
          roots: ctx.settings.get(skillFoldersSetting) ?? [],
          off: ctx.settings.get(skillsOffSetting) ?? [],
        }),
        sessionInfo: (session) =>
          ledgerSnapshot(ctx.ledgerPath, (lookup) => {
            const row = loadSession(lookup, session);
            if (row === undefined) return null;
            const readScope = workspaceReadScopeOf(
              lookup,
              ctx.root.path,
              session,
            );
            if (readScope === undefined) return null;
            return {
              agent: row.agent,
              workspace: workspaceOf(row),
              readScope,
            };
          }),
        resolveProject: (ref) => {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            workspaceDepsOf(lookup.sql).projects.projectByName(ref),
          );
          if (!found.ok) return found;
          return found.value === null
            ? err({ code: "not_found", message: "project not found" })
            : ok({ kind: "project", id: found.value.id });
        },
        resolveApp: (ref) => {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            workspaceDepsOf(lookup.sql).apps.appByName(ref),
          );
          if (!found.ok) return found;
          return found.value.ok
            ? ok({ kind: "app", id: found.value.value.id })
            : found.value;
        },
        sourceFolder: (workspace) =>
          ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            workspace.kind === "project"
              ? (projectFolderPaths(lookup.sql, workspace.id)[0] ?? null)
              : appSourcePath(lookup.sql, workspace.id),
          ),
        agentOwn: (agent) =>
          ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            agentSkillAccess(lookup.sql, agent),
          ),
        sharedFolders: (apps) =>
          ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            sharedSkillFolders(lookup.sql, ctx.root.path, apps),
          ),
      });
      return ok({
        memory: [...created.handlers, ...tools.handlers, ...skills],
      });
    },
    // 기다리는 MCP 로그인은 사람이 돌아오기를 기다리는 요청이라 서버 정지 전에 끝낸다.
    async closeIntake() {
      await control?.endAll();
    },
  };
};
