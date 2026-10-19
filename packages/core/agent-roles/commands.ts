import type { CommandEntry, Role } from "../../protocol/lophn-agent/mod.ts";

// role 명령이 사람의 메시지로 접수하는 prompt template.
// 사람이 입력창에서 직접 쓴 글처럼 접수되므로 사람이 말하는 투로 쓴다. `/이름` 뒤에 사람이
// 쓴 글(인자)은 접수할 때 이 글 뒤에 붙는다.

export const NEW_APP_PROMPT =
  "I want to start a new app. Ask me what it should do and who it is for, one question at a time. Then decide with me which project it belongs in, and set it up with me.";

export const REPAIR_APP_PROMPT =
  "Something broke in one of my apps. Find out which app and what went wrong, look at what happened, and fix it. Tell me what you found before you change anything.";

export const CHECK_KINDS_PROMPT =
  "Run kind.check for this project. For each violation, say whether the kinds file or the document is wrong and what you would change. Do not edit the documents.";

function promptCommand(
  name: string,
  title: string,
  description: string,
  template: string,
): CommandEntry {
  return {
    name,
    title,
    description,
    source: "role",
    skill_origin: null,
    while_running: "queue",
    action: { kind: "prompt", template },
  };
}

// role 명령은 role마다의 목록 하나다. protocol의 ROLE_COMMAND_NAMES와 같아야 한다.
// lophn은 New app · Repair app, Project Manager는 Check kinds, App Engineer와 Operator는 빈 목록이다.
export const ROLE_COMMANDS: Record<Role, readonly CommandEntry[]> = {
  lophn: [
    promptCommand(
      "new-app",
      "New app",
      "Start a new app in this project",
      NEW_APP_PROMPT,
    ),
    promptCommand(
      "repair-app",
      "Repair app",
      "Find and fix what broke in an app",
      REPAIR_APP_PROMPT,
    ),
  ],
  project_manager: [
    promptCommand(
      "check-kinds",
      "Check kinds",
      "Check the project's documents against its kinds",
      CHECK_KINDS_PROMPT,
    ),
  ],
  app_engineer: [],
  operator: [],
};
