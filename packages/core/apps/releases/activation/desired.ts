// 봉인 bundle 사본에서 앱 자식의 시작 입력을 만든다. 운영 DesiredApp과
// preview의 `PreviewBundle`이 같은 함수로 사본의 entry·화면·data schema를 읽는다.
// 사본의 모양: manifest.json, declaration.json, 앱 code와 build한 screens/, 설치 SDK 사본
// sdk/<이름>/<version>/, 앱 node_modules. 파일은 async로만 읽는다(core module graph).
import { readFile } from "node:fs/promises";

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
  type CommandDeclaration,
  requiredHandlerNames,
  subscriptionHandlerName,
  type OperationDeclaration,
  type SubscriptionDeclaration,
  validateDeclaration,
} from "../../declaration/mod.ts";
import { declaredPhoneCapabilities } from "../../phone/capabilities.ts";
import type { PreviewBundle, PreviewBundles } from "../../preview/mod.ts";
import type { DesiredApp } from "../../runtime/mod.ts";
import {
  bundleCopyPath,
  DECLARATION_COPY_NAME,
  MANIFEST_COPY_NAME,
} from "../bundle/seal.ts";

type BundleParts = {
  // 사본 root. 자식의 cwd와 상대 경로의 기준이다.
  root: string;
  manifest: BundleManifest;
  entry: string;
  operations: OperationDeclaration[];
  commands: CommandDeclaration[];
  // 구독 handler(`on.<source>.<event>`)도 선언한 handler 이름이라 빠지면 준비 때 "handler not declared"로 거절된다.
  subscriptions: SubscriptionDeclaration[];
  // 선언이 `phone.use`로 선언한 폰 기능(preview가 쓸 수 있는 기능).
  phoneCapabilities: string[];
  // migrations/<from>-<to>.sql 단계의 가장 큰 도착 schema다. 단계가 없으면 0이다.
  dataSchema: number;
  // 선언 `runs_on`에 computer가 있다(없으면 `["computer"]`). 폰에서만 도는 앱은 컴퓨터에 process도 DB도 없다.
  runsOnComputer: boolean;
};

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
// 선언을 읽지 못하면 unavailable이다. 사본 파일은 읽기만 한다.
export async function readBundleCopy(
  dataRoot: string,
  app: string,
  bundleHash: string,
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
  } catch {
    return unavailable("bundle copy is incomplete");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(declarationText);
  } catch {
    return unavailable("bundle declaration is invalid");
  }
  const declaration = validateDeclaration(raw, { app });
  if (!declaration.ok) {
    return unavailable(
      `bundle declaration is invalid: ${declaration.error.message}`,
    );
  }
  return ok({
    root,
    manifest,
    entry: `${root}/${manifest.entrypoint}`,
    operations: declaration.value.operations,
    commands: declaration.value.commands,
    subscriptions: declaration.value.subscriptions ?? [],
    phoneCapabilities: declaredPhoneCapabilities(declaration.value.permissions),
    dataSchema: dataSchemaOf(manifest),
    runsOnComputer: (declaration.value.runs_on ?? ["computer"]).includes(
      "computer",
    ),
  });
}

// supervisor에 알리는 운영 앱의 원하는 상태다(apps/runtime `DesiredApp`). 사본에서 읽은 부분과 ledger가 정한
// 부분(release·실행 허용·archive·data schema)을 하나로 합친다. 폰에서만 도는 앱은 실행을 허용해도 컴퓨터에서 띄우지 않는다.
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
  },
): DesiredApp {
  return {
    app: input.app,
    release: input.release,
    bundleHash: input.bundleHash,
    runEnabled: input.runEnabled && parts.runsOnComputer,
    archived: input.archived,
    tools: requiredHandlerNames(parts),
    subscribed: parts.subscriptions.map(subscriptionHandlerName),
    dataSchema: input.dataSchema,
    entry: parts.entry,
    dataPath: input.dataPath,
  };
}

// preview가 여는 bundle이다. 같은 사본 읽기에 disposable 영역을 data로 준다. fixture는 manifest 파일 중
// 그 경로의 byte다.
export function createCopyPreviewBundles(options: {
  dataRoot: string;
}): PreviewBundles {
  return {
    async open(app, bundleHash) {
      const read = await readBundleCopy(options.dataRoot, app, bundleHash);
      if (!read.ok) return read;
      if (read.value === undefined) return ok(undefined);
      const parts = read.value;
      const bundle: PreviewBundle = {
        entry: parts.entry,
        operations: parts.operations,
        commands: parts.commands,
        subscriptions: parts.subscriptions,
        phoneCapabilities: parts.phoneCapabilities,
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
      };
      return ok(bundle);
    },
  };
}
