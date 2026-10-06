import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AppBlueprintView,
  appDefinitionHash,
  type AppGrant,
  type AppTool,
  commandInputOf,
  grantFor,
  revertCounterpart,
} from "../tools/mod.ts";
import {
  canonicalInputHash,
  invocationAcceptConfirm,
} from "../../../contracts/apps/mod.ts";
import type { InputSchema } from "../../../contracts/apps/mod.ts";
import type { CallRef, ResolvedAction, ToolBinding } from "./work.ts";

// 앱 command의 판정 근거(tool-judgment R10, R11). 판정표(`judge`)는 효과·confirm·되돌림만 보고 이 파일은
// 그 사실을 소유 계약에서 읽는다: 지금의 active release blueprint(효과·confirm·되돌리기 선언과 대응
// command)와 지금의 agent.commands 허락. model의 설명·undo 문구는 어느 칸에도 들어오지 않는다.

export type AppJudgmentPorts = {
  // 앱의 지금 active release blueprint와 현재 허락. 범위 밖·없는 앱·release 없는 앱은 같은 not_found다.
  current(
    app: string,
  ): Promise<
    Result<{ view: AppBlueprintView; grants: readonly AppGrant[] }>
  >;
  // 지금 live 앱 process의 nonce. confirm 접수가 묶는 값이라 앱이 다시 뜨면 달라진다.
  nonce(
    app: string,
    command: string,
    call: CallRef,
  ): Promise<Result<string>>;
};

const unavailable = () =>
  err({
    code: "not_found" as const,
    message: "the app command is not available",
  });

// 앱 command tool 하나의 소유 계약 연결이다. 정의가 만들어진 선언과 지금의 선언이 하나라도 다르면(release
// 교체·입력·effect·confirm·되돌리기 변경) 또는 허락이 회수됐으면 err이고 호출은 deny다(R6, tools R17).
export function createAppBinding(
  tool: AppTool,
  ports: AppJudgmentPorts,
): ToolBinding {
  return {
    async resolve(input, call): Promise<Result<ResolvedAction>> {
      const state = await ports.current(tool.app);
      if (!state.ok) return unavailable();
      const { view, grants } = state.value;
      const command = view.commands.find((entry) => entry.key === tool.command);
      if (command === undefined) return unavailable();
      const counterpart = revertCounterpart(view.commands, command);
      const hash = await appDefinitionHash(view, command, counterpart !== null);
      if (hash !== tool.definitionHash) return unavailable();
      const grant = grantFor(grants, tool.command);
      if (grant === undefined) return unavailable();

      const reversible = counterpart !== null;
      const base: ResolvedAction = {
        concern: "apps/runtime",
        operation: "app.command",
        contractRevision: hash,
        targets: [{
          id: tool.app,
          reversibility: reversible ? "reversible" : "irreversible",
        }],
        comparison: {
          app: view.app,
          release: view.release,
          blueprint_hash: view.blueprint_hash,
          command: tool.command,
          definition_hash: hash,
          grant,
        },
        changes: command.effect === "read"
          ? `Runs the read command ${tool.command} of app ${view.name}.`
          : `Runs the command ${tool.command} of app ${view.name} with this input once.`,
        external: command.effect === "external"
          ? `Command ${tool.command} changes something outside lophn.`
          : null,
        reversibility: reversible
          ? `The app declares ${counterpart} to revert it.`
          : "The app does not declare a way to revert it.",
      };
      if (!command.confirm) return ok(base);

      // confirm은 사람의 정확한 approval을 접수와 함께 쓴다. approval request의 동작이 접수 command라
      // 사전 질문과 앱의 confirm이 approval 하나다.
      const nonce = await ports.nonce(tool.app, tool.command, call);
      if (!nonce.ok) return unavailable();
      const hashed = await canonicalInputHash(
        command.input as InputSchema | null,
        commandInputOf(tool, input),
      );
      if (!hashed.ok) return unavailable();
      return ok({
        ...base,
        concern: "apps/invocations",
        operation: invocationAcceptConfirm.name,
        confirm: {
          app: view.app,
          release: view.release,
          command: tool.command,
          input_hash: hashed.value,
          key: `${call.toolCall}:confirm`,
          process_nonce: nonce.value,
          caller: { kind: "agent", run: call.run, tool_call: call.toolCall },
        },
      });
    },
  };
}
