import type { SchemaStep } from "../../../protocol/server/mod.ts";
import {
  appMessagesSchemaSteps,
  sessionOpenerSchemaSteps,
} from "./opener-schema.ts";
import { conversationSchemaSteps } from "./model.ts";
import { guiMemberSchemaSteps } from "./gui-member-schema.ts";

// 대화 표(session·message)를 직접 만드는 test가 같이 쓰는 step 목록이다. session 표의 뒤 step(`opened_by_app`, `harness_gui`)까지 들어 있어 새 열이 생겨도
// test마다 목록을 고치지 않는다.
export const conversationTestSteps: readonly SchemaStep[] = [
  ...conversationSchemaSteps,
  ...appMessagesSchemaSteps,
  ...sessionOpenerSchemaSteps,
  ...guiMemberSchemaSteps,
];
