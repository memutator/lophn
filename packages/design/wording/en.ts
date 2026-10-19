// en catalog의 영역 목록이다. 값은 완성된 문장 하나의 ICU MessageFormat이고, 화면 코드는 문장 조각을 이어 붙이지 않는다.
// 영역을 더하려면 import 한 줄, AREAS 한 칸, en의 spread 한 칸을 더하고 placeholders.ts에도 한 칸을 더한다.
import { agents } from "./catalog/agents.ts";
import { appSpace } from "./catalog/app-space.ts";
import { artifact } from "./catalog/artifact.ts";
import { browser } from "./catalog/browser.ts";
import { common } from "./catalog/common.ts";
import { contexts } from "./catalog/contexts.ts";
import { conversation } from "./catalog/conversation.ts";
import { data } from "./catalog/data.ts";
import { project } from "./catalog/project.ts";
import { workspace } from "./catalog/workspace.ts";
import { workspaceSettings } from "./catalog/workspace-settings.ts";

// key는 catalog/ 아래 영역 file 이름이다.
export const AREAS = {
  agents,
  "app-space": appSpace,
  artifact,
  browser,
  common,
  contexts,
  conversation,
  data,
  project,
  workspace,
  "workspace-settings": workspaceSettings,
} as const;

export const en = {
  ...agents,
  ...appSpace,
  ...artifact,
  ...browser,
  ...common,
  ...contexts,
  ...conversation,
  ...data,
  ...project,
  ...workspace,
  ...workspaceSettings,
} as const;

export type Catalog = typeof en;
export type MessageKey = keyof Catalog;
