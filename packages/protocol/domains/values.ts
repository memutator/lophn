import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { RESERVED_DOMAIN_NAMES } from "../apps/declaration/mod.ts";
import {
  appIdSchema,
  projectIdSchema,
  slugSchema,
} from "../projects/values.ts";

export const domainIdSchema = idSchema("dom");
// domain 이름은 slug이고 보관한 것까지 전 domain에서 하나다. 앱 command는 `lophn <domain> <command>`로 부르는데 domain 이름이 내장 명령 이름과 겹치지 않도록
// 예약 이름(declaration/types.ts)은 쓰지 못한다.
export const domainNameSchema = slugSchema.refine(
  (name) => !RESERVED_DOMAIN_NAMES.includes(name),
  {
    message: "domain name is reserved",
  },
);
// artifact 이름은 폴더 이름이라 slug다.
export const artifactNameSchema = slugSchema;

// domain을 담는 그릇. project나 app 하나다.
export const domainOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), id: projectIdSchema }),
  z.strictObject({ kind: z.literal("app"), id: appIdSchema }),
]);
export type DomainOwner = z.infer<typeof domainOwnerSchema>;

export function ownerKey(owner: DomainOwner): string {
  return `${owner.kind}:${owner.id}`;
}
