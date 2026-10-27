import type { CatalogEntry } from "../../../protocol/lophn-agent/mod.ts";
import { hashEntries, parseEntries } from "./mod.ts";
import snapshotJson from "./snapshot.json" with { type: "json" };

// 동봉 catalog snapshot이다(release snapshot, 마지막
// 정상본이 없을 때 자리). module import라 file API가 없다(core graph의
// platform/responsiveness 검사가 동기 file API를 막는다).
const entries: CatalogEntry[] =
  parseEntries(JSON.stringify(snapshotJson)) ?? [];

// derived catalog 파일이 없거나 깨졌을 때 catalog 읽기가 답하는 동봉 snapshot과 그 hash다.
export const bundledSnapshot = { entries, hash: await hashEntries(entries) };

// model identity(provider_definition, model_name)의 catalog 조회. 파생
// catalog 파일 read는 reader worker 등록 경로다.
export function snapshotCatalogEntry(
  providerDefinition: string,
  modelName: string,
): CatalogEntry | undefined {
  return (
    entries.find(
      (entry) =>
        entry.provider_definition === providerDefinition &&
        entry.model_name === modelName,
    ) ?? undefined
  );
}
