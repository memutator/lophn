// 예와 saved view를 돌려 finding을 낸다. 둘은 서로 막지 않는다.
import type {
  BundleContent,
  CheckFinding,
  ContractExample,
} from "../../../../protocol/projects/mod.ts";
import type { ExtractedEntity } from "../extract/types.ts";
import { runSearch } from "../search/run.ts";
import type { ResultRow, SearchError } from "../search/types.ts";
import type { ExampleReason } from "./types.ts";

type Entity = ExtractedEntity;

const asText = (value: unknown): unknown =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value;

// JSON 값의 깊은 비교. 객체는 key 순서를 보지 않는다.
function same(a: unknown, b: unknown): boolean {
  a = asText(a);
  b = asText(b);
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((item, i) => same(item, b[i]));
  }
  if (
    typeof a !== "object" || typeof b !== "object" || a === null || b === null
  ) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) =>
      Object.hasOwn(right, key) && same(left[key], right[key])
    );
}

const keysOf = (rows: readonly ResultRow[]): string[] =>
  rows.map((row) => row.ref.key);

const errorText = (error: SearchError): string =>
  error.input === undefined ? error.code : `${error.code}: ${error.input}`;

function mismatch(index: number, reason: ExampleReason, note = "") {
  return {
    kind: "example_mismatch" as const,
    target: `examples.${index}`,
    detail: note === "" ? reason : `${reason}: ${note}`,
  };
}

function checkExample(
  bundle: BundleContent,
  example: ContractExample,
  index: number,
  entities: readonly Entity[],
): CheckFinding | null {
  if (example.kind === "entity") {
    const { type, key, fields } = example.expect;
    const found = entities.find((e) =>
      e.type === type && e.key === key && e.path === example.path &&
      e.section === example.section
    );
    if (found === undefined) return mismatch(index, "entity_not_found");
    for (const [name, want] of Object.entries(fields ?? {})) {
      if (
        !Object.hasOwn(found.fields, name) || !same(found.fields[name], want)
      ) {
        return mismatch(index, "field_differs", name);
      }
    }
    return null;
  }
  const run = runSearch({
    bundle,
    search: example.search,
    inputs: example.inputs,
    entities,
  });
  if (!run.ok) return mismatch(index, "search_error", errorText(run.error));
  // table이면 행 순서, board면 칸 순서대로 칸마다 행 순서(첫 page만)
  const got = run.result.kind === "table"
    ? keysOf(run.result.rows)
    : run.result.lanes.flatMap((lane) => keysOf(lane.rows));
  return same(got, example.expect_keys) ? null : mismatch(
    index,
    "keys_differ",
    `expected [${example.expect_keys.join(", ")}], got [${got.join(", ")}]`,
  );
}

export function exampleFindings(
  bundle: BundleContent,
  entities: readonly Entity[],
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  bundle.examples.forEach((example, index) => {
    const finding = checkExample(bundle, example, index, entities);
    if (finding !== null) findings.push(finding);
  });
  return findings;
}

export type SavedViewCall = {
  name: string;
  search: string;
  inputs: Record<string, unknown>;
};

export function savedViewFindings(
  bundle: BundleContent,
  views: readonly SavedViewCall[],
  entities: readonly Entity[],
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const view of views) {
    const run = runSearch({
      bundle,
      search: view.search,
      inputs: view.inputs,
      entities,
    });
    if (!run.ok) {
      findings.push({
        kind: "saved_view_broken",
        target: `saved_views.${view.name}`,
        detail: errorText(run.error),
      });
    }
  }
  return findings;
}
