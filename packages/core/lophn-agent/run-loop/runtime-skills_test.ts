import { assert, assertEquals } from "@std/assert";
import { agentRuntimeLaunchSpec } from "../register.ts";

const base = {
  dataRoot: "/data/lophn",
  apiPort: 1234,
  socketRoot: "/data/lophn/run/apps",
};

Deno.test("lophn-agent/extensions#R1: runtime child의 읽기 허락은 data root에 사람이 등록한 skill 폴더만 더한다", () => {
  const plain = agentRuntimeLaunchSpec(base).allow_read;
  assert(plain.includes("/data/lophn"));
  assert(!plain.includes("/home/person/skills"));

  const registered = agentRuntimeLaunchSpec({
    ...base,
    skillRoots: ["/home/person/skills", "/mnt/shared/skills"],
  }).allow_read;
  assertEquals(
    registered.filter((path) => !plain.includes(path)),
    ["/home/person/skills", "/mnt/shared/skills"],
  );
});
