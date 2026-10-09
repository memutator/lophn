// 일곱 제품 adapter의 설치 fixture 테스트다(coding-agent/connection#R1).
// catalog 제품을 temp home에 하나씩 install하고, 고른 target만 바뀌는지와
// 다른 제품 설정을 읽거나 만들지 않는지를 본다. HOME·CODEX_HOME·XDG·lophn home은
// temp dir다. 사람의 실제 home, OS keychain, 제품 binary는 열지 않는다.
// launch argv는 설정에 적기만 하고 실행하지 않는다.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  type FilePort,
  filePort,
  HARNESS_CATALOG,
  type HarnessDefinition,
  installSelected,
  rootOf,
  storeOf,
} from "../../packages/coding-agent/harnesses/mod.ts";
import {
  CAC,
  type Fixture,
  fixture,
  fixtureLaunch,
  NOW,
  targetOf,
} from "../../packages/coding-agent/harnesses/testing/mod.ts";

const SKILL_NAME = "lophn-navigate";
const SKILL = {
  name: SKILL_NAME,
  files: [{
    path: "SKILL.md",
    content: "---\nname: lophn-navigate\n---\n",
  }],
};

function recordingPort(inner: FilePort, seen: string[]): FilePort {
  return {
    read(path) {
      seen.push(path);
      return inner.read(path);
    },
    listFiles(dir) {
      seen.push(dir);
      return inner.listFiles(dir);
    },
    escapes: (root, path) => inner.escapes(root, path),
    writeAtomic(path, text) {
      seen.push(path);
      return inner.writeAtomic(path, text);
    },
    writeTree(dir, files) {
      seen.push(dir);
      return inner.writeTree(dir, files);
    },
    remove(path) {
      seen.push(path);
      return inner.remove(path);
    },
  };
}

// user 범위 설정 파일·skill root와, home 전체를 가리키지 않는 제품 디렉터리다.
// project 안 파일은 이 제품의 home 설정이 아니라서 넣지 않는다.
function placesOf(fx: Fixture, definition: HarnessDefinition): string[] {
  const found = new Set<string>();
  const add = (resolver: string, path: string) => {
    const root = rootOf(resolver, {
      home: fx.home,
      env: fx.env,
      cwd: fx.project,
    });
    if (!root.ok || root.value === fx.project) return;
    const full = `${root.value}/${path}`;
    found.add(full);
    if (root.value !== fx.home) {
      found.add(root.value);
      return;
    }
    const top = `${fx.home}/${path.split("/")[0]}`;
    if (top !== full) found.add(top);
  };
  for (const config of definition.config_targets) {
    if (config.scope_kind === "user") add(config.root_resolver, config.path);
  }
  for (const skill of definition.skill_targets) {
    if (skill.scope_kind === "user") add(skill.root_resolver, skill.path);
  }
  return [...found];
}

function covers(touched: string, place: string): boolean {
  return touched === place || touched.startsWith(`${place}/`) ||
    place.startsWith(`${touched}/`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function userConfigText(
  fx: Fixture,
  definition: HarnessDefinition,
): Promise<string[]> {
  const texts: string[] = [];
  for (const config of definition.config_targets) {
    if (config.scope_kind !== "user") continue;
    const root = rootOf(config.root_resolver, {
      home: fx.home,
      env: fx.env,
      cwd: fx.project,
    });
    if (!root.ok || root.value === fx.project) continue;
    texts.push(await Deno.readTextFile(`${root.value}/${config.path}`));
  }
  return texts;
}

async function userSkillText(
  fx: Fixture,
  definition: HarnessDefinition,
): Promise<string[]> {
  const texts: string[] = [];
  for (const skill of definition.skill_targets) {
    if (skill.scope_kind !== "user") continue;
    const root = rootOf(skill.root_resolver, {
      home: fx.home,
      env: fx.env,
      cwd: fx.project,
    });
    if (!root.ok || root.value === fx.project) continue;
    texts.push(
      await Deno.readTextFile(
        `${root.value}/${skill.path}/${SKILL_NAME}/SKILL.md`,
      ),
    );
  }
  return texts;
}

Deno.test("coding-agent/connection#R1: 일곱 제품 adapter 설치는 고른 target만 바꾸고 다른 제품 설정은 읽지도 만들지 않는다", async () => {
  assertEquals(HARNESS_CATALOG.length, 7);
  for (const definition of HARNESS_CATALOG) {
    const id = definition.harness_id;
    const fx = await fixture();
    const seen: string[] = [];
    try {
      const outcome = await installSelected({
        target: targetOf(id, "user", fx),
        connection: CAC,
        launch: fixtureLaunch(),
        skill: SKILL,
        version: null,
        roots: { home: fx.home, env: fx.env, cwd: fx.project },
        operationId: `op-${id}`,
        now: NOW,
      }, {
        files: recordingPort(filePort(), seen),
        store: storeOf(fx.lophn),
      });
      assert(outcome.ok, id);
      assertEquals(outcome.value.status, "complete", id);
      assert(
        outcome.value.resources.some((item) => item.outcome === "changed"),
        id,
      );
      const configs = await userConfigText(fx, definition);
      const skills = await userSkillText(fx, definition);
      assert(configs.length + skills.length > 0, id);
      for (const text of configs) assertStringIncludes(text, CAC);
      for (const text of skills) assertStringIncludes(text, SKILL_NAME);
      const own = new Set(placesOf(fx, definition));
      for (const other of HARNESS_CATALOG) {
        if (other.harness_id === id) continue;
        for (const place of placesOf(fx, other)) {
          if (own.has(place)) continue;
          assert(
            !seen.some((touched) => covers(touched, place)),
            `${id}가 ${other.harness_id} 설정을 읽거나 썼다: ${place}`,
          );
          assertEquals(
            await exists(place),
            false,
            `${id}가 ${other.harness_id} 설정을 만들었다: ${place}`,
          );
        }
      }
    } finally {
      await fx.dispose();
    }
  }
});
