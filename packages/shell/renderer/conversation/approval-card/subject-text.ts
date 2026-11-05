// 승인 카드의 글. 제목, 결정 뒤 줄이 가리키는 대상, 효과를 subject에서 program이 만든다(요청한 agent가 쓴
// 설명은 없다). 지금 묻는 것은 shell 명령이고, 앱 tool과 MCP tool은 사람이 묻기로 정할 때를 위해 그린다.
import { t } from "@lophn/i18n";
import { shortId } from "../../desktop/connection/waiting/model.ts";
import type { ApprovalSubject } from "../agent-tab-source.ts";

const EFFECTS = {
  read: "conversation.label.approval-effect-read",
  write: "conversation.label.approval-effect-write",
  external: "conversation.label.approval-effect-external",
} as const;

/** 카드 제목. 누가 무엇을 하려는지. */
export function titleOf(subject: ApprovalSubject, agent: string): string {
  return subject.kind === "shell"
    ? t("conversation.title.approval-command", { agent })
    : t("conversation.title.approval-run", {
        agent,
        tool: subject.kind === "file_change" ? targetOf(subject) : subject.tool,
      });
}

/** 결정 뒤 남는 줄이 가리키는 것. shell은 명령 그대로다. */
export function targetOf(subject: ApprovalSubject): string {
  switch (subject.kind) {
    case "shell":
      return subject.command;
    case "app_tool":
      return t("conversation.label.approval-target-tool", {
        app: t("conversation.label.approval-app", {
          id: shortId(subject.app),
        }),
        tool: subject.tool,
      });
    case "mcp_tool":
      return t("conversation.label.approval-target-mcp-tool", {
        server: subject.server,
        tool: subject.tool,
      });
    case "file_change":
      return subject.changes.map((change) => change.path).join(", ");
  }
}

/** tool의 효과 글. shell은 효과를 말하지 않는다. */
export function effectOf(subject: ApprovalSubject): string | null {
  if (subject.kind === "shell") return null;
  return t(EFFECTS[subject.kind === "file_change" ? "write" : subject.effect]);
}
