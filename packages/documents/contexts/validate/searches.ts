// 계약 의미 검사: 선언 검색의 from·follow·path·입력 참조, 입력의 of, 예와 saved view가 부르는 검색·입력.
import { checkCall } from "./searches-calls.ts";
import { buildScope, checkCondition, checkPath } from "./searches-scope.ts";
import type { ContractCheck, ContractIssue } from "./types.ts";

const RANGE_VALUE_TYPES = ["number", "date"];

export const checkSearches: ContractCheck = (bundle, env) => {
  const issues: ContractIssue[] = [];
  const types = bundle.contract.types;

  bundle.searches.forEach((search, s) => {
    const at = ["searches", s];
    const { query, result } = search;
    if (!types.some((t) => t.name === query.from)) {
      issues.push({
        code: "search_from_unknown",
        path: [...at, "query", "from"],
      });
      return;
    }

    search.inputs.forEach((input, i) => {
      if (input.of === undefined) return;
      const path = [...at, "inputs", i, "of"];
      const [typeName, field, extra] = input.of.split(".");
      const type = types.find((t) => t.name === typeName);
      const declared = type?.fields.find((f) => f.name === field);
      const ok = input.type === "entity"
        ? type !== undefined && field === undefined
        : declared !== undefined && extra === undefined;
      if (!ok) {
        issues.push({ code: "search_input_of_unknown", path });
      } else if (
        input.type === "range" && declared !== undefined &&
        !RANGE_VALUE_TYPES.includes(declared.value_type)
      ) {
        issues.push({ code: "search_input_of_not_range", path });
      }
    });

    const inputs = new Set(search.inputs.map((input) => input.name));
    const scope = buildScope(bundle, env, s, search, issues, (i, partial) => {
      const where = query.follow[i].where;
      if (where !== undefined) {
        checkCondition(
          partial,
          inputs,
          where,
          [...at, "query", "follow", i, "where"],
          issues,
        );
      }
    });
    if (query.where !== null) {
      checkCondition(
        scope,
        inputs,
        query.where,
        [...at, "query", "where"],
        issues,
      );
    }
    query.sort.forEach((sort, i) =>
      checkPath(scope, sort.path, [...at, "query", "sort", i, "path"], issues)
    );
    if (query.group !== null) {
      checkPath(scope, query.group.by, [...at, "query", "group", "by"], issues);
    }
    result.columns.forEach((column, i) =>
      checkPath(
        scope,
        column.path,
        [...at, "result", "columns", i, "path"],
        issues,
      )
    );
    if (result.board_by !== undefined) {
      checkPath(scope, result.board_by, [...at, "result", "board_by"], issues);
    }
  });

  bundle.examples.forEach((example, i) => {
    if (example.kind === "search") {
      checkCall(bundle.searches, example, ["examples", i], {
        search: "example_search_unknown",
        input: "example_input_unknown",
        required: "example_input_required",
      }, issues);
    } else if (!types.some((t) => t.name === example.expect.type)) {
      issues.push({
        code: "example_type_unknown",
        path: ["examples", i, "expect", "type"],
      });
    }
  });

  bundle.saved_views.forEach((view, i) =>
    checkCall(bundle.searches, view, ["saved_views", i], {
      search: "saved_view_search_unknown",
      input: "saved_view_input_unknown",
      required: "saved_view_input_required",
    }, issues)
  );

  return issues;
};
