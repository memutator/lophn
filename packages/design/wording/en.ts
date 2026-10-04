// en catalog. 값은 완성된 문장 하나의 ICU MessageFormat이다. 화면 코드는 문장 조각을 이어 붙이지 않는다.
export const en = {
  "common.notification.body": "Something needs your attention.",
  "common.notification.title": "lophn",
  "contexts.view.baseline": "Baseline",
  "contexts.view.reference": "Reference",
  "contexts.view.follow-changes": "Follow changes",
  "document.diff.identical": "These versions are identical.",
  "settings.models.for-decisions": "For decisions",
  "settings.models.for-summaries": "For summaries",
  "common.activity.agent": "Agent activity",
  "common.activity.app": "App activity",
  "common.error.load-failed": "Couldn't load {target}.",
  "common.button.reload": "Reload",
  "common.overlay.unavailable": "This action couldn't be completed. Try again.",
  "common.button.retry": "Try again",
  "common.stale.label": "Last updated {age}",
  "common.author.label": "Written by {author}",
  "common.heading.column-unit": "{header} ({unit})",
  "common.button.copy-id": "Copy ID",
  "common.button.copy-code": "Copy code",
  "common.copy.failed": "Couldn't copy. Try again.",
  "common.label.on-this-page": "On this page",
  "common.button.close": "Close",
  "common.button.view": "View",
  "common.label.more-waiting": "{count, plural, one {+# more} other {+# more}}",
  "common.palette.no-results": "Nothing matches your search.",
} as const;

export type Catalog = typeof en;
export type MessageKey = keyof Catalog;
