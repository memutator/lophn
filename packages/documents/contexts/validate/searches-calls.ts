// 이름으로 검색을 부르는 곳(예, saved view)의 검사: 부르는 검색과 넘기는 입력이 선언과 맞는지.
import type { BundleContent } from "../../../contracts/documents/mod.ts";
import type { ContractIssue } from "./types.ts";

type Search = BundleContent["searches"][number];

export function checkCall(
  searches: readonly Search[],
  call: { search: string; inputs: Record<string, unknown> },
  at: (string | number)[],
  codes: {
    search: "example_search_unknown" | "saved_view_search_unknown";
    input: "example_input_unknown" | "saved_view_input_unknown";
    required: "example_input_required" | "saved_view_input_required";
  },
  issues: ContractIssue[],
): void {
  const search = searches.find((s) => s.name === call.search);
  if (search === undefined) {
    issues.push({ code: codes.search, path: [...at, "search"] });
    return;
  }
  const declared = new Set(search.inputs.map((input) => input.name));
  for (const name of Object.keys(call.inputs)) {
    if (!declared.has(name)) {
      issues.push({ code: codes.input, path: [...at, "inputs", name] });
    }
  }
  const missing = search.inputs.some((input) =>
    input.required && !Object.hasOwn(call.inputs, input.name)
  );
  if (missing) issues.push({ code: codes.required, path: [...at, "inputs"] });
}
