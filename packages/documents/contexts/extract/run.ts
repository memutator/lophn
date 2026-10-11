import type { BundleContent } from "../../../contracts/documents/mod.ts";
import type { AppDataReader, ExtractResult, ProjectFiles } from "./types.ts";

// 계약의 type 순서대로 개체를, 위반은 path·kind·rule·section의 code unit 순으로 낸다.
export function extractAll(
  _bundle: BundleContent,
  _files: ProjectFiles,
  _appData: AppDataReader,
): ExtractResult {
  return { entities: [], violations: [] };
}
