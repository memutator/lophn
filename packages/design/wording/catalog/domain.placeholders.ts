// catalog/domain.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { domain } from "./domain.ts";

export type DomainPlaceholders = {
  "domain.button.add": Record<never, never>;
  "domain.button.archive": Record<never, never>;
  "domain.button.create": Record<never, never>;
  "domain.button.new": Record<never, never>;
  "domain.button.open-doc": Record<never, never>;
  "domain.empty.project": Record<never, never>;
  "domain.heading.list": Record<never, never>;
  "domain.label.all-domains": Record<never, never>;
  "domain.label.counts": {
    kinds: "plural";
    skills: "plural";
    artifacts: "plural";
  };
  "domain.label.filter": Record<never, never>;
  "domain.label.name": Record<never, never>;
  "domain.label.pick": Record<never, never>;
  "domain.label.place-app": {
    name: "string";
  };
  "domain.label.purpose": Record<never, never>;
  "domain.label.row-menu": {
    title: "string";
  };
  "domain.label.sidebar-tab": Record<never, never>;
  "domain.label.title": Record<never, never>;
  "domain.label.tool-counts": {
    tools: "plural";
    shared: "plural";
  };
  "domain.note.layers-app": Record<never, never>;
  "domain.note.layers-project": Record<never, never>;
  "domain.note.name-help": Record<never, never>;
  "domain.note.purpose-help": Record<never, never>;
  "domain.notice.all-of-app": Record<never, never>;
  "domain.notice.all-of-project": Record<never, never>;
  "domain.notice.app-last": Record<never, never>;
  "domain.notice.only-chosen": Record<never, never>;
  "domain.notice.skills-filtered": Record<never, never>;
  "domain.title.create": Record<never, never>;
};

type Area = typeof domain;
type _SameKeys =
  | Exclude<keyof Area, keyof DomainPlaceholders>
  | Exclude<keyof DomainPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
