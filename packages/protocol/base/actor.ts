import { z } from "zod";
import { ACTOR_KINDS, type ActorKind } from "./route.ts";
import { idSchema } from "./ids.ts";

// actor 문자열의 모양만 정한다. 인증은 core의 몫이다.
function prefixed(kind: string, id: z.ZodType<string>) {
  return z
    .string()
    .refine(
      (value) =>
        value.startsWith(`${kind}:`) &&
        id.safeParse(value.slice(kind.length + 1)).success,
      { message: "invalid actor" },
    );
}

// lophn agent는 session(`ses`)이 신원이다. assignment(`asg`)는 옛 run-loop가 쓰던 id다.
const agentIdSchema = z.union([idSchema("ses"), idSchema("asg")]);

export const actorSchema = z.union([
  z.enum(["user", "machine"]),
  prefixed("agent", agentIdSchema),
  prefixed("app", idSchema("app")),
]);

export type Actor = z.infer<typeof actorSchema>;

type ActorParts =
  | { kind: "user" }
  | { kind: "machine" }
  | { kind: "agent"; id: string }
  | { kind: "app"; id: string };

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

export { ACTOR_KINDS };
