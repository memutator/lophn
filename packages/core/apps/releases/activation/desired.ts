// 봉인 bundle 사본에서 앱 자식의 시작 입력을 만든다. 운영 DesiredApp과
// preview의 `PreviewBundle`이 같은 함수로 사본의 entry·import map·command·화면·data schema·flag를 읽는다.
// 사본의 모양: manifest.json, declaration.json, import-map.json(상대 경로는 사본 root 기준), 앱 코드와 build한
// screens/, 설치 SDK 사본 sdk/<이름>/<version>/, 앱 deno.lock, migrations/<from>-<to>.sql. 자식의 읽기 허락은
// 사본 root를 덮는다(`appFlags`의 bundle). 파일은 async로만 읽는다(core module graph).
import { readFile, stat } from "node:fs/promises";

import {
  err,
  errorCode,
  ok,
  type Result,
  sha256Hex,
} from "../../../../base/mod.ts";
import {
  type BundleManifest,
  bundleManifestSchema,
  type DataChange,
  dataChangeSchema,
  lossOfStepSql,
} from "../../../../protocol/apps/mod.ts";
import {
  type ToolDeclaration,
  validateDeclaration,
} from "../../declaration/mod.ts";
import {
  appFlags,
  type FlagSet,
  type PlatformPorts,
  type ResolvedRequirement,
} from "../../permissions/mod.ts";
import type { PreviewBundle, PreviewBundles } from "../../preview/mod.ts";
import {
  bundleCopyPath,
  DECLARATION_COPY_NAME,
  MANIFEST_COPY_NAME,
} from "../bundle/seal.ts";
import type { DesiredApp } from "../../runtime/mod.ts";

const IMPORT_MAP_COPY_NAME = "import-map.json";

type ScreenSizes = Record<string, ("full" | "panel" | "card")[]>;

type BundleParts = {
  // 사본 root. 자식의 읽기 허락과 import map 상대 경로의 기준이다.
  root: string;
  manifest: BundleManifest;
  entry: string;
  importMap: string;
  tools: ToolDeclaration[];
  screens: ScreenSizes;
  // migrations/<from>-<to>.sql 단계의 가장 큰 도착 schema다. 단계가 없으면 0이다.
  dataSchema: number;
};

export type DomainNamesOf = (app: string) => Promise<Result<string[]>>;

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

const STEP_FILE = /^migrations\/(\d+)-(\d+)\.sql$/;

function dataSchemaOf(manifest: BundleManifest): number {
  let schema = 0;
  for (const file of manifest.files) {
    const match = STEP_FILE.exec(file.path);
    if (match !== null) schema = Math.max(schema, Number(match[2]));
  }
  return schema;
}

// release.record의 data_changes다. 사본의 `migrations/<from>-<to>.sql`마다 한 단계이고
// script_hash는 그 파일 byte의 sha256이다. data worker가 같은 파일을 같은 hash로 확인한다
// (`scriptFromBundle`). 설명은 파일 앞의 `--` 주석 줄이고 없으면 schema 번호 이동이다. 손실은 파일 머리의
// `-- loss:` 줄이 유일한 출처이고 줄이 틀리면 invalid_input이라 release 준비가 거절된다.
export async function dataChangesOf(
  parts: Pick<BundleParts, "root" | "manifest">,
): Promise<Result<DataChange[]>> {
  const changes: DataChange[] = [];
  for (const file of parts.manifest.files) {
    const match = STEP_FILE.exec(file.path);
    if (match === null) continue;
    let text: string;
    try {
      text = await readFile(`${parts.root}/${file.path}`, "utf8");
    } catch {
      return unavailable("migration file cannot be read");
    }
    const from = Number(match[1]);
    const to = Number(match[2]);
    const loss = lossOfStepSql(text);
    if (!loss.ok) return loss;
    const described = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter(
        (line, index, lines) =>
          line.startsWith("--") &&
          lines.slice(0, index).every((before) => before.startsWith("--")),
      )
      .map((line) => line.replace(/^--\s*/, ""))
      .filter((line) => !line.startsWith("loss:"))
      .join(" ");
    const change = dataChangeSchema.safeParse({
      from,
      to,
      script_hash: await sha256Hex(text),
      description: described.length > 0 ? described : `schema ${from} to ${to}`,
      loss: loss.value,
    });
    if (!change.success) return unavailable("migration step is invalid");
    changes.push(change.data);
  }
  return ok(changes.sort((a, b) => a.from - b.from));
}

