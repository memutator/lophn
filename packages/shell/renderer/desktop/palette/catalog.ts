// 팔레트의 project·앱 행이 읽는 통로. core route 이름은 core-catalog.ts만 안다.
import type { SourceResult } from "../../source-result.ts";

interface Named {
  readonly id: string;
  readonly title: string;
  /** 이미지 src(favicon 등). 없으면 switcher가 첫 글자와 색으로 대신한다. */
  readonly icon?: string;
  /** 이 컴퓨터가 아닌 기계의 project. 그 기계의 id와 이름이다. 줄에서 고르는 것과 같은 길로 그 기계의 workspace를 연다. */
  readonly machine?: string;
  readonly machineName?: string;
}

/** 팔레트에서 고르는 project와 앱. */
export interface Catalog {
  readonly projects: readonly Named[];
  readonly apps: readonly Named[];
}

export interface CatalogSource {
  catalog(): Promise<SourceResult<Catalog>>;
}
