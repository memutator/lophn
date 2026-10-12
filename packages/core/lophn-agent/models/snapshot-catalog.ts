import type { CatalogEntry } from "../../../protocol/lophn-agent/mod.ts";
import { parseEntries } from "./mod.ts";
import snapshotJson from "./snapshot.json" with { type: "json" };

// 동봉 catalog snapshot이다(release snapshot, 마지막
// 정상본이 없을 때 자리). module import라 file API가 없다(core graph의
// platform/responsiveness 검사가 동기 file API를 막는다).
const entries: CatalogEntry[] = parseEntries(
  JSON.stringify(snapshotJson),
) ?? [];

// model identity(provider_definition, model_name)의 catalog 조회. 파생
// catalog 파일 read는 reader worker 등록 경로다.
export function snapshotCatalogEntry(
  providerDefinition: string,
  modelName: string,
): CatalogEntry | undefined {
  return entries.find((entry) =>
    entry.provider_definition === providerDefinition &&
    entry.model_name === modelName
  ) ?? undefined;
}

// provider 정의 목록에 그 model 이름이 있는지다. snapshot에 그 provider 정의의 model이 하나도 없으면
// 목록을 확인할 수 없으므로 null이고, 있으면 그 목록에 이름이 있는지다.
export function snapshotModelListed(
  providerDefinition: string,
  modelName: string,
): boolean | null {
  const known = entries.filter((entry) =>
    entry.provider_definition === providerDefinition
  );
  if (known.length === 0) return null;
  return known.some((entry) => entry.model_name === modelName);
}
