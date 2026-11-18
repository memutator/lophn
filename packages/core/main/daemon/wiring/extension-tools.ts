import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  extensionToolsCall,
  extensionToolsCatalog,
  extensionToolsPublish,
  parseExtensionToolName,
} from "../../../../protocol/lophn-agent/extension-tools.ts";
import { agentRead } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { workspaceSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import type {
  AgentId,
  Workspace,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import {
  declareSetting,
  type SettingsReader,
} from "../../../../protocol/config/mod.ts";
import { extensionSettingKey } from "../../../../protocol/extensions/manifest.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { z } from "zod";
import type { ExtensionGrant } from "../../../approvals/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { WiringFactory } from "./context.ts";
import { createHarnessCredentials } from "./harness-credential.ts";

// extension tool의 목록과 호출 입구다. 흐름은 `protocol/lophn-agent/extension-tools.ts`.
// 목록은 core 안 extension host가 읽은 판이 맞는 manifest의 tool이고 켜진 것만 `catalog`로 나간다. 호출은 Gate
// `extension_tool`을 판정한 뒤 이 호출만 쓰는 agent 자격을 내고 extension host의 handler를 바로 부른다.
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
  return {
    name: "extension-tools",
    records: () => [CONTEXT],
    build(ctx) {
      const credentials = createHarnessCredentials({
        registry: ctx.registry,
        record: (context) => ctx.runtime.record(context),
      });
      const enabledCatalog = (settings: SettingsReader) =>
        ctx.extensionHost
          .catalog()
          .filter(
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

      // 부르는 쪽이 없다(`extension_tools/publish` route가 지워질 때 같이 지운다). 목록은 extension host가 쥔다.
      const publish: MemoryHandler = (who) =>
        who.actor === "user" ? ok({}) : forbidden("only the shell host");
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
        // 이 호출만 쓰는 agent 자격이다. 상한은 그 workspace 종류의 `lophn` 명령 route라 사람 전용 route는 닿지 않는다.
        // 사람 권한의 core 안 자격을 넘기지 않는다.
        const credential = await credentials.lease({
          session,
          turn,
          workspace,
          process: EXTENSION_PROCESS,
        });
        if (!credential.ok) return credential;
        try {
          const result = await ctx.extensionHost.callTool(
            named.extension,
            named.tool,
            input.input,
            {
              session,
              workspace: workspace === null ? { kind: "home" } : workspace,
              credential: credential.value.token,
            },
          );
          if (!result.ok) return result;
          // 모양이 틀린 결과를 agent에 넘기지 않는다.
          const output = extensionToolsCall.output.safeParse({
            content: result.value,
          });
          return output.success
            ? ok(output.data)
            : err({
                code: "internal" as const,
                message: "the extension returned an invalid result",
              });
        } finally {
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
  };
};
