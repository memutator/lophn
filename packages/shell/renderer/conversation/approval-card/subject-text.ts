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
  switch (subject.kind) {
    case "shell":
      return t("conversation.title.approval-command", { agent });
    case "file_change":
      return t("conversation.title.approval-change", {
        agent,
        count: subject.changes.length,
      });
    default:
      return t("conversation.title.approval-run", {
        agent,
        tool: subject.tool,
      });
  }
}

const CHANGE_KINDS = {
  create: "conversation.label.approval-change-create",
  update: "conversation.label.approval-change-update",
  delete: "conversation.label.approval-change-delete",
} as const;

/** file 바꾸기 하나: 종류와 path, 줄 수를 아는 만큼. */
export function changeText(
  change: Extract<ApprovalSubject, { kind: "file_change" }>["changes"][number],
): string {
  const text = t(CHANGE_KINDS[change.change], { path: change.path });
  return change.added === null || change.removed === null
    ? text
    : t("conversation.label.approval-change-lines", {
        change: text,
        added: change.added,
        removed: change.removed,
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
      return subject.changes.map(changeText).join(", ");
  }
}

/** tool의 효과 글. shell과 file 바꾸기는 효과를 따로 말하지 않는다(대상이 바뀌는 것 자체다). */
export function effectOf(subject: ApprovalSubject): string | null {
  if (subject.kind === "shell" || subject.kind === "file_change") return null;
  return t(EFFECTS[subject.effect]);
}
