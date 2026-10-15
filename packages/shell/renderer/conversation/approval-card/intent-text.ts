// 승인 카드의 글. 대상, 정규화한 입력, 효과를 intent에서 program이 만든다(요청한 agent가 쓴 설명은 없다).
import { t } from "@lophn/wording";
import type { Intent } from "../../../../protocol/approvals/intent.ts";
import { shortId } from "../../desktop/connection/waiting/model.ts";

export interface ApprovalContent {
  /** 카드 제목. 누가 무엇을 하려는지. */
  readonly title: string;
  /** 결정 뒤 남는 줄이 가리키는 것. */
  readonly subject: string;
  readonly target: string;
  /** 정규화한 입력. */
  readonly input: string;
  readonly effect: string;
}

const SETTINGS = {
  instructions: "conversation.label.approval-settings-instructions",
  agent_definition: "conversation.label.approval-settings-agent-definition",
  skill: "conversation.label.approval-settings-skill",
  setting: "conversation.label.approval-settings-setting",
  grant: "conversation.label.approval-settings-grant",
} as const;

const EFFECTS = {
  read: "conversation.label.approval-effect-read",
  write: "conversation.label.approval-effect-write",
  external: "conversation.label.approval-effect-external",
} as const;

// 카드에 오는 것은 app-api, MCP tool, 설정 고치기다. 나머지는 물음이 나오지 않는다.
export function subjectOf(intent: Intent): { subject: string; target: string } {
  const target = intent.target;
  switch (target.kind) {
    case "app_api": {
      const app = t("conversation.label.approval-app", {
        id: shortId(target.app),
      });
      return {
        subject: target.api,
        target: t("conversation.label.approval-target-app-api", {
          app,
          api: target.api,
        }),
      };
    }
    case "mcp_tool":
      return {
        subject: target.tool,
        target: t("conversation.label.approval-target-mcp-tool", {
          server: target.server,
          tool: target.tool,
        }),
      };
    case "settings_edit": {
      const what = t(SETTINGS[target.what]);
      return { subject: what, target: what };
    }
    default: {
      const other = t("conversation.label.approval-target-other");
      return { subject: other, target: other };
    }
  }
}

export function contentOf(intent: Intent, agent: string): ApprovalContent {
  const { subject, target } = subjectOf(intent);
  return {
    title: intent.kind === "settings_edit"
      ? t("conversation.title.approval-change", { agent })
      : t("conversation.title.approval-run", { agent, tool: subject }),
    subject,
    target,
    input: JSON.stringify(intent.input, null, 2),
    effect: t(EFFECTS[intent.effect]),
  };
}
