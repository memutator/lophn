import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { RESERVED_APP_SLUGS } from "../apps/declaration/mod.ts";
import {
  appIdSchema,
  projectIdSchema,
  slugSchema,
} from "../projects/values.ts";

export const domainIdSchema = idSchema("dom");
// domain 이름은 slug이고 보관한 것까지 전 domain에서 하나다. 앱 slug와 같은 예약 이름(declaration/types.ts)은 쓰지 못한다(앱 이름의 domain이 같이 만들어진다).
export const domainNameSchema = slugSchema.refine(
  (name) => !RESERVED_APP_SLUGS.includes(name),
  {
    message: "domain name is reserved",
  },
);

// domain을 담는 그릇. project나 app 하나다.
export const domainOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), id: projectIdSchema }),
  z.strictObject({ kind: z.literal("app"), id: appIdSchema }),
]);
export type DomainOwner = z.infer<typeof domainOwnerSchema>;

export function ownerKey(owner: DomainOwner): string {
  return `${owner.kind}:${owner.id}`;
}
