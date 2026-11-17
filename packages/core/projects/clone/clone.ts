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
import {
  PROJECT_IDENTITY_FILE,
  parseIdentityFile,
  projectApi,
  type ProjectRecord,
} from "../../../protocol/projects/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import { projectByIdentity } from "../lookups.ts";
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
  note: string | null;
};

export type CloneFs = {
  isDir(path: string): Promise<boolean>;
  // 깨진 symlink도 있는 것으로 본다.
  exists(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
  // 없으면 null이다.
  readText(path: string): Promise<string | null>;
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

const NAME_ATTEMPTS = 5;
const SLUG_MAX = 63;
const AUTH_FAILED = [
  "Authentication failed",
  "could not read Username",
  "terminal prompts disabled",
  "Permission denied (publickey)",
  "Repository not found",
];
const NO_IDENTITY_FILE = `This repository has no ${PROJECT_IDENTITY_FILE} yet. Commit and push it on the other computer, then pull here; lophn links the project when the file arrives.`;
const UNREADABLE_IDENTITY_FILE = `This repository's ${PROJECT_IDENTITY_FILE} cannot be read; this lophn may be older than the one that wrote it. Update lophn or fix the file.`;
const UNKNOWN_IDENTITY =
  " lophn could not check that this is the project you meant.";

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

// 사람에게 보이는 이름이라 slug는 그 이름에서 만들고 겹치면 번호를 붙인다(core-source.ts의 slugOf와 같은 규칙).
function slugOf(title: string): string {
  const words = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const start = /^[a-z]/.test(words)
    ? words
    : words === ""
      ? "project"
      : `project-${words}`;
  return start.slice(0, SLUG_MAX).replace(/-+$/, "");
}

function slugAttempt(base: string, attempt: number): string {
  if (attempt === 1) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
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
    note: "already on this computer",
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

async function register(
  target: string,
  input: CloneInput,
  name: string,
  deps: CloneDeps,
): Promise<Result<ProjectRecord>> {
  const id = deps.ids.newId("prj");
  const title = input.title ?? name;
  const base = slugOf(title);
  let last: Result<ProjectRecord> = fail("conflict", "project name is taken");
  for (let attempt = 1; attempt <= NAME_ATTEMPTS; attempt += 1) {
    const done = await deps.writer.command(PROJECT_CLONE_CONTEXT, {
      command: projectApi.register.name,
      input: {
        id,
        name: slugAttempt(base, attempt),
        title,
        purpose: "",
        folders: [{ path: target, description: "" }],
      },
      idempotency_key: `clone-${id}-${attempt}`,
      compare: {},
      prepared: [],
    });
    if (done.ok) return ok(done.value.result as ProjectRecord);
    last = done;
    if (done.error.code !== "conflict") break;
  }
  return last;
}

export async function cloneProject(
  input: CloneInput,
  deps: CloneDeps,
): Promise<Result<CloneOutput>> {
  if (hasCredentials(input.url)) {
    return fail(
      "invalid_input",
      "The URL carries a credential, which would stay in the repository's remote settings. Use a URL without it; this computer's git sign-in is used",
    );
  }
  if (input.identity !== undefined) {
    const here = await alreadyHere(input.identity, deps);
    if (here !== null) return ok(here);
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

  let note: string | null = null;
  const text = await deps.fs.readText(`${staging}/${PROJECT_IDENTITY_FILE}`);
  const read = text === null ? null : parseIdentityFile(text);
  if (read === null) {
    note = NO_IDENTITY_FILE;
  } else if (read.kind === "unreadable") {
    note =
      input.identity === undefined
        ? UNREADABLE_IDENTITY_FILE
        : UNREADABLE_IDENTITY_FILE + UNKNOWN_IDENTITY;
  } else if (input.identity !== undefined && read.id !== input.identity) {
    await deps.fs.rm(staging);
    return fail(
      "conflict",
      "This repository is a different project than the one you meant",
      { reason: "different_project", identity: read.id },
    );
  }

  // rename은 비어 있는 폴더 위에 덮을 수 있으므로 바로 앞에서 한 번 더 본다.
  if (await deps.fs.exists(target)) {
    await deps.fs.rm(staging);
    return taken();
  }
  await deps.fs.rename(staging, target);

  // 등록이 실패해도 받은 폴더는 지우지 않는다. 사람이 받은 것을 잃게 된다.
  const project = await register(target, input, name, deps);
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
  return ok({ project: project.value, path: target, cloned: true, note });
}
