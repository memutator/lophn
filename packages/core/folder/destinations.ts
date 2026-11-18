// destination: 기계마다의 이름 → 그 기계의 절대 경로. 앱은 선언 `sync_to`로 이름만 고른다.
// 설정은 기계를 넘지 않는다. 사람의 data가 data root를 떠나기 시작하는 일이라 agent의 바꾸기는 사람의 승인이다.
// data root와 겹치는 경로는 쓰이지 않는다: 바꿀 때 check가 거절하고, 사람이 settings.json을 손으로 고쳐 check를 지나친
// 값은 `createDestinations`가 없는 것으로 본다.
// 미리 있는 갈 곳 `computers`("내 컴퓨터들")는 data root 안 `computers/`이고 늘 목록에 선다. 그 file을 다른 컴퓨터로
// 옮기는 길은 lophn이 고른다(받는 자리 `replica.ts`, 사람의 폴더 `folder.shared`의 거울 `mirror.ts`).
import {
  accessSync,
  constants,
  mkdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  declareSetting,
  type SettingDeclaration,
  type SettingIssue,
  type SettingsReader,
} from "../../protocol/config/mod.ts";
import {
  DESTINATIONS_MAX,
  destinationNameSchema,
  type DestinationState,
} from "../../protocol/folder/mod.ts";
import {
  COMPUTERS_DESTINATION,
  COMPUTERS_DIR,
  SHARED_FOLDER_KEY,
} from "../../protocol/remote/carry.ts";

export const DESTINATIONS_KEY = "folder.destinations";

const destinationsType = z
  .record(
    destinationNameSchema,
    z.strictObject({ path: z.string().regex(/^(\/|[A-Za-z]:\\).+/) }),
  )
  .refine((value) => Object.keys(value).length <= DESTINATIONS_MAX, {
    message: `at most ${DESTINATIONS_MAX} destinations`,
  });

export type Destinations = z.output<typeof destinationsType>;

// symlink를 따라간 경로와 글자 그대로의 경로 둘 다. 아직 없는 경로는 글자 그대로만이다.
function forms(path: string): string[] {
  const lexical = resolve(path);
  try {
    return [lexical, realpathSync.native(lexical)];
  } catch {
    return [lexical];
  }
}

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

function overlaps(a: string, b: string): boolean {
  const as = forms(a);
  const bs = forms(b);
  return as.some((x) => bs.some((y) => inside(x, y) || inside(y, x)));
}

/** 이름마다 쓰지 못하는 까닭. 비어 있으면 그 이름은 쓸 수 있다. */
export function destinationProblems(
  value: Destinations,
  dataRoot: string,
): Map<string, string> {
  const problems = new Map<string, string>();
  const names = Object.keys(value);
  for (const name of names) {
    const path = value[name]!.path;
    if (name === COMPUTERS_DESTINATION) {
      problems.set(name, `"${name}" is reserved for your computers`);
    } else if (!isAbsolute(path)) {
      problems.set(name, `"${name}" must be an absolute path`);
    } else if (overlaps(path, dataRoot)) {
      problems.set(
        name,
        `"${name}" (${path}) is inside the lophn data folder or contains it`,
      );
    } else {
      const other = names.find(
        (each) => each !== name && overlaps(path, value[each]!.path),
      );
      if (other !== undefined) {
        problems.set(
          name,
          `"${name}" (${path}) is the same as or inside "${other}"`,
        );
      }
    }
  }
  return problems;
}

/** 바뀜을 사람의 말로: 이름 순으로 더하기, 바꾸기, 지우기 한 줄씩. 경로는 줄이지 않는다. */
export function describeDestinations(
  before: Destinations | undefined,
  after: Destinations | undefined,
): string[] {
  const was = before ?? {};
  const now = after ?? {};
  return [...new Set([...Object.keys(was), ...Object.keys(now)])]
    .sort()
    .flatMap((name) => {
      const old = was[name]?.path;
      const next = now[name]?.path;
      if (old === next) return [];
      if (old === undefined) return [`Add sync folder "${name}": ${next}`];
      if (next === undefined) return [`Remove sync folder "${name}" (${old})`];
      return [`Change sync folder "${name}": ${old} → ${next}`];
    });
}

/** data root를 아는 조립이 만든다. 사람 자격은 바로 두고, agent가 바꾸면 사람이 승인 카드에서 그 한 번을 허락한다. */
export function destinationsSetting(
  dataRoot: string,
): SettingDeclaration<typeof destinationsType> {
  return declareSetting({
    key: DESTINATIONS_KEY,
    type: destinationsType,
    default: {},
    description:
      "Sync folders on this computer: a name mapped to an absolute folder path. An app picks one by name with `sync_to`, and lophn writes and reads that app's data there; an outside tool moves the folder between machines. When you change it, the person is asked to allow that exact change.",
    approval: "person",
    describe: describeDestinations,
    check: (value, view): SettingIssue[] => {
      const issues: SettingIssue[] = [
        ...destinationProblems(value, dataRoot).values(),
      ].map((message) => ({ level: "reject", message }));
      // 사람의 폴더와 겹치면 그 폴더가 말없이 쓰이지 않게 된다. 어느 설정을 먼저 바꾸어도 거절한다.
      const shared = view.get(sharedFolderSetting(dataRoot)) ?? null;
      const problem =
        shared === null ? null : sharedFolderProblem(shared, dataRoot, value);
      return problem === null
        ? issues
        : [...issues, { level: "reject", message: problem }];
    },
  });
}

