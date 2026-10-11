import {
  type CatalogEntry,
  catalogEntrySchema,
} from "../../../../contracts/lophn-agent/mod.ts";
import catalogJson from "./catalog-options.json" with { type: "json" };

// option 축 시험용 catalog다. anthropic(예산 방식·이름 방식), openai(effort + Speed service tier),
// xai(effort 값 둘, Speed가 별도 model id)와 option이 없다고 확인된 model 하나를 담는다.
export const CATALOG_OPTIONS: readonly CatalogEntry[] = catalogJson.map((
  row,
) => catalogEntrySchema.parse(row));

export function catalogEntry(provider: string, model: string): CatalogEntry {
  const found = CATALOG_OPTIONS.find((entry) =>
    entry.provider_definition === provider && entry.model_name === model
  );
  if (found === undefined) throw new Error(`no fixture: ${provider}/${model}`);
  return found;
}
