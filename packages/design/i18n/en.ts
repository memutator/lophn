// en catalog. 값은 완성된 문장 하나의 ICU MessageFormat이고, 화면 코드는 문장 조각을 이어 붙이지 않는다.
// 다른 locale의 catalog는 이 key의 일부만 가져도 된다. 없는 key는 en 문장으로 보인다.
import { agents } from "./catalog/agents.ts";
import { appSpace } from "./catalog/app-space.ts";
import { artifact } from "./catalog/artifact.ts";
import { browser } from "./catalog/browser.ts";
import { common } from "./catalog/common.ts";
import { conversation } from "./catalog/conversation.ts";
import { data } from "./catalog/data.ts";
import { leftSidebar } from "./catalog/left-sidebar.ts";
import { mobileApp } from "./catalog/mobile-app.ts";
import { mobileCoding } from "./catalog/mobile-coding.ts";
import { mobileHome } from "./catalog/mobile-home.ts";
import { mobileInbox } from "./catalog/mobile-inbox.ts";
import { mobileKit } from "./catalog/mobile-kit.ts";
import { mobileNotifications } from "./catalog/mobile-notifications.ts";
import { mobileOps } from "./catalog/mobile-ops.ts";
import { mobilePlaces } from "./catalog/mobile-places.ts";
import { mobileSession } from "./catalog/mobile-session.ts";
import { mobileTerminal } from "./catalog/mobile-terminal.ts";
import { mobileWidgets } from "./catalog/mobile-widgets.ts";
import { project } from "./catalog/project.ts";
import { shell } from "./catalog/shell.ts";
import { workflow } from "./catalog/workflow.ts";
import { workspace } from "./catalog/workspace.ts";
import { workspaceSettings } from "./catalog/workspace-settings.ts";

export const en = {
  ...agents,
  ...appSpace,
  ...artifact,
  ...browser,
  ...common,
  ...conversation,
  ...data,
  ...leftSidebar,
  ...mobileKit,
  ...mobileApp,
  ...mobileCoding,
  ...mobileHome,
  ...mobileSession,
  ...mobileInbox,
  ...mobilePlaces,
  ...mobileNotifications,
  ...mobileOps,
  ...mobileTerminal,
  ...mobileWidgets,
  ...project,
  ...shell,
  ...workflow,
  ...workspace,
  ...workspaceSettings,
} as const;

export type Catalog = typeof en;
export type MessageKey = keyof Catalog;
