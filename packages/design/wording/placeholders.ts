// en.ts에서 생성한다. 직접 고치지 않고 `deno run -A generate.ts --check`로 맞춘다.
import type { MessageKey } from "./en.ts";

export type PlaceholderKinds = {
  "common.activity.agent": Record<never, never>;
  "common.activity.app": Record<never, never>;
  "common.author.label": {
    author: "string";
  };
  "common.button.close": Record<never, never>;
  "common.button.columns": Record<never, never>;
  "common.button.copy-code": Record<never, never>;
  "common.button.copy-id": Record<never, never>;
  "common.button.next-page": Record<never, never>;
  "common.button.previous-page": Record<never, never>;
  "common.button.reload": Record<never, never>;
  "common.button.retry": Record<never, never>;
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
  "common.error.load-failed": {
    target: "string";
  };
  "common.heading.column-unit": {
    header: "string";
    unit: "string";
  };
  "common.heading.count": Record<never, never>;
  "common.heading.group": Record<never, never>;
  "common.label.date-with-weekday": {
    date: "string";
    weekday: "string";
  };
  "common.label.more-waiting": {
    count: "plural";
  };
  "common.label.on-this-page": Record<never, never>;
  "common.label.original-order": Record<never, never>;
  "common.label.other": Record<never, never>;
  "common.label.row-range": {
    start: "number";
    end: "number";
    total: "number";
  };
  "common.label.sort-by": Record<never, never>;
  "common.label.value-range": {
    start: "string";
    end: "string";
  };
  "common.notification.body": Record<never, never>;
  "common.notification.title": Record<never, never>;
  "common.overlay.unavailable": Record<never, never>;
  "common.palette.no-results": Record<never, never>;
  "common.stale.label": {
    age: "string";
  };
  "confirmation-window.body.checking": Record<never, never>;
  "confirmation-window.body.expired": Record<never, never>;
  "confirmation-window.body.review": Record<never, never>;
  "confirmation-window.body.second": Record<never, never>;
  "confirmation-window.body.stale": Record<never, never>;
  "confirmation-window.body.unknown": Record<never, never>;
  "confirmation-window.button.cancel": Record<never, never>;
  "confirmation-window.button.decide": Record<never, never>;
  "confirmation-window.button.refresh": Record<never, never>;
  "confirmation-window.title.confirm": Record<never, never>;
  "contexts.view.baseline": Record<never, never>;
  "contexts.view.follow-changes": Record<never, never>;
  "contexts.view.reference": Record<never, never>;
  "document.diff.identical": Record<never, never>;
  "launcher.button.lophn": Record<never, never>;
  "launcher.button.reconnect": Record<never, never>;
  "launcher.button.retry": Record<never, never>;
  "launcher.connection.confirmed-at": {
    when: "string";
  };
  "launcher.connection.disconnected": Record<never, never>;
  "launcher.connection.failed": Record<never, never>;
  "launcher.connection.starting": Record<never, never>;
  "launcher.empty.no-cards": Record<never, never>;
  "project-workspace.button.close-tab": Record<never, never>;
  "project-workspace.button.collapse-sidebar": Record<never, never>;
  "project-workspace.button.expand-sidebar": Record<never, never>;
  "project-workspace.button.launcher": Record<never, never>;
  "project-workspace.empty.no-contexts": Record<never, never>;
  "project-workspace.empty.no-documents": Record<never, never>;
  "project-workspace.empty.no-folders": Record<never, never>;
  "project-workspace.empty.no-tabs": Record<never, never>;
  "project-workspace.error.load-failed": Record<never, never>;
  "project-workspace.heading.contexts": Record<never, never>;
  "project-workspace.heading.documents": Record<never, never>;
  "project-workspace.heading.folders": Record<never, never>;
  "project-workspace.info.empty": Record<never, never>;
  "project-workspace.label.info-tab-contexts": Record<never, never>;
  "project-workspace.label.info-tab-info": Record<never, never>;
  "project-workspace.label.info-tab-versions": Record<never, never>;
  "project-workspace.sidebar.label": Record<never, never>;
  "project-workspace.label.kind-app-panel": Record<never, never>;
  "project-workspace.label.kind-document-editor": Record<never, never>;
  "project-workspace.label.kind-document-viewer": Record<never, never>;
  "project-workspace.label.kind-terminal": Record<never, never>;
  "settings.models.for-decisions": Record<never, never>;
  "settings.models.for-summaries": Record<never, never>;
};

type ValueFor<T> = T extends "plural" | "number" ? number
  : T extends "date" ? Date
  : string;

export type ValuesOf<K extends MessageKey> = {
  [P in keyof PlaceholderKinds[K]]: ValueFor<PlaceholderKinds[K][P]>;
};

export type HasPlaceholders<K extends MessageKey> = [
  keyof PlaceholderKinds[K],
] extends [never] ? false
  : true;

type _SameKeys =
  | Exclude<MessageKey, keyof PlaceholderKinds>
  | Exclude<keyof PlaceholderKinds, MessageKey>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
