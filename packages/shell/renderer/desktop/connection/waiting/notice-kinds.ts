// 기록 종류의 사람 말 이름. Inbox(Notifications, History)와 앱 상세 Activity가 같이 쓴다.
import type { MessageKey } from "@lophn/i18n";
import type { NoticeKind } from "../../../../../protocol/apps/notice.ts";

export const KIND_LABEL = {
  app: "waiting.label.kind-app",
  release_activated: "waiting.label.kind-release-activated",
  release_failed: "waiting.label.kind-release-failed",
  release_rolled_back: "waiting.label.kind-release-rolled-back",
  app_unavailable: "waiting.label.kind-app-unavailable",
  app_data_migrated: "waiting.label.kind-app-data-migrated",
  app_data_restored: "waiting.label.kind-app-data-restored",
  lophn_updated: "waiting.label.kind-lophn-updated",
  sdk_update_needed: "waiting.label.kind-sdk-update-needed",
  workspace_update_needed: "waiting.label.kind-sdk-update-needed",
  session_stopped_by_app: "waiting.label.kind-session-stopped-by-app",
  phone_changed: "waiting.label.kind-phone-changed",
  app_sync_away: "waiting.label.kind-app-sync-away",
} as const satisfies Record<NoticeKind, MessageKey>;
