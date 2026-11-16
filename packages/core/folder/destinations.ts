// destination: 기계마다의 이름 → 그 기계의 절대 경로. 앱은 선언 `sync_to`로 이름만 고른다.
// 설정은 기계를 넘지 않는다. data root와 겹치는 경로는 쓰이지 않는다: 바꿀 때 check가 거절하고, 사람이 settings.json을
// 손으로 고쳐 check를 지나친 값은 `createDestinations`가 없는 것으로 본다.
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
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
    if (!isAbsolute(path)) {
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

/** data root를 아는 조립이 만든다. agent는 바꾸지 못하고 사람만 둔다. */
export function destinationsSetting(
  dataRoot: string,
): SettingDeclaration<typeof destinationsType> {
  return declareSetting({
    key: DESTINATIONS_KEY,
    type: destinationsType,
    default: {},
    description:
      "Sync folders on this computer: a name mapped to an absolute folder path. An app picks one by name with `sync_to`, and lophn writes and reads that app's data there; an outside tool moves the folder between machines. Only the person sets it.",
    locked: true,
    check: (value): SettingIssue[] =>
      [...destinationProblems(value, dataRoot).values()].map((message) => ({
        level: "reject",
        message,
      })),
  });
}

export type ResolvedDestination = { path: string; state: DestinationState };

export type DestinationsView = {
  /** 쓸 수 있는 destination(이름 순). 겹치거나 상대 경로인 것은 빠진다. */
  list(): ({ name: string } & ResolvedDestination)[];
  /** 이 기계에 그 이름이 없거나 쓸 수 없는 값이면 null. */
  resolve(name: string): ResolvedDestination | null;
};

function stateOf(path: string): DestinationState {
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

export function createDestinations(deps: {
  dataRoot: string;
  settings: SettingsReader;
}): DestinationsView {
  const setting = destinationsSetting(deps.dataRoot);
  const usable = (): [string, string][] => {
    const value = deps.settings.get(setting) ?? {};
    const problems = destinationProblems(value, deps.dataRoot);
    return Object.entries(value)
      .filter(([name]) => !problems.has(name))
      .map(([name, { path }]): [string, string] => [name, path])
      .sort(([a], [b]) => (a < b ? -1 : 1));
  };
  return {
    list: () =>
      usable().map(([name, path]) => ({ name, path, state: stateOf(path) })),
    resolve(name) {
      const found = usable().find(([each]) => each === name);
      return found === undefined
        ? null
        : { path: found[1], state: stateOf(found[1]) };
    },
  };
}