// 앱의 bundle 사본을 읽는다. 없는 사본·다른 앱의 hash는 undefined다. 사본이 있는데 manifest가 hash와 다르거나
// import map·선언을 읽지 못하면 unavailable이다. 사본 파일은 읽기만 한다.
// `domainNamesOf`를 주면 declaration tool의 domain을 그 앱의 domain 목록에 대조한다(실행하려고 여는 쪽이 준다).
// 목록을 읽지 못하면 unavailable이다. 없으면 domain은 보지 않는다.
export async function readBundleCopy(
  dataRoot: string,
  app: string,
  bundleHash: string,
  domainNamesOf?: DomainNamesOf,
): Promise<Result<BundleParts | undefined>> {
  const copy = bundleCopyPath(dataRoot, app, bundleHash);
  if (!copy.ok) return ok(undefined);
  const root = copy.value;
  let manifestText: string;
  try {
    manifestText = await readFile(`${root}/${MANIFEST_COPY_NAME}`, "utf8");
  } catch (thrown) {
    return errorCode(thrown) === "ENOENT"
      ? ok(undefined)
      : unavailable("bundle copy cannot be read");
  }
  let manifest: BundleManifest;
  try {
    const parsed = bundleManifestSchema.safeParse(JSON.parse(manifestText));
    if (!parsed.success) return unavailable("bundle manifest is invalid");
    manifest = parsed.data;
  } catch {
    return unavailable("bundle manifest is invalid");
  }
  // bundle hash는 manifest의 정규 byte의 sha256이다. 다르면 이 사본은 그 hash가 아니다.
  if ((await sha256Hex(manifestText)) !== bundleHash) {
    return unavailable("bundle copy does not match its hash");
  }
  let declarationText: string;
  try {
    declarationText = await readFile(
      `${root}/${DECLARATION_COPY_NAME}`,
      "utf8",
    );
    await stat(`${root}/${IMPORT_MAP_COPY_NAME}`);
  } catch {
    return unavailable("bundle copy is incomplete");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(declarationText);
  } catch {
    return unavailable("bundle declaration is invalid");
  }
  let domains: string[] | undefined;
  if (domainNamesOf !== undefined) {
    const names = await domainNamesOf(app);
    if (!names.ok) return unavailable("app domains cannot be read");
    domains = names.value;
  }
  const declaration = validateDeclaration(raw, { app, domains });
  if (!declaration.ok) {
    return unavailable(
      `bundle declaration is invalid: ${declaration.error.message}`,
    );
  }
  return ok({
    root,
    manifest,
    entry: `${root}/${manifest.entrypoint}`,
    importMap: `${root}/${IMPORT_MAP_COPY_NAME}`,
    tools: declaration.value.tools,
    screens: Object.fromEntries(
      declaration.value.screens.map((screen) => [
        screen.key,
        [...screen.sizes],
      ]),
    ),
    dataSchema: dataSchemaOf(manifest),
  });
}

// 사본의 앱 자식 flag다. data 영역과 grant에서 푼 요구 permission만 사본 root 읽기에 더해진다.
// 받아 둔 npm·jsr 의존은 사본 안 `vendor/`·`node_modules/`에 있어서 자식은 network도 Deno cache도 쓰지 않는다
// (`--cached-only`는 그대로다). 앱의 deno.json 대신 사본의 플랫폼 설정(`lophn.json`)을 읽는다. 이 설정이 vendor를
// 켜야 하므로 `--no-config`와 jsr module 읽기를 막는 `--no-remote`, npm 읽기를 막는 `--no-npm`은 뺀다.
const VENDOR_REPLACED = ["--no-config", "--no-remote", "--no-npm"];

export function bundleFlags(
  parts: Pick<BundleParts, "root">,
  input: {
    requirements: readonly ResolvedRequirement[];
    dataPath: string;
    platform: PlatformPorts;
    protectedDenies: readonly string[];
  },
): Result<FlagSet> {
  const flags = appFlags(
    input.requirements,
    { bundle: parts.root, data: input.dataPath },
    input.platform,
    input.protectedDenies,
  );
  if (!flags.ok) return flags;
  const args = flags.value.args.filter((arg) => !VENDOR_REPLACED.includes(arg));
  return ok({ ...flags.value, args: args.sort() });
}

// supervisor에 알리는 운영 앱의 원하는 상태다(apps/runtime `DesiredApp`). 사본에서 읽은 부분과 ledger가 정한
// 부분(release·실행 허용·archive·data schema)을 하나로 합친다.
export function desiredFromBundle(
  parts: BundleParts,
  input: {
    app: string;
    release: string;
    bundleHash: string;
    runEnabled: boolean;
    archived: boolean;
    dataSchema: number;
    dataPath: string;
    flags: FlagSet;
  },
): DesiredApp {
  return {
    app: input.app,
    release: input.release,
    bundleHash: input.bundleHash,
    runEnabled: input.runEnabled,
    archived: input.archived,
    tools: parts.tools.map((tool) => tool.name),
    screens: parts.screens,
    dataSchema: input.dataSchema,
    flags: input.flags,
    entry: parts.entry,
    importMap: parts.importMap,
    dataPath: input.dataPath,
  };
}

// preview가 여는 bundle이다. 같은 사본 읽기와 flag 계산에 disposable 영역을 data로 준다. grant가 없는
// preview는 요구 permission이 없다. fixture는 manifest 파일 중 그 경로의 byte다.
export function createCopyPreviewBundles(options: {
  dataRoot: string;
  platformPorts: () => readonly number[];
  domainNamesOf: DomainNamesOf;
}): PreviewBundles {
  return {
    async open(app, bundleHash) {
      const read = await readBundleCopy(
        options.dataRoot,
        app,
        bundleHash,
        options.domainNamesOf,
      );
      if (!read.ok) return read;
      if (read.value === undefined) return ok(undefined);
      const parts = read.value;
      const bundle: PreviewBundle = {
        entry: parts.entry,
        importMap: parts.importMap,
        tools: parts.tools,
        screens: parts.screens,
        dataSchema: parts.dataSchema,
        async fixture(path) {
          const file = parts.manifest.files.find(
            (entry) => entry.path === path,
          );
          if (file === undefined) return undefined;
          try {
            const bytes = await readFile(`${parts.root}/${file.path}`);
            return (await sha256Hex(bytes)) === file.hash ? bytes : undefined;
          } catch {
            return undefined;
          }
        },
        flags(dataPath) {
          return bundleFlags(parts, {
            requirements: [],
            dataPath,
            platform: { ports: [...options.platformPorts()] },
            protectedDenies: [],
          });
        },
      };
      return ok(bundle);
    },
  };
}
