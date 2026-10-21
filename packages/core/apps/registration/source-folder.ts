// 앱의 source 폴더를 `app.create`가 commit된 뒤 core가 만들어 잇고, `app.connect_source`가 받는 폴더를 확인한다.
// tx 안에서는 파일과 git을 만질 수 없고 폴더 자리가 앱 id에 달려 있어서(id는 tx 안에서 정해진다) writer 앞에서 한다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type App,
  appConnectSource,
  appCreate,
} from "../../../protocol/apps/mod.ts";
import { appDefaultSource } from "../../../protocol/apps/app-storage.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import { builtinTemplate } from "../packages/template/files.ts";
import { scaffoldApp } from "../packages/template/scaffold.ts";

// 새 앱의 source를 잇는 core 안 machine 자격이다. 기록이 없으면 writer가 거절한다.
export const SOURCE_FOLDER_PRINCIPAL = "machine:apps-source";
export const SOURCE_FOLDER_CONTEXT: AuthenticatedContext = {
  principal: SOURCE_FOLDER_PRINCIPAL,
  actor: "machine",
  scope: { operations: [appConnectSource.name], targets: {} },
  conditions: {},
  credential_ref: SOURCE_FOLDER_PRINCIPAL,
};

type ScaffoldTarget = Pick<App, "id" | "slug" | "name">;

// 사람의 git 설정(서명, hook, 이름)을 읽지 않는다.
async function git(dir: string, ...args: string[]): Promise<Result<string>> {
  const out = await new Deno.Command("git", {
    args: ["-C", dir, ...args],
    env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  return out.success ? ok(new TextDecoder().decode(out.stdout).trim()) : err({
    code: "unavailable",
    message: `git ${args[0]} failed: ${new TextDecoder().decode(out.stderr)}`,
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (thrown) {
    if (thrown instanceof Deno.errors.NotFound) return false;
    throw thrown;
  }
}

// 앱의 기본 source 자리(`appDefaultSource`)에 template을 깐다. 임시 폴더에서 commit까지 만든 뒤 옮겨, 있는 폴더는 늘 commit이 있다.
// 이미 있는 폴더는 commit이 있을 때만(앞서 깔다 연결 전에 끊긴 경우) 그대로 쓰고 아니면 덮지 않고 오류다.
// 새 저장소에는 저장소 안 git 설정을 남긴다. 이어서 App Engineer가 commit할 때 사람의 전역 이름에 기대지 않게 한다.
async function scaffold(
  target: ScaffoldTarget,
  dataRoot: string,
): Promise<Result<string>> {
  const dir = appDefaultSource(dataRoot, target.id);
  try {
    if (await exists(dir)) {
      const head = await git(dir, "rev-parse", "--verify", "HEAD");
      if (!head.ok) {
        return err({
          code: "conflict",
          message: `${dir} exists and is not a committed repository`,
        });
      }
    } else {
      const files = await builtinTemplate(`${dataRoot}/templates/app`);
      if (!files.ok) return files;
      const staging = `${dir}.new`;
      await Deno.remove(staging, { recursive: true }).catch(() => {});
      const made = await scaffoldApp({
        files: files.value,
        dir: staging,
        app: target.slug,
        title: target.name,
      });
      if (!made.ok) return made;
      for (
        const step of [
          ["init", "-q"],
          ["config", "user.name", "lophn"],
          ["config", "user.email", "lophn@localhost"],
          ["config", "commit.gpgsign", "false"],
          ["add", "-A"],
          ["commit", "-q", "-m", "Start from the app template"],
        ]
      ) {
        const done = await git(staging, ...step);
        if (!done.ok) return done;
      }
      await Deno.rename(staging, dir);
    }
    // 개발용 import map은 이 장치의 위치를 담는 파생물(.lophn/, ignore)이라 자리가 정해진 뒤에 쓴다.
    const mapped = await scaffoldApp({
      files: [],
      dir,
      app: target.slug,
      dataRoot,
    });
    if (!mapped.ok) return mapped;
    return ok(dir);
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: thrown instanceof Error ? thrown.message : String(thrown),
    });
  }
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 연결할 폴더는 있고, git 저장소의 맨 위이고, commit이 있어야 한다. release 준비가 같은 경계로 읽으므로
// 연결 때 막아 준비에서 처음 알게 되지 않게 한다.
async function requireCommittedRepository(
  path: string,
): Promise<Result<void>> {
  try {
    let real: string;
    try {
      real = await Deno.realPath(path);
    } catch (thrown) {
      if (thrown instanceof Deno.errors.NotFound) {
        return invalid("the source folder does not exist");
      }
      throw thrown;
    }
    const top = await git(real, "rev-parse", "--show-toplevel");
    if (!top.ok) return invalid("the source folder is not a git repository");
    if (await Deno.realPath(top.value) !== real) {
      return invalid("the source folder is not the top of a git repository");
    }
    const head = await git(real, "rev-parse", "--verify", "HEAD");
    return head.ok ? ok(undefined) : invalid("the source folder has no commit");
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: thrown instanceof Error ? thrown.message : String(thrown),
    });
  }
}

// `app.connect_source`는 받기 전에 폴더를 확인한다. `app.create`가 처음 성공하면 source를 깔아 이은 앱을 결과로 돌려준다.
// 깔기나 잇기가 실패해도 create는 이미 commit됐으므로 오류로 바꾸지 않는다. 앱은 `source_path: null`로 남고
// `app.link_source`로 잇는다. 다시 시도하지 않는다.
export function withSourceFolder(
  inner: Writer,
  deps: {
    dataRoot: string;
    // 잇기도 전체 writer를 지난다.
    writer(): Writer;
  },
): Writer {
  return {
    ...inner,
    async command(ctx, envelope) {
      if (envelope.command === appConnectSource.name) {
        const path = (envelope.input as { source_path?: unknown }).source_path;
        if (typeof path === "string") {
          const checked = await requireCommittedRepository(path);
          if (!checked.ok) return checked;
        }
        return await inner.command(ctx, envelope);
      }
      const done = await inner.command(ctx, envelope);
      if (
        !done.ok || done.value.replayed || envelope.command !== appCreate.name
      ) return done;
      const app = done.value.result as App;
      const fail = (reason: string) => {
        console.error(`app ${app.id}: source folder not prepared: ${reason}`);
        return done;
      };
      const dir = await scaffold(app, deps.dataRoot);
      if (!dir.ok) return fail(dir.error.message);
      const linked = await deps.writer().command(SOURCE_FOLDER_CONTEXT, {
        command: appConnectSource.name,
        input: { app: app.id, source_path: dir.value },
        idempotency_key: crypto.randomUUID(),
        compare: { base_revision: app.revision },
        prepared: [],
      });
      return linked.ok
        ? ok({ ...done.value, result: linked.value.result })
        : fail(linked.error.message);
    },
  };
}
