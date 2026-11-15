// 폰 화면 하나를 가진 test 앱. release 준비(`prepareFromSource`)를 network 없이 돌리려고 npm 의존이 없다:
// kit(`@lophn/ui-native`)과 hook(`@lophn/app-ui-native`)은 `react-native`의 `View`·`Text`만 다시 내는 SDK 사본
// stand-in이고(`sdk/`, data root의 설치 위치에 깐다), preview build가 푸는 react·react-dom·react-native-web은
// npm workspace(`app/stand-ins/`)의 빈 module이다. 진짜 kit으로 그려지는지는 이 fixture가 보지 않는다.
// 파일 끝의 `.tmpl`은 저장소 도구(tsc, npm workspace)가 읽지 않게 하는 표시다.
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));

async function copyTemplates(from: string, to: string): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name.replace(/\.tmpl$/, ""));
    if (entry.isDirectory()) {
      await copyTemplates(source, target);
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(source));
    }
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const child = spawn(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd,
      // 사람의 git 설정(서명, hook, 이름)을 읽지 않는다.
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout
    .setEncoding("utf8")
    .on("data", (chunk: string) => (stdout += chunk));
  child.stderr
    .setEncoding("utf8")
    .on("data", (chunk: string) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${stderr}`);
  return stdout.trim();
}

/**
 * data root에 kit stand-in을 깔고 `<dataRoot>/work/phone-app`에 앱 source를 써서 commit한다. patch는 commit 전에
 * source 폴더를 고친다.
 */
export async function createPhoneApp(
  dataRoot: string,
  patch?: (dir: string) => Promise<void>,
): Promise<{ sourceRoot: string; commit: string }> {
  await copyTemplates(join(HERE, "sdk"), join(dataRoot, "sdk"));
  const sourceRoot = join(dataRoot, "work/phone-app");
  await copyTemplates(join(HERE, "app"), sourceRoot);
  await patch?.(sourceRoot);
  await git(sourceRoot, "init", "-q");
  await git(sourceRoot, "add", "-A");
  await git(sourceRoot, "commit", "-q", "-m", "phone fixture");
  return { sourceRoot, commit: await git(sourceRoot, "rev-parse", "HEAD") };
}
