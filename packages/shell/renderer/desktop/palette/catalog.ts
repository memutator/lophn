// 팔레트의 project·앱 행이 읽는 통로. core route 이름은 core-catalog.ts만 안다.
import type { SourceResult } from "../../source-result.ts";

interface Named {
  readonly id: string;
  readonly title: string;
}

/** 팔레트에서 고르는 project와 앱. */
export interface Catalog {
  readonly projects: readonly Named[];
  readonly apps: readonly Named[];
}

export interface CatalogSource {
  catalog(): Promise<SourceResult<Catalog>>;
}
