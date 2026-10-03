import { z } from "zod";
import { ACTOR_KINDS, type ActorKind } from "./route.ts";
import { idSchema } from "./ids.ts";

// actor 문자열의 모양만 정한다. 인증은 platform/identity의 몫이다.
function prefixed(kind: string, id: z.ZodString) {
  return z.string().refine(
    (value) =>
      value.startsWith(`${kind}:`) &&
      id.safeParse(value.slice(kind.length + 1)).success,
    { message: "invalid actor" },
  );
}

const actorSchema = z.union([
  z.enum(["user", "machine"]),
  prefixed("coding_agent", idSchema("cac")),
  prefixed("agent", idSchema("asg")),
  prefixed("app", idSchema("app")),
]);

export type Actor = z.infer<typeof actorSchema>;

export type ActorParts =
  | { kind: "user" }
  | { kind: "machine" }
  | { kind: "coding_agent"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "app"; id: string };

export const actorPartsSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user") }),
  z.strictObject({ kind: z.literal("machine") }),
  z.strictObject({ kind: z.literal("coding_agent"), id: idSchema("cac") }),
  z.strictObject({ kind: z.literal("agent"), id: idSchema("asg") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
]);

export function parseActor(s: string): ActorParts | undefined {
  const parsed = actorSchema.safeParse(s);
  if (!parsed.success) return undefined;
  if (parsed.data === "user" || parsed.data === "machine") {
    return { kind: parsed.data };
  }
  const colon = parsed.data.indexOf(":");
  const kind = parsed.data.slice(0, colon) as Exclude<
    ActorKind,
    "user" | "machine"
  >;
  return { kind, id: parsed.data.slice(colon + 1) };
}

export function formatActor(parts: ActorParts): Actor {
  if (parts.kind === "user" || parts.kind === "machine") return parts.kind;
  return `${parts.kind}:${parts.id}` as Actor;
}

export { ACTOR_KINDS };
