// test용 앱의 source. `app.create`가 core 안에서 template을 깔고 commit한 source 폴더에서 출발한다. 사람이 앱을 시작하는
// 길과 같아서 template이 깨지면 그것도 잡힌다.
import { appDefaultSource } from "../../../packages/protocol/apps/mod.ts";
import type { TemplateFile } from "../../../packages/core/apps/packages/template/files.ts";
import { scaffoldApp } from "../../../packages/core/apps/packages/template/scaffold.ts";
import type { Core } from "../core/mod.ts";

// 사람의 git 설정(서명, hook, 이름)을 읽지 않는다.
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args: [
      "-c",
      "user.name=e2e",
      "-c",
      "user.email=e2e@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    cwd,
    env: GIT_ENV,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(
      `git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
  return new TextDecoder().decode(out.stdout).trim();
}

// 제품 template에는 sample 업무가 없다. e2e patch가 기대하는 sample(items tool·screen·표)은 test가 소유한 이
// overlay(`sample/`)로, core가 깐 template 위에 어떤 patch보다 먼저 얹는다. 파일 끝의 `.tmpl`은 저장소 도구가 읽지 않게 하는 표시다.
const SAMPLE = new URL("./sample/", import.meta.url).pathname;

async function sampleFiles(): Promise<TemplateFile[]> {
  const found: TemplateFile[] = [];
  async function visit(dir: string, prefix: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) await visit(`${dir}/${entry.name}`, path);
      else {
        found.push({
          path: path.replace(/\.tmpl$/, ""),
          bytes: await Deno.readFile(`${dir}/${entry.name}`),
        });
      }
    }
  }
  await visit(SAMPLE, "");
  return found;
}

export type AppPatch = (dir: string) => Promise<void>;

/**
 * core가 `app.create`에서 깐 source 폴더(`<home>/apps/<app>/source`) 위에 견본과 patch를 얹고 commit한다.
 * commit은 40 hex다. `sample: false`면 template 그대로에 patch만 얹는다.
 */
export async function createAppSource(
  core: Core,
  options: {
    app: string;
    slug: string;
    title?: string;
    patch?: AppPatch;
    sample?: boolean;
  },
): Promise<{ dir: string; commit: string }> {
  const dir = appDefaultSource(core.run.home, options.app);
  try {
    await git(dir, "rev-parse", "--verify", "HEAD");
  } catch {
    throw new Error(`${dir}에 core가 깐 commit이 없다`);
  }
  if (options.sample !== false) {
    const files = await sampleFiles();
    // scaffoldApp은 있는 file을 덮지 않으므로 겹치는 template file을 먼저 지운다. sample은 자기 screen(items)을
    // 선언하므로 template의 자리 표시 screen(home)도 지운다.
    for (const file of files) {
      await Deno.remove(`${dir}/${file.path}`).catch(() => {});
    }
    await Deno.remove(`${dir}/src/screens/home`, { recursive: true }).catch(
      () => {},
    );
    const scaffolded = await scaffoldApp({
      files,
      dir,
      app: options.slug,
      ...(options.title === undefined ? {} : { title: options.title }),
    });
    if (!scaffolded.ok) {
      throw new Error(`scaffold: ${scaffolded.error.message}`);
    }
  }
  await options.patch?.(dir);
  await git(dir, "add", "-A");
  // sample이 없고 patch도 없으면 바뀐 것이 없다. 그래도 그 HEAD를 돌려주면 된다.
  await git(dir, "commit", "-q", "--allow-empty", "-m", "app");
  return { dir, commit: await git(dir, "rev-parse", "HEAD") };
}

/** 견본의 첫 tool `domain`이다. 견본 위의 앱이면 앱 slug(= 앱 domain)다. patch가 새 tool의 domain을 이것으로 채운다. */
export async function sampleDomain(dir: string): Promise<string> {
  const found = (await Deno.readTextFile(`${dir}/lophn.ts`)).match(
    /domain:\s*"([a-z0-9-]+)"/,
  );
  if (found === null) throw new Error(`${dir}/lophn.ts에 domain이 없다`);
  return found[1]!;
}

/** 둘째 release용. patch를 적용한 뒤 새 commit을 만든다. */
export async function amendAppSource(
  dir: string,
  patch: AppPatch,
): Promise<string> {
  await patch(dir);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "amend");
  return await git(dir, "rev-parse", "HEAD");
}
