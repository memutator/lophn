// 계약 의미 검사: series pattern 문법·겹침, from_type, index 문서 형식, app-data command 효과.
import { parsePattern } from "../series/next.ts";
import type { ContractCheck, ContractIssue } from "./types.ts";

const isMarkdownDocument = (document: string) =>
  /\.(?:md|markdown)$/i.test(document);

export const checkSources: ContractCheck = (bundle, env) => {
  const issues: ContractIssue[] = [];
  const { types } = bundle.contract;
  const names = new Set(types.map((type) => type.name));
  const seenPatterns = new Set<string>();

  types.forEach((type, i) => {
    const source = type.source;
    const at = (
      ...rest: (string | number)[]
    ) => ["contract", "types", i, "source", ...rest];
    switch (source.kind) {
      case "series":
        if (!parsePattern(source.pattern).ok) {
          issues.push({
            code: "series_pattern_invalid",
            path: at("pattern"),
          });
        }
        if (seenPatterns.has(source.pattern)) {
          issues.push({
            code: "series_pattern_overlap",
            path: at("pattern"),
          });
        }
        seenPatterns.add(source.pattern);
        break;
      case "section":
      case "outline":
        if (source.from_type !== undefined) {
          if (source.from_type === type.name) {
            issues.push({ code: "from_type_self", path: at("from_type") });
          } else if (!names.has(source.from_type)) {
            issues.push({ code: "from_type_unknown", path: at("from_type") });
          }
        }
        break;
      case "index":
        if (!isMarkdownDocument(source.document)) {
          issues.push({ code: "index_not_markdown", path: at("document") });
        }
        break;
      case "app-data": {
        const effect = env.appApiEffect(source.app, source.command);
        if (effect === "unknown") {
          issues.push({ code: "app_api_unknown", path: at("command") });
        } else if (effect !== "read") {
          issues.push({ code: "app_api_not_read", path: at("command") });
        }
        break;
      }
    }
  });
  return issues;
};
