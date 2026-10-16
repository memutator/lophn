// catalog/contexts.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { contexts } from "./contexts.ts";

export type ContextsPlaceholders = {
  "contexts.button.document-open": Record<never, never>;
  "contexts.button.frame-versions-hide": Record<never, never>;
  "contexts.button.frame-versions-show": Record<never, never>;
  "contexts.button.glossary-add": Record<never, never>;
  "contexts.button.glossary-add-term": Record<never, never>;
  "contexts.button.glossary-cancel": Record<never, never>;
  "contexts.button.glossary-delete": Record<never, never>;
  "contexts.button.glossary-edit": Record<never, never>;
  "contexts.button.glossary-save": Record<never, never>;
  "contexts.button.input-ask": Record<never, never>;
  "contexts.button.input-save-view": Record<never, never>;
  "contexts.button.input-search": Record<never, never>;
  "contexts.button.overview-see-all": {
    count: "string";
  };
  "contexts.button.results-next": Record<never, never>;
  "contexts.button.results-prev": Record<never, never>;
  "contexts.button.search-open-context": Record<never, never>;
  "contexts.button.search-save": Record<never, never>;
  "contexts.button.tab-archive": Record<never, never>;
  "contexts.button.tab-archived-hide": Record<never, never>;
  "contexts.button.tab-archived-show": Record<never, never>;
  "contexts.button.tab-open": Record<never, never>;
  "contexts.button.tab-unarchive": Record<never, never>;
  "contexts.button.versions-restore": Record<never, never>;
  "contexts.button.violations-send": Record<never, never>;
  "contexts.button.violations-send-all": Record<never, never>;
  "contexts.empty.document-none": Record<never, never>;
  "contexts.empty.glossary-none": Record<never, never>;
  "contexts.empty.results-none": Record<never, never>;
  "contexts.empty.search-no-searches": Record<never, never>;
  "contexts.empty.violations-none": Record<never, never>;
  "contexts.error.archive-failed": Record<never, never>;
  "contexts.error.glossary-failed": Record<never, never>;
  "contexts.error.reason-conflict": Record<never, never>;
  "contexts.error.reason-forbidden": Record<never, never>;
  "contexts.error.reason-internal": Record<never, never>;
  "contexts.error.reason-invalid-input": Record<never, never>;
  "contexts.error.reason-not-found": Record<never, never>;
  "contexts.error.reason-unauthorized": Record<never, never>;
  "contexts.error.reason-unavailable": Record<never, never>;
  "contexts.error.restore-failed": Record<never, never>;
  "contexts.error.search-save-failed": Record<never, never>;
  "contexts.error.violations-send-failed": Record<never, never>;
  "contexts.heading.composition-title": Record<never, never>;
  "contexts.heading.contract-fields": Record<never, never>;
  "contexts.heading.contract-relations": Record<never, never>;
  "contexts.heading.contract-searches": Record<never, never>;
  "contexts.heading.search-saved-views": Record<never, never>;
  "contexts.heading.search-searches": Record<never, never>;
  "contexts.heading.sidebar-contexts": Record<never, never>;
  "contexts.heading.sidebar-saved-views": Record<never, never>;
  "contexts.heading.tab-archived": {
    count: "string";
  };
  "contexts.heading.versions": Record<never, never>;
  "contexts.label.composition-documents": {
    type: "string";
    count: "plural";
    path: "string";
  };
  "contexts.label.composition-folders": {
    type: "string";
    count: "plural";
    path: "string";
  };
  "contexts.label.composition-from-section": {
    name: "string";
    heading: "string";
  };
  "contexts.label.composition-has": {
    fields: "string";
  };
  "contexts.label.composition-link": {
    label: "string";
    target: "string";
  };
  "contexts.label.composition-link-outside": {
    label: "string";
    target: "string";
    context: "string";
  };
  "contexts.label.composition-links": {
    links: "string";
  };
  "contexts.label.composition-uses": {
    context: "string";
    types: "string";
  };
  "contexts.label.contract-diagram": Record<never, never>;
  "contexts.label.contract-documents": {
    count: "plural";
  };
  "contexts.label.contract-examples-fail": {
    count: "plural";
  };
  "contexts.label.contract-examples-pass": {
    count: "plural";
  };
  "contexts.label.contract-field-section": {
    name: "string";
    heading: "string";
  };
  "contexts.label.contract-field-values": {
    name: "string";
    values: "string";
  };
  "contexts.label.contract-kind": {
    kind: "string";
  };
  "contexts.label.contract-public": Record<never, never>;
  "contexts.label.contract-relation": {
    name: "string";
    target: "string";
  };
  "contexts.label.document-role": {
    article: "string";
    type: "string";
  };
  "contexts.label.frame-note": Record<never, never>;
  "contexts.label.frame-sub-tabs": Record<never, never>;
  "contexts.label.frame-version-checking": {
    number: "string";
    when: "string";
  };
  "contexts.label.frame-version-failed": {
    number: "string";
    when: "string";
  };
  "contexts.label.frame-version-passed": {
    number: "string";
    when: "string";
  };
  "contexts.label.glossary-by-agent": Record<never, never>;
  "contexts.label.glossary-by-user": Record<never, never>;
  "contexts.label.glossary-meaning": Record<never, never>;
  "contexts.label.glossary-term": Record<never, never>;
  "contexts.label.input-chip-on": {
    value: "string";
  };
  "contexts.label.input-from": Record<never, never>;
  "contexts.label.input-no-matches": Record<never, never>;
  "contexts.label.input-to": Record<never, never>;
  "contexts.label.overview-diagram": Record<never, never>;
  "contexts.label.overview-from": {
    context: "string";
  };
  "contexts.label.overview-has": {
    fields: "string";
  };
  "contexts.label.palette-detail": Record<never, never>;
  "contexts.label.results-count": {
    count: "plural";
    singular: "string";
    plural: "string";
  };
  "contexts.label.results-pager": Record<never, never>;
  "contexts.label.results-range": {
    from: "number";
    to: "number";
    total: "number";
  };
  "contexts.label.search-context": Record<never, never>;
  "contexts.label.search-view-broken": Record<never, never>;
  "contexts.label.search-view-name": Record<never, never>;
  "contexts.label.sub-contract": Record<never, never>;
  "contexts.label.sub-glossary": Record<never, never>;
  "contexts.label.sub-overview": Record<never, never>;
  "contexts.label.sub-search": Record<never, never>;
  "contexts.label.sub-violations": Record<never, never>;
  "contexts.label.sub-violations-count": {
    count: "string";
  };
  "contexts.label.tab-kinds": {
    count: "plural";
    names: "string";
  };
  "contexts.label.tab-no-violations": Record<never, never>;
  "contexts.label.tab-version-checking": {
    number: "string";
  };
  "contexts.label.tab-version-failed": {
    number: "string";
  };
  "contexts.label.tab-version-none": Record<never, never>;
  "contexts.label.tab-version-passed": {
    number: "string";
  };
  "contexts.label.tab-violations": {
    count: "plural";
  };
  "contexts.label.target-focus": Record<never, never>;
  "contexts.label.target-list": Record<never, never>;
  "contexts.label.versions-checking": Record<never, never>;
  "contexts.label.versions-current": Record<never, never>;
  "contexts.label.versions-failed": Record<never, never>;
  "contexts.label.versions-name": {
    number: "string";
  };
  "contexts.label.violations-on-it": Record<never, never>;
  "contexts.label.violations-rule": {
    rule: "string";
  };
  "contexts.note.glossary-purpose": Record<never, never>;
  "contexts.note.input-required": {
    inputs: "string";
  };
  "contexts.note.input-unsupported": {
    type: "string";
  };
  "contexts.note.overview-example": Record<never, never>;
  "contexts.note.restored": Record<never, never>;
  "contexts.note.search-no-saved-views": Record<never, never>;
  "contexts.note.search-pick": Record<never, never>;
  "contexts.note.tab-archived": Record<never, never>;
  "contexts.title.restored": {
    number: "string";
  };
  "contexts.title.tab-screen": {
    project: "string";
  };
};

type Area = typeof contexts;
type _SameKeys =
  | Exclude<keyof Area, keyof ContextsPlaceholders>
  | Exclude<keyof ContextsPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
