// 다른 기계의 browser 탭을 보고 다루는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
// 바뀜(`PageViewChanged`, `StateChanged{browser_pages}`)은 창의 event client로 듣는다.
import type { z } from "zod";

import type {
  PageInput,
  pageViewList,
  pageViewSnapshot,
} from "../../../../protocol/lophn-agent/page-view.ts";
import type { SourceResult } from "../../source-result.ts";

export type PageRow = z.output<typeof pageViewList.output>["pages"][number];
export type PageSnapshot = z.output<typeof pageViewSnapshot.output>;

export interface PageViewSource {
  list(): Promise<SourceResult<readonly PageRow[]>>;
  snapshot(tab: string): Promise<SourceResult<PageSnapshot>>;
  watch(tab: string, on: boolean): Promise<SourceResult<null>>;
  input(tab: string, input: PageInput): Promise<SourceResult<null>>;
  control(tab: string, held: boolean): Promise<SourceResult<null>>;
  /** 그 기계에 page를 연다. 연 탭의 id를 돌려준다. */
  open(url: string): Promise<SourceResult<string>>;
}
