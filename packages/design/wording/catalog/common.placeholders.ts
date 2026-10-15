// catalog/common.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { common } from "./common.ts";

export type CommonPlaceholders = {
  "app-detail.button.remove-access": Record<never, never>;
  "app-detail.label.version": {
    number: "string";
  };
  "common.author.label": {
    author: "string";
  };
  "common.button.apply": Record<never, never>;
  "common.button.ask-agent": {
    agent: "string";
  };
  "common.button.back": Record<never, never>;
  "common.button.cancel": Record<never, never>;
  "common.button.clear": Record<never, never>;
  "common.button.close": Record<never, never>;
  "common.button.columns": Record<never, never>;
  "common.button.copy-address": Record<never, never>;
  "common.button.copy-code": Record<never, never>;
  "common.button.copy-id": Record<never, never>;
  "common.button.next-page": Record<never, never>;
  "common.button.previous-page": Record<never, never>;
  "common.button.quit": Record<never, never>;
  "common.button.reload": Record<never, never>;
  "common.button.reset-filters": Record<never, never>;
  "common.button.retry": Record<never, never>;
  "common.button.select-all": Record<never, never>;
  "common.button.show-chart": Record<never, never>;
  "common.button.show-table": Record<never, never>;
  "common.button.sort-ascending": Record<never, never>;
  "common.button.sort-descending": Record<never, never>;
  "common.button.view": Record<never, never>;
  "common.chart.too-many-groups": {
    max: "number";
  };
  "common.chart.unreadable": Record<never, never>;
  "common.copy.failed": Record<never, never>;
  "common.empty.not-ready": Record<never, never>;
  "common.error.action-failed": {
    action: "string";
  };
  "common.error.load-failed": {
    target: "string";
  };
  "common.error.show-failed": Record<never, never>;
  "common.heading.column-unit": {
    header: "string";
    unit: "string";
  };
  "common.heading.count": Record<never, never>;
  "common.heading.group": Record<never, never>;
  "common.heading.palette-contexts": Record<never, never>;
  "common.label.all-of": {
    dimension: "string";
  };
  "common.label.date-from": Record<never, never>;
  "common.label.date-to": Record<never, never>;
  "common.label.date-with-weekday": {
    date: "string";
    weekday: "string";
  };
  "common.label.first-and-more": {
    first: "string";
    count: "plural";
  };
  "common.label.more-waiting": {
    count: "plural";
  };
  "common.label.on-this-page": Record<never, never>;
  "common.label.original-order": Record<never, never>;
  "common.label.other": Record<never, never>;
  "common.label.palette-key-close": Record<never, never>;
  "common.label.palette-key-move": Record<never, never>;
  "common.label.palette-key-open": Record<never, never>;
  "common.label.range-custom": Record<never, never>;
  "common.label.range-last-30-days": Record<never, never>;
  "common.label.range-last-7-days": Record<never, never>;
  "common.label.range-last-90-days": Record<never, never>;
  "common.label.range-this-month": Record<never, never>;
  "common.label.range-today": Record<never, never>;
  "common.label.row-range": {
    start: "number";
    end: "number";
    total: "number";
  };
  "common.label.search": Record<never, never>;
  "common.label.sort-by": Record<never, never>;
  "common.label.tab-ended": Record<never, never>;
  "common.label.tab-waiting": Record<never, never>;
  "common.label.tab-working": Record<never, never>;
  "common.label.tray-global-search-unavailable": Record<never, never>;
  "common.label.tray-launcher": Record<never, never>;
  "common.label.tray-notifications-unavailable": Record<never, never>;
  "common.label.tray-open": Record<never, never>;
  "common.label.tray-quit": Record<never, never>;
  "common.label.tray-start-at-login": Record<never, never>;
  "common.label.tray-tooltip": Record<never, never>;
  "common.label.value-range": {
    start: "string";
    end: "string";
  };
  "common.notification.body": Record<never, never>;
  "common.notification.title": Record<never, never>;
  "common.overlay.unavailable": Record<never, never>;
  "common.palette.no-results": Record<never, never>;
  "common.quit.saves": Record<never, never>;
  "common.quit.terminals": Record<never, never>;
  "common.quit.terminals-and-saves": Record<never, never>;
  "common.stale.label": {
    age: "string";
  };
  "common.title.quit": Record<never, never>;
  "contexts.empty.tab-none": Record<never, never>;
  "contexts.label.frame-chip": Record<never, never>;
  "contexts.label.rail-contexts": Record<never, never>;
  "contexts.label.rail-search": Record<never, never>;
  "conversation.label.document": Record<never, never>;
  "conversation.label.rewind-remain": Record<never, never>;
  "conversation.label.rewind-restore": Record<never, never>;
  "conversation.label.rewind-skip": Record<never, never>;
  "conversation.notice.provider-lost": Record<never, never>;
  "conversation.rewind.note": Record<never, never>;
  "conversation.rewind.redo-no": Record<never, never>;
  "conversation.rewind.redo-yes": Record<never, never>;
  "document.button.check-again": Record<never, never>;
  "document.button.read": Record<never, never>;
  "document.diff.identical": Record<never, never>;
  "document.label.meta": {
    number: "number";
    when: "string";
  };
  "document.label.saving": Record<never, never>;
  "document.status.offline": Record<never, never>;
  "document.status.unknown": Record<never, never>;
  "document.status.version-pending": Record<never, never>;
  "document.status.version-saved": Record<never, never>;
  "documents.status.draft": Record<never, never>;
  "launcher.button.reconnect": Record<never, never>;
  "launcher.button.retry": Record<never, never>;
  "launcher.label.detail-gitignore": Record<never, never>;
  "launcher.label.rule-exclude": {
    glob: "string";
  };
  "launcher.label.rule-include": {
    glob: "string";
  };
  "project-workspace.button.collapse-sidebar": Record<never, never>;
  "project-workspace.button.expand-sidebar": Record<never, never>;
  "settings.button.cancel": Record<never, never>;
  "settings.button.connect": Record<never, never>;
  "settings.error.changed": Record<never, never>;
  "settings.error.window": Record<never, never>;
  "settings.label.auth-api-key": Record<never, never>;
  "settings.label.auth-bearer": Record<never, never>;
  "settings.label.auth-none": Record<never, never>;
  "settings.label.auth-sign-in": Record<never, never>;
  "settings.label.details": Record<never, never>;
  "settings.label.tab-connections": Record<never, never>;
  "settings.label.way-api-key": Record<never, never>;
  "things-to-confirm.label.event-activation-failed": Record<never, never>;
  "things-to-confirm.label.event-decision": Record<never, never>;
  "things-to-confirm.label.event-issue-closed": Record<never, never>;
  "things-to-confirm.label.event-issue-opened": Record<never, never>;
  "things-to-confirm.label.event-issue-reopened": Record<never, never>;
  "things-to-confirm.label.event-paused": Record<never, never>;
  "things-to-confirm.label.event-question": Record<never, never>;
  "things-to-confirm.label.event-task-check-failed": Record<never, never>;
  "things-to-confirm.label.event-task-confirmed": Record<never, never>;
  "things-to-confirm.label.event-violations-rose": Record<never, never>;
};

type Area = typeof common;
type _SameKeys =
  | Exclude<keyof Area, keyof CommonPlaceholders>
  | Exclude<keyof CommonPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
