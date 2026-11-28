// 승인 카드의 글. 제목, 결정 뒤 줄이 가리키는 대상, 효과를 subject에서 program이 만든다(요청한 agent가 쓴
// 설명은 없다). 지금 묻는 것은 shell 명령과 사람의 허락이 드는 설정 바꾸기이고, 앱 tool과 MCP tool은 사람이 묻기로 정할
// 때를 위해 그린다. 설정은 core가 만든 줄(이름과 전체 경로)을 줄이지 않고 그대로 보인다.
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
    case "plan":
      return t("conversation.title.approval-plan", { agent });
    case "setting":
      return t("conversation.title.approval-setting");
    case "project_command":
      return t("conversation.title.approval-project-command", {
        agent,
        name: subject.name,
      });
    case "project_command_definition": {
      const name = subject.after?.name ?? subject.before?.name ?? "";
      return subject.action === "add"
        ? t("conversation.title.approval-project-command-add", { agent, name })
        : subject.action === "update"
          ? t("conversation.title.approval-project-command-update", {
              agent,
              name,
            })
          : t("conversation.title.approval-project-command-remove", {
              agent,
              name,
            });
    }
    case "workflow_run": {
      return subject.mode === "one_off"
        ? t("conversation.title.approval-workflow-one-off", {
            agent,
            workflow: subject.workflow,
          })
        : subject.mode === "override"
          ? t("conversation.title.approval-workflow-override", {
              agent,
              workflow: subject.workflow,
            })
          : t("conversation.title.approval-workflow-override-code", {
              agent,
              workflow: subject.workflow,
            });
    }
    case "app_tool":
    case "mcp_tool":
      return t("conversation.title.approval-run", {
        agent,
        tool: subject.tool,
      });
    case "file_read":
      return t(
        subject.sensitive
          ? "conversation.title.approval-file-read-sensitive"
          : subject.outside_workspace
            ? "conversation.title.approval-file-read-outside"
            : "conversation.title.approval-file-read",
        { agent },
      );
    case "file_write":
      return t(
        subject.sensitive
          ? "conversation.title.approval-file-write-sensitive"
          : subject.outside_workspace
            ? "conversation.title.approval-file-write-outside"
            : "conversation.title.approval-file-write",
        { agent, action: subject.action },
      );
    case "local_tool":
      return t(
        subject.changed
          ? "conversation.title.approval-local-tool-changed"
          : "conversation.title.approval-local-tool",
        { agent, name: subject.name },
      );
    case "worktree_remove": {
      const target = subject.branch ?? subject.worktree;
      return t(
        subject.provenance === "adopted"
          ? "worktree.title.approval-untrack"
          : "worktree.title.approval-remove",
        { agent, name: target },
      );
    }
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

/** 결정 뒤 남는 줄이 가리키는 것. shell은 명령 그대로다. plan은 가리킬 것이 없어 비어 있다. */
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
    case "setting":
      return subject.lines.join(", ");
    case "project_command":
      return `${subject.name}: ${subject.command}`;
    case "project_command_definition": {
      const target = subject.after ?? subject.before;
      return target === null
        ? subject.action
        : `${subject.action} ${target.name}`;
    }
    case "workflow_run":
      return subject.lines.join(" · ");
    case "file_read":
    case "file_write":
      return subject.path;
    case "local_tool":
      return `${subject.name} (${subject.path})`;
    case "worktree_remove":
      return subject.branch !== null
        ? `${subject.branch} (${subject.path})`
        : subject.path;
    case "plan":
      return "";
  }
}

/** tool의 효과 글. shell, file·설정·project command·로컬 tool은 효과를 따로 말하지 않는다. */
export function effectOf(subject: ApprovalSubject): string | null {
  if (subject.kind !== "app_tool" && subject.kind !== "mcp_tool") {
    return null;
  }
  return t(EFFECTS[subject.effect]);
}
