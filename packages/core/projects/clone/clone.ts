// 이 기계에 없는 project를 받아 등록한다. 앱 상자 안이 아니라 사람의 폴더에 쓰므로 순서가 중요하다:
// 임시 폴더에 받고, 맞는 저장소임을 확인한 뒤에만 rename하고, 그 다음에 등록한다.
import {
  err,
  type IdSource,
  type Logger,
  ok,
  type RandomSource,
  type Result,
} from "../../../base/mod.ts";
import type { ProjectRecord } from "../../../protocol/projects/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import { addProject } from "../add.ts";
import { projectByIdentity, projectHoldingIdentity } from "../lookups.ts";
import { PROJECT_CLONE_CONTEXT } from "../registry/contexts.ts";
import { loadProject } from "../registry/store.ts";
import { CLONE_TIMEOUT_MS, type CloneRunner } from "./runner.ts";

export type CloneInput = {
  url: string;
  parent?: string;
  name?: string;
  title?: string;
  identity?: string;
};

export type CloneOutput = {
  project: ProjectRecord;
  path: string;
  cloned: boolean;
};

export type CloneFs = {
  isDir(path: string): Promise<boolean>;
  // 깨진 symlink도 있는 것으로 본다.
  exists(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
};

export type CloneDeps = {
  git: CloneRunner;
  fs: CloneFs;
  ids: IdSource;
  random: RandomSource;
  writer: Pick<Writer, "command">;
  snapshot<T>(read: (sql: Pick<Sql, "get" | "all">) => T): T;
  settings: {
    folder(): string;
    remember(path: string): Promise<void>;
  };
  logger: Logger;
};

const AUTH_FAILED = [
  "Authentication failed",
  "could not read Username",
  "terminal prompts disabled",
  "Permission denied (publickey)",
  "Repository not found",
];
function fail(
  code: "invalid_input" | "conflict" | "unavailable",
  message: string,
  details?: Record<string, unknown>,
): Result<never> {
  return err({ code, message, ...(details === undefined ? {} : { details }) });
}

// token이 remote 설정에 그대로 남으므로 자격이 든 URL은 git을 띄우기 전에 거절한다.
function hasCredentials(url: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)@/i.exec(url);
  if (scheme !== null) {
    return /^https?$/i.test(scheme[1]!) || scheme[2]!.includes(":");
  }
  return /^[^@/]*:[^@/]*@/.test(url);
}

function folderNameOf(url: string): string {
  const last =
    url
      .replace(/[/\\]+$/, "")
      .split(/[/\\:]/)
      .pop() ?? "";
  return last.replace(/\.git$/i, "");
}

function validName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !/[/\\]/.test(name);
}

