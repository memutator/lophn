// `deno task e2e:deps`. E2E 중 release 준비가 쓸 npm·jsr 의존과 esbuild 실행 파일을 e2eDenoDir()에 받는다.
// network를 쓰는 유일한 명령이다. 무엇을 받는지는 추측하지 않고 코드로 정한다: 내장 template 앱을 새 data root에서
// 실제로 release 준비까지 지나 본다. `--offline`은 같은 준비를 다시 돌려 받은 것만으로 되는지 보는 단계로,
// network를 끊은 곳에서 돌린다: `unshare -rn sh -c 'ip link set lo up && deno task e2e:deps --offline'`.
import {
  createIdSource,
  cryptoRandom,
  systemClock,
} from "../../../packages/base/mod.ts";
import { installSdkCopies } from "../../../packages/core/apps/packages/install.ts";
import { scaffoldApp } from "../../../packages/core/apps/packages/template/scaffold.ts";
import { builtinTemplate } from "../../../packages/core/apps/packages/template/files.ts";
import { installBuiltinTemplate } from "../../../packages/core/apps/packages/template/install.ts";
import {
  buildEnvironment,
  cacheBuildTools,
} from "../../../packages/core/apps/releases/ui-build/binaries.ts";
import { prepareFromSource } from "../../../packages/core/apps/releases/prepare/from-source.ts";
import { e2eDenoDir } from "./deps.ts";

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const PACKAGES = `${REPO}/packages/`;

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

// sdk 사본이 읽기 전용(폴더 0555)이라 폴더마다 쓰기 권한을 돌려준 뒤 지운다.
async function removeDir(dir: string): Promise<void> {
  async function open(directory: string): Promise<void> {
    await Deno.chmod(directory, 0o755);
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isDirectory) await open(`${directory}/${entry.name}`);
    }
  }
  await open(dir);
  await Deno.remove(dir, { recursive: true });
}

const offline = Deno.args.includes("--offline");
const denoDir = e2eDenoDir();
await Deno.mkdir(denoDir, { recursive: true });
// prepareFromSource와 그 자식이 DENO_DIR을 이 process 환경에서 읽는다.
Deno.env.set("DENO_DIR", denoDir);

const e2eRoot = `${REPO}/.dev-data/e2e`;
const dataRoot = await Deno.makeTempDir({ dir: e2eRoot, prefix: "deps-" });
try {
  const sdk = await installSdkCopies({ dataRoot, packagesRoot: PACKAGES });
  if (!sdk.ok) throw new Error(`sdk 사본: ${sdk.error.message}`);
  const template = await installBuiltinTemplate({ dataRoot });
  if (!template.ok) throw new Error(`template: ${template.error.message}`);

  const files = await builtinTemplate(`${dataRoot}/templates/app`);
  if (!files.ok) throw new Error(`template: ${files.error.message}`);
  const sourceRoot = `${dataRoot}/work/deps-app`;
  const scaffolded = await scaffoldApp({
    files: files.value,
    dir: sourceRoot,
    app: "deps-app",
    dataRoot,
  });
  if (!scaffolded.ok) throw new Error(`scaffold: ${scaffolded.error.message}`);
  await git(sourceRoot, "init", "-q");
  await git(sourceRoot, "add", "-A");
  await git(sourceRoot, "commit", "-q", "-m", "deps");
  const commit = await git(sourceRoot, "rev-parse", "HEAD");

  // release 준비의 `deno cache`는 vendor 모드라 jsr 파일을 deno-dir이 아니라 staging의 vendor/로 바로 받고, 그때마다
  // jsr.io에서 meta.json을 다시 받는다(npm은 deno-dir을 거친다). 그래서 vendor 없이 같은 npm·jsr 값을 먼저 받아
  // deno-dir에 채워 두어야 network 없이 준비가 된다.
  const imports = (JSON.parse(
    await Deno.readTextFile(`${sourceRoot}/deno.json`),
  ) as { imports: Record<string, string> }).imports;
  const specifiers = [
    ...new Set(
      Object.values(imports).filter((value) =>
        value.startsWith("npm:") || value.startsWith("jsr:")
      ).map((value) => value.replace(/\/$/, "")),
    ),
  ].sort();
  const warmDir = `${dataRoot}/warm`;
  await Deno.mkdir(warmDir);
  await Deno.writeTextFile(`${warmDir}/deno.json`, "{}");
  await Deno.writeTextFile(
    `${warmDir}/deps.ts`,
    specifiers.map((specifier) => `import ${JSON.stringify(specifier)};\n`)
      .join(""),
  );
  const cached = await new Deno.Command(Deno.execPath(), {
    args: ["cache", "--no-lock", `${warmDir}/deps.ts`],
    cwd: warmDir,
    env: { DENO_DIR: denoDir },
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!cached.success) throw new Error("npm·jsr 의존을 받지 못했다");

  // prepareFromSource는 이미 받아 둔 esbuild 실행 파일만 build 자식에 허락한다. 제품에서는 release-runner가 하는 일이다.
  if (!await cacheBuildTools(Deno.execPath(), buildEnvironment(dataRoot))) {
    throw new Error("build 도구를 받지 못했다");
  }
  const prepared = await prepareFromSource({
    dataRoot,
    app: createIdSource({ clock: systemClock, random: cryptoRandom }).newId(
      "app",
    ),
    sourceRoot,
    commit,
  });
  if (!prepared.ok) {
    throw new Error(
      `release 준비 실패: ${prepared.error.code} ${prepared.error.reason}`,
    );
  }
  console.log(
    `${offline ? "offline " : ""}release 준비 통과. 의존은 ${denoDir}에 있다.`,
  );
} finally {
  await removeDir(dataRoot).catch(() => undefined);
}
