// test용 앱의 source. core가 깐 template(`<home>/templates/app`, 읽기 전용 사본)에서 출발한다. 사람이 앱을 시작하는
// 길과 같아서 template이 깨지면 그것도 잡힌다.
import {
  builtinTemplate,
  type TemplateFile,
} from "../../../packages/core/apps/packages/template/files.ts";
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
// overlay(`sample/`)로, 복사한 template 위에 어떤 patch보다 먼저 얹는다. 파일 끝의 `.tmpl`은 저장소 도구가 읽지 않게 하는 표시다.
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

/** template을 run.work/<slug>로 복사해 patch를 얹고 git init·commit한다. commit은 40 hex다. */
export async function createAppSource(
  core: Core,
  options: { slug: string; title?: string; patch?: AppPatch },
): Promise<{ dir: string; commit: string }> {
  const files = await builtinTemplate(`${core.run.home}/templates/app`);
  if (!files.ok) throw new Error(`template: ${files.error.message}`);
  const dir = `${core.run.work}/${options.slug}`;
  const sample = await sampleFiles();
  const overlaid = new Set(sample.map((file) => file.path));
  // sample은 자기 screen(items)을 선언하므로 template의 자리 표시 screen은 걷어 낸다.
  const placeholder = "src/screens/home/";
  const scaffolded = await scaffoldApp({
    files: [
      ...files.value.filter((file) =>
        !overlaid.has(file.path) && !file.path.startsWith(placeholder)
      ),
      ...sample,
    ],
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
