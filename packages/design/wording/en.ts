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
  "settings.activity.agent": "Agent activity",
  "settings.activity.app": "App activity",
} as const;

export type Catalog = typeof en;
export type MessageKey = keyof Catalog;
