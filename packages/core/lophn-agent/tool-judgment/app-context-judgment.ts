import { err, ok, type Result } from "../../../base/mod.ts";
import type { AgentAppScope } from "../../../protocol/lophn-agent/mod.ts";
import {
  type AnnotateInput,
  appAnnotateTool,
  type AppContextState,
  appDefinitionHash,
  appScreenContextTool,
  grantFor,
  planAnnotation,
  planScreenRead,
  type ScreenContextInput,
} from "../tools/mod.ts";
import type { CallRef, ResolvedAction, ToolBinding } from "./work.ts";

// comparison은 JsonObject라 grant(readonly commands)를 JSON 값으로 옮긴다.
function grantJson(grant: NonNullable<ReturnType<typeof grantFor>>) {
  return {
    grant: grant.grant,
    commands: [...grant.commands],
    basis_seq: grant.basis_seq,
  };
}

// 앱 화면 context 읽기와 주석 되쓰기의 판정 근거(tool-judgment R12). 되쓰기도 일반 write 판정을 거친다:
// 판정표(`judge`)는 효과와 되돌림만 보고, 이 파일은 그 사실을 소유 계약에서 읽는다. 선언한 화면·주석 자리·
// write command, 지금의 허락, 현재 화면 revision 중 하나라도 맞지 않으면 err이고 호출은 approval 없이
// deny다. 일반 write처럼 되돌릴 수 있으면 묻지 않고(allow) 되돌릴 수 없으면 묻는다(ask).

export type ScreenProbe = {
  app: string;
  release: string;
  screen: string;
  view_session: string;
};

export type AppContextJudgmentPorts = {
  current(app: string): Promise<Result<AppContextState>>;
  // 이 view session의 지금 화면 revision이다. 매 호출마다 앱에 새로 묻는다(읽은 값을 재사용하지 않는다).
  // 닫혔거나 화면이 달라졌으면 null이다.
  currentRevision(
    probe: ScreenProbe,
    call: CallRef,
  ): Promise<Result<string | null>>;
};

const unavailable = () =>
  err({
    code: "not_found" as const,
    message: "the app command is not available",
  });

// 선언한 read command의 화면 조회다. 읽기라 현재 허락·선언 안이면 allow다.
export function createScreenContextBinding(
  scope: AgentAppScope,
  ports: Pick<AppContextJudgmentPorts, "current">,
): ToolBinding {
  return {
    async resolve(input): Promise<Result<ResolvedAction>> {
      const parsed = appScreenContextTool.input.safeParse(input);
      if (!parsed.success) return unavailable();
      const value = parsed.data as ScreenContextInput;
      const state = await ports.current(value.app);
      if (!state.ok) return unavailable();
      const plan = planScreenRead(scope, state.value, value);
      if (!plan.ok) return unavailable();
      const { view } = state.value;
      const hash = await appDefinitionHash(view, plan.value.command, false);
      return ok({
        concern: "apps/runtime",
        operation: "app.command",
        contractRevision: hash,
        targets: [{ id: value.app, reversibility: "reversible" }],
        comparison: {
          app: view.app,
          release: view.release,
          blueprint_hash: view.blueprint_hash,
          command: plan.value.command.key,
          screen: value.screen,
          view_session: value.view_session,
          definition_hash: hash,
          grant: grantJson(
            grantFor(state.value.grants, plan.value.command.key)!,
          ),
        },
        changes:
          `Reads the current screen ${value.screen} of app ${view.name} with the declared read command ${plan.value.command.key}.`,
        external: null,
        reversibility: "A read changes nothing.",
      });
    },
  };
}

// 선언한 write command로 주석 자리에 쓴다. 현재 화면 revision이 조회한 값과 같아야 한다.
export function createAnnotateBinding(
  scope: AgentAppScope,
  ports: AppContextJudgmentPorts,
): ToolBinding {
  return {
    async resolve(input, call: CallRef): Promise<Result<ResolvedAction>> {
      const parsed = appAnnotateTool.input.safeParse(input);
      if (!parsed.success) return unavailable();
      const value = parsed.data as AnnotateInput;
      const state = await ports.current(value.app);
      if (!state.ok) return unavailable();
      const plan = planAnnotation(scope, state.value, value);
      if (!plan.ok) return unavailable();
      const { view } = state.value;
      // 현재 화면 CAS. 읽지 못했거나 화면이 닫혔거나 revision이 달라졌으면 옛 화면에 쓰지 않는다.
      const revision = await ports.currentRevision({
        app: value.app,
        release: view.release,
        screen: value.screen,
        view_session: value.view_session,
      }, call);
      if (!revision.ok || revision.value !== value.expected_revision) {
        return unavailable();
      }
      const reversible = plan.value.counterpart !== null;
      const hash = await appDefinitionHash(
        view,
        plan.value.command,
        reversible,
      );
      return ok({
        concern: "apps/runtime",
        operation: "app.command",
        contractRevision: hash,
        targets: [{
          id: value.app,
          reversibility: reversible ? "reversible" : "irreversible",
        }],
        comparison: {
          app: view.app,
          release: view.release,
          blueprint_hash: view.blueprint_hash,
          command: plan.value.command.key,
          screen: value.screen,
          view_session: value.view_session,
          target: value.target,
          revision: value.expected_revision,
          definition_hash: hash,
          grant: grantJson(
            grantFor(state.value.grants, plan.value.command.key)!,
          ),
        },
        changes:
          `Writes a hint into the place ${value.target} of the screen ${value.screen} of app ${view.name} with the declared command ${plan.value.command.key}.`,
        external: null,
        reversibility: reversible
          ? `The app declares ${plan.value.counterpart} to revert it.`
          : "The app does not declare a way to revert it.",
      });
    },
  };
}
