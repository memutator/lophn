import {
  acpDraft,
  acpImageRead,
  acpImageUpload,
  acpSend,
  acpSnapshot,
  acpToolBodyRead,
} from "./acp/routes.ts";
import { CODING_AGENT_ROUTES } from "./coding-agent/coding-agents.ts";
import { CODING_RELAY_ROUTES } from "./coding-agent/relay.ts";
import { TERMINAL_VIEW_ROUTES } from "./coding-agent/terminal-view.ts";
import { TERMINAL_ROUTES } from "./coding-agent/terminals.ts";
import { eventsList } from "./events/events.ts";
import { sessionSnapshotsList } from "./events/snapshot.ts";
import {
  commandsResult,
  identityCurrent,
  platformHealth,
  platformStatus,
} from "./server/routes.ts";
import { BLOB_ROUTES } from "./storage/blob.ts";
import { DIAGNOSTIC_ROUTES } from "./diagnostics/diagnostics.ts";
import { SETTINGS_FILE_ROUTES } from "./config/file.ts";
import { SECRET_FILE_ROUTES } from "./secrets/secret-file.ts";
import { LOGIN_ROUTES } from "./secrets/logins.ts";
import { DIAGNOSTIC_STATUS_ROUTES } from "./diagnostics/diagnostics.ts";
import { MACHINE_ROUTES } from "./machine/mod.ts";
import { ALWAYS_ON_ROUTES } from "./always-on/mod.ts";
import { FOLDER_ROUTES } from "./folder/mod.ts";
import { CARRY_ROUTES } from "./remote/carry.ts";
import { EXTENSION_ROUTES } from "./extensions/routes.ts";
import { PAGE_VIEW_ROUTES } from "./lophn-agent/page-view.ts";

// 지금 있는 route. 다른 파일의 route 배열(BLOB_ROUTES 등)도 여기로 모은다.
// approvals의 route는 core 등록(`core/approvals/registration.ts`)이 낸다. 여기 두면 겹친다.
export const ROUTES = [
  platformStatus,
  platformHealth,
  identityCurrent,
  commandsResult,
  eventsList,
  sessionSnapshotsList,
  acpSnapshot,
  acpDraft,
  acpSend,
  acpToolBodyRead,
  acpImageUpload,
  acpImageRead,
  ...CODING_RELAY_ROUTES,
  ...CODING_AGENT_ROUTES,
  ...TERMINAL_VIEW_ROUTES,
  ...TERMINAL_ROUTES,
  ...PAGE_VIEW_ROUTES,
  ...BLOB_ROUTES,
  ...DIAGNOSTIC_ROUTES,
  ...SETTINGS_FILE_ROUTES,
  ...SECRET_FILE_ROUTES,
  ...LOGIN_ROUTES,
  ...DIAGNOSTIC_STATUS_ROUTES,
  ...MACHINE_ROUTES,
  ...ALWAYS_ON_ROUTES,
  ...FOLDER_ROUTES,
  ...CARRY_ROUTES,
  ...EXTENSION_ROUTES,
] as const;

// 지금 있는 event. platform 소유 event는 settings에서 시작한다.
