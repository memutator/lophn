// package.publish. 그 앱 workspace의 session이 자기 앱 code의 일부를 @me package로 낸다.
// 낼 때 사람 승인은 없다. 낸 version은 바뀌지 않는다.

import type { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  PackagePublishInput,
  PackageRegisterVersionInput,
  packageRegisterVersionOutputSchema,
} from "../../../protocol/apps/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import {
  extractCommit,
  type GitRunner,
  gitCommandRunner,
} from "../releases/mod.ts";
import {
  bundleBytes,
  INSTALL_PRINCIPAL,
  type PrepareBlob,
  packageInstallPath,
  prepareBundleBlobs,
  prepareCopyFiles,
  removeInstallCopy,
  sameInstallCopy,
  writeInstallCopy,
} from "./install.ts";

type RegisterOutput = z.infer<typeof packageRegisterVersionOutputSchema>;

type PublishDeps = {
  dataRoot: string;
  // 앱에 연결된 source 폴더(app.source_path). 연결 안 된 앱은 err다.
  sourceRootOf: (app: string) => Promise<Result<string>> | Result<string>;
  prepareBlob: PrepareBlob;
  // machine 자격으로 package.register_version을 ledger command로 넣는다.
  registerVersion: (
    input: PackageRegisterVersionInput,
  ) => Promise<Result<RegisterOutput>>;
  git?: GitRunner;
};

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 안내 글은 세 절이고 이 byte가 guide_hash가 된다.
function guideText(guide: PackagePublishInput["guide"]): string {
  return (
    `# Purpose\n\n${guide.purpose.trim()}\n\n# API\n\n${guide.api.trim()}\n\n` +
    `# Examples\n\n${guide.examples.trim()}\n`
  );
}

export function publishPackage(deps: PublishDeps): MemoryHandler {
  return async (ctx, raw) => {
    const input = raw as PackagePublishInput;
    // 그 앱 workspace의 session만 낸다(credential의 app 조건이 그 앱을 고정한다).
    if (!ctx.actor.startsWith("agent:") || ctx.conditions.app !== input.app) {
      return err({
        code: "forbidden",
        message: "only a session in the app's workspace publishes its packages",
      });
    }
    if (!input.name.startsWith("@me/")) {
      return invalid("published package name must be @me/...");
    }
    const source = await deps.sourceRootOf(input.app);
    if (!source.ok) return source;
    // agent runtime child는 git을 못 띄우므로 HEAD도 core가 읽는다.
    const git = deps.git ?? gitCommandRunner();
    const head = await git.run(["-C", source.value, "rev-parse", "HEAD"]);
    if (!head.ok) {
      return err({
        code: "unavailable",
        message: "cannot read HEAD of the app source (is anything committed?)",
      });
    }
    const commit = new TextDecoder().decode(head.value).trim();
    if (!/^[0-9a-f]{40}$/.test(commit)) {
      return invalid("the app source HEAD is not a commit");
    }
    const extracted = await extractCommit(git, {
      sourceRoot: source.value,
      commit,
    });
    if (!extracted.ok) {
      const reason = extracted.error.reason;
      return err({
        code: reason === "git_failed" ? "unavailable" : "invalid_input",
        message: `package source cannot be read: ${reason}`,
      });
    }
    const prefix = `${input.path.replace(/\/+$/, "")}/`;
    const files = extracted.value
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => ({
        path: file.path.slice(prefix.length),
        bytes: file.bytes,
      }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    if (files.length === 0) {
      return invalid("package folder is missing or empty in the commit");
    }
    const path = packageInstallPath(input.name, input.version);
    if (!path.ok) return path;
    // 사본은 package.json을 갖고, 그 안의 @lophn·@me 의존은 설치 사본 사이의 `file:` 경로다.
    const copy = prepareCopyFiles(input.name, input.version, files);
    if (!copy.ok) return copy;

    const bundle = bundleBytes(files);
    const guide = new TextEncoder().encode(guideText(input.guide));
    const prepared = await prepareBundleBlobs(
      bundle,
      guide,
      INSTALL_PRINCIPAL,
      deps.prepareBlob,
    );
    if (!prepared.ok) return prepared;
    const registered = await deps.registerVersion({
      name: input.name,
      description: input.description,
      kind: null,
      version: input.version,
      owner_app: input.app,
      permissions: input.permissions,
      bundle_hash: prepared.value.bundleHash,
      guide_hash: prepared.value.guideHash,
      ...(prepared.value.guideBlob === undefined
        ? {}
        : { guide_blob: prepared.value.guideBlob }),
    });
    if (!registered.ok) return registered;

    // 읽기 전용 설치 사본. 같은 byte의 사본이 이미 있으면(재시도) 그대로 둔다.
    const target = `${deps.dataRoot}/${path.value}`;
    if (!(await sameInstallCopy(target, copy.value))) {
      await removeInstallCopy(target);
      const written = await writeInstallCopy(target, copy.value);
      if (!written.ok) return written;
    }
    return ok(registered.value);
  };
}
