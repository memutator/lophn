// catalog/artifact.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { artifact } from "./artifact.ts";

export type ArtifactPlaceholders = {
  "artifact.button.annotate": Record<never, never>;
  "artifact.button.delete": Record<never, never>;
  "artifact.button.edit-source": Record<never, never>;
  "artifact.empty.missing": {
    name: "string";
  };
  "artifact.empty.none": Record<never, never>;
  "artifact.label.kind": Record<never, never>;
  "artifact.label.list": Record<never, never>;
  "artifact.label.note": Record<never, never>;
  "artifact.label.open-link": Record<never, never>;
  "artifact.note.file-root": {
    folder: "string";
  };
  "artifact.text.annotate-on": Record<never, never>;
  "artifact.text.annotations-sent": Record<never, never>;
  "artifact.text.memo-note": Record<never, never>;
  "artifact.title.annotate-on": Record<never, never>;
  "artifact.title.annotations-sent": {
    count: "plural";
    agent: "string";
  };
};

type Area = typeof artifact;
type _SameKeys =
  | Exclude<keyof Area, keyof ArtifactPlaceholders>
  | Exclude<keyof ArtifactPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
