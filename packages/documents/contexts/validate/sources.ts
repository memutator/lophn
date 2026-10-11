// 계약 의미 검사: series pattern 문법(documents/series R2)·겹침, from_type, index 문서 형식, app-data command 효과.
import type { ContractCheck, ContractIssue } from "./types.ts";

const PLACEHOLDER = /\{(?:n|major|minor|patch)(?:[+-](\d+))?(?::(\d+))?\}/;
const DIGIT = /^\d$/;

// documents/series 문법. 위반이면 false다.
function isSeriesPattern(pattern: string): boolean {
  if (pattern.trim() !== pattern) return false;
  const segments = pattern.split("/");
  const name = segments[segments.length - 1];
  for (const segment of segments.slice(0, -1)) {
    if (segment === "" || segment === "..") return false;
    if (/[*{}]/.test(segment)) return false;
  }
  if (name === "" || name === "..") return false;

  const match = PLACEHOLDER.exec(name);
  if (!match) return false;
  const [placeholder, step, width] = match;
  const before = name.slice(0, match.index);
  const after = name.slice(match.index + placeholder.length);
  if (/[{}]/.test(before) || /[{}]/.test(after)) return false;

  if (step !== undefined && !Number.isSafeInteger(Number(step))) return false;
  if (width !== undefined) {
    const value = Number(width);
    if (!Number.isSafeInteger(value) || value < 1 || value > 4) return false;
  }

  const prev = before.slice(-1);
  if (prev !== "" && (DIGIT.test(prev) || prev === "*")) return false;
  const next = after.slice(0, 1);
  if (next !== "" && (DIGIT.test(next) || next === "*")) return false;
  if (next === "." && DIGIT.test(after.slice(1, 2))) return false;
  return true;
}

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
        if (!isSeriesPattern(source.pattern)) {
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
        const effect = env.appCommandEffect(source.app, source.command);
        if (effect === "unknown") {
          issues.push({ code: "app_command_unknown", path: at("command") });
        } else if (effect !== "read") {
          issues.push({ code: "app_command_not_read", path: at("command") });
        }
        break;
      }
    }
  });
  return issues;
};
