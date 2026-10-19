import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import {
  appIdSchema,
  projectIdSchema,
  slugSchema,
} from "../projects/values.ts";

export const domainIdSchema = idSchema("dom");
// domain 이름은 slug이고 보관한 것까지 전 domain에서 하나다.
export const domainNameSchema = slugSchema;
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
