// source 폴더가 없는 앱을 coding agent에게 맡기기 전에 core가 template을 깔고 commit해 앱에 잇는다.
// tx 안에서는 파일과 git을 만질 수 없어서 call을 받는 writer 바로 앞에서 한다. 연결은 이미 있는 source 연결 command다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { appConnectSource } from "../../../../protocol/apps/mod.ts";
import { appDefaultSource } from "../../../../protocol/apps/app-storage.ts";
import { callSend } from "../../../../protocol/lophn-agent/calls.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import type { CommandEnvelope, Writer } from "../../../storage/ledger/mod.ts";
import { builtinTemplate } from "../../packages/template/files.ts";
import { scaffoldApp } from "../../packages/template/scaffold.ts";
import { startFailure } from "./launch.ts";

type ScaffoldTarget = {
  id: string;
  project: string;
  slug: string;
  name: string;
  revision: string;
};

// call의 받는 이름이 source 없는 앱의 coding agent일 때 그 앱이다. 이름 풀기는 Router와 같다(id, slug 또는 name).
export function sourcelessAppNamed(
  sql: Pick<Sql, "get">,
  name: string,
): ScaffoldTarget | null {
  const row = sql.get(
    "select id, project, slug, name, revision from apps where (id = ? or slug = ? or name = ?) and source_path is null",
    [name, name, name],
  );
  return row === undefined ? null : {
    id: String(row["id"]),
    project: String(row["project"]),
    slug: String(row["slug"]),
    name: String(row["name"]),
    revision: String(row["revision"]),
  };
}

// 사람의 git 설정(서명, hook, 이름)을 읽지 않는다.
async function git(dir: string, ...args: string[]): Promise<Result<string>> {
  const out = await new Deno.Command("git", {
    args: [
      "-c",
      "user.name=lophn",
      "-c",
      "user.email=lophn@localhost",
      "-c",
      "commit.gpgsign=false",
      "-C",
      dir,
      ...args,
    ],
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
        const step of [["init", "-q"], ["add", "-A"], [
          "commit",
          "-q",
          "-m",
          "Start from the app template",
        ]]
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

// `call`이 source 없는 앱의 coding agent에게 가면 보내기 전에 source를 깔고 잇는다. 잇기는 보낸 Project Manager의
// 자격으로 한다(자기 앱의 source 연결은 그 자격이 이미 가진다).
export function withScaffoldedSource(
  inner: Writer,
  deps: {
    dataRoot: string;
    // 읽기는 호출 때 ledger를 짧게 열어 한다.
    find(name: string): ScaffoldTarget | null;
    // 연결도 전체 writer를 지난다.
    writer(): Writer;
  },
): Writer {
  return {
    ...inner,
    async command(ctx: AuthenticatedContext, envelope: CommandEnvelope) {
      if (envelope.command !== callSend.name) {
        return await inner.command(ctx, envelope);
      }
      const { to } = envelope.input as { to: Record<string, unknown> };
      const place = to["place"] as { app?: string } | undefined;
      const target = to["role"] === "coding_agent" &&
          place?.app !== undefined
        ? deps.find(place.app)
        : null;
      if (target === null) return await inner.command(ctx, envelope);
      const dir = await scaffold(target, deps.dataRoot);
      if (!dir.ok) {
        return startFailure(
          "no_source_folder",
          `the app has no source folder and one could not be prepared: ${dir.error.message}`,
        );
      }
      const linked = await deps.writer().command(ctx, {
        command: appConnectSource.name,
        input: { app: target.id, source_path: dir.value },
        idempotency_key: crypto.randomUUID(),
        compare: { base_revision: target.revision },
        prepared: [],
      });
      if (!linked.ok) return linked;
      return await inner.command(ctx, envelope);
    },
  };
}
