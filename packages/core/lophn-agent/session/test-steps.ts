import type { SchemaStep } from "../../../protocol/server/mod.ts";
import { guiMemberSchemaSteps } from "./gui-member-schema.ts";
import { conversationSchemaSteps } from "./model.ts";
import {
  appMessagesSchemaSteps,
  sessionOpenerSchemaSteps,
} from "./opener-schema.ts";
import {
  memberRunsOnSchemaSteps,
  remoteSenderMessagesSchemaSteps,
} from "./remote-sender-schema.ts";
import { workflowOriginSchemaSteps } from "./workflow-origin-schema.ts";

// 대화 표(session·message)를 직접 만드는 test가 같이 쓰는 step 목록이다. session 표의 뒤 step(`opened_by_app`, `harness_gui`)까지 들어 있어 새 열이 생겨도
// test마다 목록을 고치지 않는다.
export const conversationTestSteps: readonly SchemaStep[] = [
  ...conversationSchemaSteps,
  ...appMessagesSchemaSteps,
  ...sessionOpenerSchemaSteps,
  ...guiMemberSchemaSteps,
  ...remoteSenderMessagesSchemaSteps,
  ...memberRunsOnSchemaSteps,
  ...workflowOriginSchemaSteps,
  {
    // turns 표 없이 conversationTestSteps만 돌리는 test에서도 sessions.permission_mode 열이 있게 한다.
    id: "lophn-agent.session-permission-mode.test-sessions",
    sql: `
alter table sessions add column permission_mode text not null default 'workspace'
  check (permission_mode in ('read_only', 'ask', 'workspace', 'full'));
update sessions set permission_mode = 'full' where skip = 1;`,
  },
];
