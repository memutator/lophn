// kinds worker와 core 사이의 계약. 공개 route가 아니다. 감독 pipe의 worker_request 꼴이다.
// worker는 `lophn.db`를 열지 않고 core에도 닿지 않는다. 응답의 `get`·`list`·`check`는 같은 이름의 route
// output과 같고, 실패는 worker의 `ok:false` 답(`not_found` 등)이다.
import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { sha256Schema } from "../base/values.ts";
import {
  kindCheck,
  kindCheckQuerySchema,
  kindGet,
  kindList,
  kindListQuerySchema,
  kindsStatusSchema,
  violationSchema,
} from "./kinds-api.ts";
import { absolutePathSchema } from "./values.ts";

export const KINDS_WORKER_KIND = "documents/kinds";

// core가 problem 쪽에 command를 낼 때의 machine 자격 이름. problem 쪽이 이것으로 호출자를 확인한다.
export const KINDS_DISPATCH_PRINCIPAL = "machine:kinds-dispatch";

export const KINDS_WORK_OPS = {
  sync: "kinds.sync",
  get: "kinds.get",
  list: "kinds.list",
  check: "kinds.check",
} as const;

// sync 응답에 싣는 violation의 상한. 넘으면 truncated다.
export const KINDS_VIOLATION_CAP = 200;

const common = {
  domain: idSchema("dom"),
  kinds_file: absolutePathSchema,
  // domain 그릇의 폴더(project면 등록 폴더들, 앱이면 source 폴더)의 절대 경로. 같은 상대 경로가 여럿에 있으면 앞 폴더가 이긴다.
  roots: z.array(absolutePathSchema).max(64),
  // 직전 scan 뒤 2초 안이어도 다시 훑으라는 뜻이다.
  force: z.boolean().optional(),
};

// sync와 get의 요청.
export const kindsWorkRequestSchema = z.strictObject(common);
export const kindsListWorkRequestSchema = z.strictObject({
  ...common,
  query: kindListQuerySchema,
});
export const kindsCheckWorkRequestSchema = z.strictObject({
  ...common,
  query: kindCheckQuerySchema,
});

export const kindsSyncResponseSchema = z.strictObject({
  status: kindsStatusSchema,
  violations: z.array(violationSchema).max(KINDS_VIOLATION_CAP),
  truncated: z.boolean(),
  // (status.errors + 실은 violations)의 canonical JSON hash
  violations_hash: sha256Schema,
  changed: z.boolean(),
});
export type KindsSyncResponse = z.infer<typeof kindsSyncResponseSchema>;

export const kindsGetWorkResponseSchema = kindGet.output;
export const kindsListWorkResponseSchema = kindList.output;
export const kindsCheckWorkResponseSchema = kindCheck.output;
