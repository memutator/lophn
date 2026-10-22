// catalog/workflow.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { workflow } from "./workflow.ts";

export type WorkflowPlaceholders = {
  "workflow.error.instances-failed": Record<never, never>;
  "workflow.error.load-failed": Record<never, never>;
  "workflow.error.not-startable": Record<never, never>;
  "workflow.error.start-failed": Record<never, never>;
  "workflow.error.stop-failed": Record<never, never>;
};

type Area = typeof workflow;
type _SameKeys =
  | Exclude<keyof Area, keyof WorkflowPlaceholders>
  | Exclude<keyof WorkflowPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
