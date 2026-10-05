import type { CatalogEntry } from "../../../contracts/lophn-agent/mod.ts";
import { parseEntries } from "./mod.ts";
import snapshotJson from "./snapshot.json" with { type: "json" };

// 동봉 catalog snapshot이다(T4 release snapshot, harness/model R5의 마지막
// 정상본이 없을 때 자리). module import라 file API가 없다(core graph의
// platform/responsiveness#R1 검사가 동기 file API를 막는다).
const entries: CatalogEntry[] = parseEntries(
  JSON.stringify(snapshotJson),
) ?? [];

// model identity(provider_definition, model_name)의 catalog 조회(T4). 파생
// catalog 파일 read는 reader worker 등록 경로다(plan/lophn-agent Q28).
export function snapshotCatalogEntry(
  providerDefinition: string,
  modelName: string,
): CatalogEntry | undefined {
  return entries.find((entry) =>
    entry.provider_definition === providerDefinition &&
    entry.model_name === modelName
  ) ?? undefined;
}

// provider 정의 목록에 그 model 이름이 있는지다(R10). 이 snapshot이 provider
// 정의 목록이므로 확인 실패는 없어 항상 boolean이다.
export function snapshotModelListed(
  providerDefinition: string,
  modelName: string,
): boolean {
  return entries.some((entry) =>
    entry.provider_definition === providerDefinition &&
    entry.model_name === modelName
  );
}
