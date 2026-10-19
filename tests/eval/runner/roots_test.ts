import { assertEquals } from "@std/assert";
import { extraRoots } from "./roots.ts";

Deno.test("extraRoots: adds woken role agents, not coding, known roots or the fake lophn session", () => {
  const snap = (session: string, role: string) =>
    ({ session, agent: { role } }) as Parameters<typeof extraRoots>[0][number];
  const got = extraRoots(
    [
      snap("ses_said", "lophn"),
      snap("ses_fake", "lophn"),
      snap("ses_pm", "project_manager"),
      snap("ses_coding", "coding_agent"),
    ],
    ["ses_said"],
    new Set(["ses_fake"]),
  );
  assertEquals(got, ["ses_pm"]);
});