const sharedType = z
  .strictObject({ path: z.string().regex(/^(\/|[A-Za-z]:\\).+/) })
  .nullable();

export type SharedFolder = z.output<typeof sharedType>;

/** 사람의 폴더가 쓰지 못하는 까닭. data root나 이름 붙인 폴더와 같거나 서로 안에 있으면 쓰지 않는다. */
export function sharedFolderProblem(
  value: SharedFolder,
  dataRoot: string,
  destinations: Destinations,
): string | null {
  if (value === null) return null;
  const { path } = value;
  if (!isAbsolute(path)) return "the shared folder must be an absolute path";
  if (overlaps(path, dataRoot)) {
    return `the shared folder (${path}) is inside the lophn data folder or contains it`;
  }
  const other = Object.keys(destinations).find((name) =>
    overlaps(path, destinations[name]!.path),
  );
  return other === undefined
    ? null
    : `the shared folder (${path}) is the same as or inside sync folder "${other}"`;
}

function describeShared(
  before: SharedFolder | undefined,
  after: SharedFolder | undefined,
): string[] {
  const old = before?.path;
  const next = after?.path;
  if (old === next) return [];
  if (old === undefined) {
    return [`Use a folder all your computers see: ${next}`];
  }
  if (next === undefined) {
    return [`Stop using the folder all your computers see (${old})`];
  }
  return [`Change the folder all your computers see: ${old} → ${next}`];
}

/** "내 컴퓨터들이 같이 보는 폴더". destination과 같이 사람의 승인이다(사람의 data가 그 폴더로 나가기 시작한다). */
export function sharedFolderSetting(
  dataRoot: string,
): SettingDeclaration<typeof sharedType> {
  const destinations = destinationsSetting(dataRoot);
  return declareSetting({
    key: SHARED_FOLDER_KEY,
    type: sharedType,
    default: null,
    description:
      "A folder all your computers see, like a disk both systems of a dual boot share or a folder Google Drive or Syncthing moves. Each computer puts its own carried files there and takes in the others' files after checking their signatures, so the folder does not need to be trusted. When you change it, the person is asked to allow that exact change.",
    approval: "person",
    describe: describeShared,
    check: (value, view): SettingIssue[] => {
      const problem = sharedFolderProblem(
        value,
        dataRoot,
        view.get(destinations) ?? {},
      );
      return problem === null ? [] : [{ level: "reject", message: problem }];
    },
  });
}

export type ResolvedDestination = { path: string; state: DestinationState };

export type DestinationsView = {
  /** 쓸 수 있는 destination(이름 순). 겹치거나 상대 경로인 것은 빠진다. `computers`는 늘 있다. */
  list(): ({ name: string } & ResolvedDestination)[];
  /** 이 기계에 그 이름이 없거나 쓸 수 없는 값이면 null. */
  resolve(name: string): ResolvedDestination | null;
};

export function stateOf(path: string): DestinationState {
  try {
    if (!statSync(path).isDirectory()) return "missing";
  } catch {
    return "missing";
  }
  try {
    accessSync(path, constants.W_OK);
    return "ok";
  } catch {
    return "not_writable";
  }
}

// 겹치지 않는 이름 붙인 폴더.
function namedDestinations(deps: {
  dataRoot: string;
  settings: SettingsReader;
}): Destinations {
  const value = deps.settings.get(destinationsSetting(deps.dataRoot)) ?? {};
  const problems = destinationProblems(value, deps.dataRoot);
  return Object.fromEntries(
    Object.entries(value).filter(([name]) => !problems.has(name)),
  );
}

/** 쓸 수 있는 사람의 폴더(`folder.shared`) 경로. 없거나 겹치면(손으로 고친 settings.json) null. */
export function sharedFolderPath(deps: {
  dataRoot: string;
  settings: SettingsReader;
}): string | null {
  const value = deps.settings.get(sharedFolderSetting(deps.dataRoot)) ?? null;
  return value === null ||
    sharedFolderProblem(value, deps.dataRoot, namedDestinations(deps)) !== null
    ? null
    : value.path;
}

export function createDestinations(deps: {
  dataRoot: string;
  settings: SettingsReader;
}): DestinationsView {
  const computers = join(deps.dataRoot, COMPUTERS_DIR);
  const named = () => namedDestinations(deps);
  const usable = (): [string, string][] =>
    [
      ...Object.entries(named()).map(([name, { path }]): [string, string] => [
        name,
        path,
      ]),
      [COMPUTERS_DESTINATION, computers] as [string, string],
    ].sort(([a], [b]) => (a < b ? -1 : 1));
  // `computers` 폴더는 처음 볼 때 만든다. 사람의 폴더가 아니라 없으면 그냥 만들면 된다.
  const stateAt = (name: string, path: string): DestinationState => {
    if (name === COMPUTERS_DESTINATION) {
      try {
        mkdirSync(path, { recursive: true, mode: 0o700 });
      } catch {
        // 만들지 못하면 상태가 그 까닭을 말한다.
      }
    }
    return stateOf(path);
  };
  return {
    list: () =>
      usable().map(([name, path]) => ({
        name,
        path,
        state: stateAt(name, path),
      })),
    resolve(name) {
      const found = usable().find(([each]) => each === name);
      return found === undefined
        ? null
        : { path: found[1], state: stateAt(found[0], found[1]) };
    },
  };
}
