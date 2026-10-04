// command 표의 한 자리다(T12). 이름·입력 schema·op마다 소유 route를 묶는다.
// 표 밖 op는 실행 전 거절이다(cli#R4). route는 contracts의 소유 table 값이며
// 임의 core API를 부르지 않는다(cli#R1, architecture 5.1).
import type { z } from "zod";
import type { Route } from "../../../contracts/platform/mod.ts";

export type CommandEntry = {
  // `lophn <group> <command>`의 `<group> <command>`다. `help`·`version`은 표에 없다.
  name: string;
  // command 계약의 CLI 입력 schema다. common field(cliCommonSchema)를 포함한다.
  input: z.ZodType;
  // op마다 소유 route 하나다. op를 쓰지 않는 command는 monoRoutes를 쓴다.
  opRoutes?: Record<string, Route>;
  // op 없이 route 하나인 command다(read·project current 같은 것).
  monoRoute?: Route;
};
