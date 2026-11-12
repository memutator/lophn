import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  extensionToolsCall,
  extensionToolsCatalog,
  extensionToolsPublish,
  type PublishedExtension,
  parseExtensionToolName,
} from "../../../../protocol/lophn-agent/extension-tools.ts";
import { agentRead } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { workspaceSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import type { HostWorkspace } from "../../../../protocol/lophn-agent/host-queue.ts";
import type {
  AgentId,
  Workspace,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import {
  declareSetting,
  type SettingsReader,
} from "../../../../protocol/config/mod.ts";
import {
  extensionSettingKey,
  extensionToolModelName,
} from "../../../../protocol/extensions/manifest.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { z } from "zod";
import type { ExtensionGrant } from "../../../approvals/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { WiringFactory } from "./context.ts";
import { createHarnessCredentials } from "./harness-credential.ts";

// shell extension의 tool 목록(메모리)과 호출 입구다. 흐름은 `protocol/lophn-agent/extension-tools.ts`.
// shell main이 판이 맞는 manifest의 tool을 통째로 올리고(`publish`), 켜진 것만 `catalog`로 나간다. core가 다시 뜨면 비고
// shell이 다시 올린다. 호출은 Gate `extension_tool`을 판정한 뒤 이 호출만 쓰는 agent 자격을 내고 host queue로 shell main의
// handler에 넘긴다.
const PRINCIPAL = "machine:extension-tools";
const CONTEXT: AuthenticatedContext = {
  principal: PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [workspaceSessionRead.name, agentRead.name],
    targets: {},
  },
  conditions: {},
  credential_ref: PRINCIPAL,
};
const EXTENSION_PROCESS = "extension";
// 부른 쪽이 shell이 떨어졌는지 보는 간격이다.
const WATCH_MS = 1000;

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// 값을 읽는 손잡이다. 설정으로 올리는 선언은 config의 shell-settings에 있다.
const enabledSetting = (id: string) =>
  declareSetting({
    key: extensionSettingKey(id),
    type: z.boolean(),
    default: false,
    description: `Turns on the ${id} extension.`,
  });

const forbidden = (message: string) =>
  err({ code: "forbidden" as const, message });

export const extensionToolsWiring: WiringFactory = () => {
  let published: readonly PublishedExtension[] = [];
  const inflight = new Set<() => void>();
  return {
    name: "extension-tools",
    records: () => [CONTEXT],
    build(ctx) {
      const credentials = createHarnessCredentials({
        registry: ctx.registry,
        record: (context) => ctx.runtime.record(context),
      });
      const enabledCatalog = (settings: SettingsReader) =>
        published.filter(
          (extension) => settings.get(enabledSetting(extension.id)) === true,
        );
      const read = async <T>(
        route: { resource: string; method: string },
        input: unknown,
      ): Promise<Result<T>> =>
        (await ctx.runtime.readers.read(route, CONTEXT, input)) as Result<T>;

      // Gate가 보는 재료: 그 agent 정의의 `extensions`와 켜진 extension의 tool.
      ctx.approvals.useExtensions(async (agent: AgentId) => {
        const defined = await read<{
          definition: { extensions?: string[] } | null;
        }>(agentRead, { agent });
        if (!defined.ok) return defined;
        const catalog = enabledCatalog(ctx.settings);
        return ok<ExtensionGrant>({
          assigned: defined.value.definition?.extensions ?? [],
          has: (extension, tool) =>
            catalog.some(
              (one) =>
                one.id === extension &&
                one.tools.some((entry) => entry.name === tool),
            ),
        });
      });

      const publish: MemoryHandler = (who, body) => {
        if (who.actor !== "user") return forbidden("only the shell host");
        published = extensionToolsPublish.input.parse(body).extensions;
        return ok({});
      };
      const catalog: MemoryHandler = (who) => {
        if (who.actor !== "user" && who.actor !== "machine") {
          return forbidden("only the shell host or the runtime");
        }
        return ok({ extensions: enabledCatalog(ctx.settings) });
      };

      const call: MemoryHandler = async (who, body) => {
        const session = who.conditions.session;
        const turn = who.conditions.turn;
        if (
          // agent 자격의 actor는 `agent:<session>`이다.
          !who.actor.startsWith("agent:") ||
          session === undefined ||
          turn === undefined
        ) {
          return forbidden("only an agent session");
        }
        const input = extensionToolsCall.input.parse(body);
        // 이름으로 extension과 tool을 가른다. 목록에 없어도 판정이 not_assigned·removed로 이유를 대야 해서 parse한다.
        const named = parseExtensionToolName(input.name);
        if (named === null) {
          return err({
            code: "not_found" as const,
            message: "not an extension tool",
          });
        }
        const found = await read<{
          session: { agent: AgentId; workspace: Workspace | null };
        }>(workspaceSessionRead, { session });
        if (!found.ok) return found;
        const { agent, workspace } = found.value.session;
        const judged = await ctx.approvals.judge(
          {
            kind: "extension_tool",
            extension: named.extension,
            tool: named.tool,
          },
          // 묻지 않는 호출이라 mode와 toParent를 보지 않는다.
          { agent, session, workspace, mode: "attended", toParent: false },
        );
        if (!judged.ok) return judged;
        if (judged.value.kind !== "run") {
          return forbidden(
            judged.value.kind === "deny" && judged.value.reason === "removed"
              ? "the extension tool is not available"
              : "the extension is not assigned to this agent",
          );
        }
        if (!ctx.hostQueue.attached()) {
          return err({
            code: "unavailable" as const,
            message: "the shell is not attached",
          });
        }
        // 이 호출만 쓰는 agent 자격이다. 상한은 그 workspace 종류의 `lophn` 명령 route라 사람 전용 route는 닿지 않는다.
        // 사람 token(`ctx.coreInternal`)을 넘기지 않는다.
        const credential = await credentials.lease({
          session,
          turn,
          workspace,
          process: EXTENSION_PROCESS,
        });
        if (!credential.ok) return credential;
        const hostWorkspace: HostWorkspace =
          workspace === null ? { kind: "home" } : workspace;
        const sent = ctx.hostQueue.callTool({
          extension: named.extension,
          tool: named.tool,
          input: input.input,
          session: session as never,
          workspace: hostWorkspace,
          credential: credential.value.token,
        });
        const abandon = () => ctx.hostQueue.abandon(sent.id);
        inflight.add(abandon);
        // 기다리는 동안 shell이 떨어지면 끝내고, 붙어 있으면 기한이 지난 호출을 거둔다.
        const watch = setInterval(() => {
          if (!ctx.hostQueue.attached()) abandon();
          else ctx.hostQueue.expire();
        }, WATCH_MS);
        try {
          const result = await sent.result;
          return result.ok ? ok({ content: result.value }) : result;
        } finally {
          clearInterval(watch);
          inflight.delete(abandon);
          credentials.release(credential.value.ref);
        }
      };

      return ok({
        memory: [
          [key(extensionToolsPublish), publish],
          [key(extensionToolsCatalog), catalog],
          [key(extensionToolsCall), call],
        ],
      });
    },
    // 기다리는 호출은 서버가 멈추기 전에 끝낸다.
    closeIntake() {
      for (const abandon of [...inflight]) abandon();
    },
  };
};