// 사람이 터미널에서 직접 풀 수 있는 명령이다. 자격은 그 기계의 git·gh·ssh가 갖는다.
function signInCommand(url: string): string {
  const web = /^https:\/\/([^/?#:]+)/i.exec(url);
  if (web !== null && web[1]!.toLowerCase() === "github.com") {
    return "gh auth login";
  }
  const ssh = /^ssh:\/\/(?:([^/?#@]+)@)?([^/?#:]+)(?::(\d+))?/i.exec(url);
  if (ssh !== null) {
    const port = ssh[3] === undefined || ssh[3] === "22" ? "" : `-p ${ssh[3]} `;
    return `ssh -T ${port}${ssh[1] ?? "git"}@${ssh[2]}`;
  }
  const scp = /^(?:([^@/]+)@)?([^/:]{2,}):/.exec(url);
  if (scp !== null && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return `ssh -T ${scp[1] ?? "git"}@${scp[2]}`;
  }
  return `git clone ${url}`;
}

async function alreadyHere(
  identity: string,
  deps: CloneDeps,
): Promise<CloneOutput | null> {
  const project = deps.snapshot((sql) => {
    const id = projectByIdentity(sql, identity);
    if (id === null) return null;
    const loaded = loadProject(sql, id);
    return loaded.ok ? loaded.value : null;
  });
  const first = project?.folders[0];
  if (project === null || first === undefined) return null;
  if (!(await deps.fs.isDir(first.path))) return null;
  const folders = await Promise.all(
    project.folders.map(async (folder) => ({
      ...folder,
      found: await deps.fs.isDir(folder.path),
    })),
  );
  return {
    project: { ...project, folders },
    path: first.path,
    cloned: false,
  };
}

// 받을 부모 폴더다. 설정은 처음 한 번 사람에게 물어 두고, 설정이 비었거나 없어졌을 때 사람이 준 parent를 기억한다.
async function parentFolder(
  input: CloneInput,
  deps: CloneDeps,
): Promise<Result<string>> {
  const remembered = deps.settings.folder();
  if (input.parent === undefined) {
    if (remembered !== "" && (await deps.fs.isDir(remembered))) {
      return ok(remembered);
    }
    return fail(
      "invalid_input",
      "Ask the person which folder to keep projects in on this computer, then pass it as parent",
      { reason: "projects_folder_unset" },
    );
  }
  if (!(await deps.fs.isDir(input.parent))) {
    return fail("invalid_input", `parent is not a folder: ${input.parent}`);
  }
  if (remembered === "" || !(await deps.fs.isDir(remembered))) {
    await deps.settings.remember(input.parent);
  }
  return ok(input.parent);
}

// identity는 사람만 준다(창의 [Clone to this computer]가 그 컴퓨터의 project 목록에서 url과 id를 함께 읽는다). agent가 주면
// 다른 저장소를 그 project로 등록해 틀린 짝이 다른 컴퓨터로 퍼질 수 있다. agent의 clone은 새 id로 등록하고 자동 match가
// remote key로 잇는다.
export async function cloneProject(
  input: CloneInput,
  deps: CloneDeps,
  caller: "person" | "agent",
): Promise<Result<CloneOutput>> {
  if (input.identity !== undefined && caller !== "person") {
    return err({
      code: "forbidden",
      message:
        "only the person brings a project's identity to a clone; clone without it and lophn matches the project by its repository",
    });
  }
  if (hasCredentials(input.url)) {
    return fail(
      "invalid_input",
      "The URL carries a credential, which would stay in the repository's remote settings. Use a URL without it; this computer's git sign-in is used",
    );
  }
  if (input.identity !== undefined) {
    const here = await alreadyHere(input.identity, deps);
    if (here !== null) return ok(here);
    // 그 id를 가진 project가 폴더를 잃었거나 사람이 나눠 옛 id로 갖고 있다. 받아도 등록하지 못한다.
    const holder = deps.snapshot((sql) =>
      projectHoldingIdentity(sql, input.identity!),
    );
    if (holder !== null) {
      return fail(
        "conflict",
        "Another project on this computer has this project's identity. Relink that project's folder instead of cloning",
        { reason: "identity_in_use", project: holder },
      );
    }
  }

  const parent = await parentFolder(input, deps);
  if (!parent.ok) return parent;
  const name = input.name ?? folderNameOf(input.url);
  if (!validName(name)) {
    return fail("invalid_input", `not a usable folder name: "${name}"`);
  }
  const target = `${parent.value.replace(/[/\\]+$/, "")}/${name}`;
  const taken = (): Result<never> =>
    fail("conflict", `${target} already exists`, {
      reason: "target_exists",
      path: target,
    });
  if (await deps.fs.exists(target)) return taken();

  const bytes = new Uint8Array(6);
  deps.random.fill(bytes);
  const staging = `${parent.value.replace(/[/\\]+$/, "")}/.lophn-clone-${Array.from(
    bytes,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")}`;
  const run = await deps.git({
    argv: ["clone", "--quiet", "--", input.url, staging],
    timeoutMs: CLONE_TIMEOUT_MS,
  });
  if (run.kind !== "done" || run.code !== 0) {
    await deps.fs.rm(staging);
    if (run.kind === "not_found") {
      return fail(
        "unavailable",
        "git was not found; install git and make sure it is on PATH",
        {
          reason: "git_not_found",
        },
      );
    }
    if (run.kind === "timeout") {
      return fail("unavailable", "git clone took too long and was stopped", {
        reason: "timeout",
      });
    }
    if (AUTH_FAILED.some((text) => run.stderr.includes(text))) {
      const command = signInCommand(input.url);
      return fail(
        "unavailable",
        `git on this computer is not signed in to read this repository. Ask the person to run \`${command}\` in a terminal, then try again`,
        { reason: "git_auth", command },
      );
    }
    const line = run.stderr.trim().split("\n").at(-1) ?? "";
    return fail("unavailable", `git clone failed: ${line.slice(0, 300)}`, {
      reason: "git_failed",
    });
  }

  // rename은 비어 있는 폴더 위에 덮을 수 있으므로 바로 앞에서 한 번 더 본다.
  if (await deps.fs.exists(target)) {
    await deps.fs.rm(staging);
    return taken();
  }
  await deps.fs.rename(staging, target);

  // 등록이 실패해도 받은 폴더는 지우지 않는다. 사람이 받은 것을 잃게 된다.
  const project = await addProject(
    PROJECT_CLONE_CONTEXT,
    {
      title: input.title ?? name,
      purpose: "",
      folders: [{ path: target, description: "" }],
      ...(input.identity === undefined ? {} : { identity: input.identity }),
    },
    deps,
  );
  if (!project.ok) {
    deps.logger.error({
      component: "projects-clone",
      event: "register_failed",
      message: `cloned ${target} but could not register it: ${project.error.message}`,
    });
    return err({
      ...project.error,
      details: { ...project.error.details, path: target },
    });
  }
  return ok({ project: project.value, path: target, cloned: true });
}
