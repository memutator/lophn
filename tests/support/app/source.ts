// test용 앱의 source. core가 깐 template(`<home>/templates/app`, 읽기 전용 사본)에서 출발한다. 사람이 앱을 시작하는
// 길과 같아서 template이 깨지면 그것도 잡힌다.
import { builtinTemplate } from "../../../packages/core/apps/packages/template/files.ts";
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

export type AppPatch = (dir: string) => Promise<void>;

/** template을 run.work/<slug>로 복사해 patch를 얹고 git init·commit한다. commit은 40 hex다. */
export async function createAppSource(
  core: Core,
  options: { slug: string; title?: string; patch?: AppPatch },
): Promise<{ dir: string; commit: string }> {
  const files = await builtinTemplate(`${core.run.home}/templates/app`);
  if (!files.ok) throw new Error(`template: ${files.error.message}`);
  const dir = `${core.run.work}/${options.slug}`;
  const scaffolded = await scaffoldApp({
    files: files.value,
    dir,
    app: options.slug,
    ...(options.title === undefined ? {} : { title: options.title }),
  });
  if (!scaffolded.ok) throw new Error(`scaffold: ${scaffolded.error.message}`);
  await options.patch?.(dir);
  await git(dir, "init", "-q");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "app");
  return { dir, commit: await git(dir, "rev-parse", "HEAD") };
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
