// SDK 판 메모 검사. 실행: node tools/check-sdk-notes.ts [root]
// 내장 SDK와 지원 소스의 지금 판과 지원 하한(`lophn.supported_from`)마다 `migrate-sdk` skill의 메모 file이 있는지 본다.
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";

import { SUPPORT_SOURCES } from "../packages/core/apps/packages/vendor.ts";

type Issue = { where: string; message: string };
type Sdk = { folder: string; part: string; version: string; floor: unknown };

const NOTES = "packages/core/agent-workspaces/skills/migrate-sdk";
const PLATFORM_UPDATE_DIR = "packages/core/agent-workspaces/skills/update";
const PLATFORM_NOTES_MANIFEST = `${PLATFORM_UPDATE_DIR}/platform-notes.json`;
const PLATFORM_NOTES_DIR = `${PLATFORM_UPDATE_DIR}/notes`;
const TEMPLATE_APP = "packages/core/apps/packages/template/app";
const SAMPLE_APP_DECLARATION = "tests/support/app/sample/lophn.ts.tmpl";
// `name: "@lophn/<part>", version: "x.y.z"`(선언)와 `sdk/<part>/x.y.z`(file: 의존, 지침의 경로).
const PIN =
  /name: "@lophn\/([a-z-]+)", version: "(\d+\.\d+\.\d+)"|\.lophn\/sdk\/([a-z-]+)\/(\d+\.\d+\.\d+)/g;
const SEMVER = /^\d+\.\d+\.\d+$/;
const NOTE_FILE = /^(.+)-(\d+\.\d+\.\d+)\.md$/;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLATFORM_BREAKING = /^Breaking:[ \t]*(yes|no)(?:$|[\s.,:;—–(-])/m;
const PLATFORM_AREAS_LINE = /^Areas:[ \t]*(.*)$/m;

export const PLATFORM_NOTE_AREAS = [
  "home",
  "project",
  "workflow",
  "agent",
  "app",
] as const;
const PLATFORM_AREA_SET = new Set<string>(PLATFORM_NOTE_AREAS);

function compare(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

async function readSdks(root: string): Promise<Sdk[]> {
  const folders = [
    ...(await readdir(`${root}/packages/sdk`, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/sdk/${entry.name}`)
      .sort(),
    ...SUPPORT_SOURCES.map((source) => `packages/${source.source}`),
  ];
  const found: Sdk[] = [];
  for (const folder of folders) {
    let manifest: {
      name?: unknown;
      version?: unknown;
      lophn?: { supported_from?: unknown };
    };
    try {
      manifest = JSON.parse(
        await readFile(`${root}/${folder}/package.json`, "utf8"),
      );
    } catch {
      continue; // package.json이 없는 폴더는 판이 없어 깔리지 않는다.
    }
    if (
      typeof manifest.name !== "string" ||
      typeof manifest.version !== "string"
    ) {
      continue;
    }
    found.push({
      folder,
      part: manifest.name.replace(/^@lophn\//, ""),
      version: manifest.version,
      floor: manifest.lophn?.supported_from,
    });
  }
  return found;
}

export async function checkSdkNotes(root: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const sdks = await readSdks(root);
  const files = new Set(await readdir(`${root}/${NOTES}`));
  const note = (part: string, version: string) => `${part}-${version}.md`;
  const missing = (sdk: Sdk, version: string, why: string) =>
    issues.push({
      where: `${sdk.folder}/package.json`,
      message: `${why} ${version}에 메모가 없다. ${NOTES}/${note(sdk.part, version)}를 더한다(바뀐 점, Breaking 여부, 앞 판에서 옮기는 code before/after. 앞 메모를 본뜬다).`,
    });

  for (const sdk of sdks) {
    if (!SEMVER.test(sdk.version)) {
      issues.push({
        where: `${sdk.folder}/package.json`,
        message: `version이 x.y.z가 아니다: ${sdk.version}`,
      });
      continue;
    }
    if (!files.has(note(sdk.part, sdk.version))) {
      missing(sdk, sdk.version, "지금 판");
    }
    if (typeof sdk.floor !== "string" || !SEMVER.test(sdk.floor)) {
      issues.push({
        where: `${sdk.folder}/package.json`,
        message: `"lophn": {"supported_from": "x.y.z"}가 없거나 x.y.z가 아니다. lophn이 아직 돌리는 가장 옛 판을 적는다.`,
      });
    } else if (compare(sdk.floor, sdk.version) > 0) {
      issues.push({
        where: `${sdk.folder}/package.json`,
        message: `supported_from ${sdk.floor}이 지금 판 ${sdk.version}보다 높다.`,
      });
    } else if (!files.has(note(sdk.part, sdk.floor))) {
      missing(sdk, sdk.floor, "지원 하한");
    }
  }

  const known = new Map(sdks.map((sdk) => [sdk.part, sdk]));
  for (const file of [...files].sort()) {
    if (file === "SKILL.md") continue;
    const where = `${NOTES}/${file}`;
    const match = NOTE_FILE.exec(file);
    if (match === null || !known.has(match[1])) {
      issues.push({
        where,
        message: `메모 이름은 <패키지 이름에서 @lophn/를 뺀 것>-<x.y.z>.md이고 내장 SDK나 지원 소스의 이름이어야 한다(${[...known.keys()].join(", ")}).`,
      });
      continue;
    }
    // 읽는 agent가 `Previous:`를 따라 고정 판까지 거슬러 올라가므로 사슬이 끊기면 안 된다.
    const text = await readFile(`${root}/${where}`, "utf8");
    const previous = /^Previous: (\S+)$/m.exec(text)?.[1];
    if (!/^Breaking: \S/m.test(text)) {
      issues.push({ where, message: "`Breaking: yes|no|n/a ...` 줄이 없다." });
    }
    if (previous === undefined) {
      issues.push({
        where,
        message: "`Previous: <앞 판 또는 none>` 줄이 없다.",
      });
    } else if (previous === "none") {
      // 첫 판이다.
    } else if (!SEMVER.test(previous) || compare(previous, match[2]) >= 0) {
      issues.push({
        where,
        message: `Previous ${previous}는 이 판 ${match[2]}보다 낮은 x.y.z여야 한다.`,
      });
    } else if (!files.has(note(match[1], previous))) {
      issues.push({
        where,
        message: `앞 판 메모 ${NOTES}/${note(match[1], previous)}가 없다. 더하거나 Previous를 고친다.`,
      });
    }
  }
  issues.push(...(await checkTemplatePins(root, sdks)));
  issues.push(...(await checkPlatformNotes(root)));
  return issues;
}

// 설치는 packages/sdk의 지금 판 하나만 data root에 깐다. template과 e2e 샘플 앱이 다른 판을 걸면
// 새로 설치한 lophn은 이 template으로 앱을 만들지 못한다(SDK is not installed).
async function checkTemplatePins(root: string, sdks: Sdk[]): Promise<Issue[]> {
  const current = new Map(sdks.map((sdk) => [sdk.part, sdk.version]));
  const files = [
    ...(await readdir(`${root}/${TEMPLATE_APP}`, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .map((name) => `${TEMPLATE_APP}/${name}`),
    SAMPLE_APP_DECLARATION,
  ];
  const issues: Issue[] = [];
  for (const where of files) {
    const text = await readFile(`${root}/${where}`, "utf8");
    for (const pin of text.matchAll(PIN)) {
      const part = pin[1] ?? pin[3];
      const version = pin[2] ?? pin[4];
      const now = current.get(part);
      if (now !== undefined && now !== version) {
        issues.push({
          where,
          message: `@lophn/${part} ${version}을 건다. 설치되는 판은 ${now}뿐이다. pin을 ${now}로 고친다.`,
        });
      }
    }
  }
  return issues;
}

export async function checkPlatformNotes(root: string): Promise<Issue[]> {
  let raw: string;
  try {
    raw = await readFile(`${root}/${PLATFORM_NOTES_MANIFEST}`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      { where: PLATFORM_NOTES_MANIFEST, message: `JSON이 아니다: ${message}` },
    ];
  }
  if (!Array.isArray(parsed)) {
    return [
      {
        where: PLATFORM_NOTES_MANIFEST,
        message: "note id 문자열 배열이어야 한다.",
      },
    ];
  }

  const issues: Issue[] = [];
  const ids = new Set<string>();
  for (const [index, item] of parsed.entries()) {
    if (typeof item !== "string" || !KEBAB.test(item) || item === "none") {
      issues.push({
        where: PLATFORM_NOTES_MANIFEST,
        message: `[${index}] 유효한 kebab-case note id가 아니다: ${String(item)}`,
      });
      continue;
    }
    if (ids.has(item)) {
      issues.push({
        where: PLATFORM_NOTES_MANIFEST,
        message: `중복된 note id: ${item}`,
      });
      continue;
    }
    ids.add(item);
  }

  let noteFiles = new Set<string>();
  try {
    noteFiles = new Set(await readdir(`${root}/${PLATFORM_NOTES_DIR}`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }

  for (const id of ids) {
    const file = `${id}.md`;
    const where = `${PLATFORM_NOTES_DIR}/${file}`;
    if (!noteFiles.has(file)) {
      issues.push({
        where: PLATFORM_NOTES_MANIFEST,
        message: `메모 파일이 없다: ${where}`,
      });
      continue;
    }
    const text = await readFile(`${root}/${where}`, "utf8");
    if (!PLATFORM_BREAKING.test(text)) {
      issues.push({
        where,
        message: "`Breaking: yes` 또는 `Breaking: no` 줄이 없다.",
      });
    }
    const areasMatch = PLATFORM_AREAS_LINE.exec(text);
    if (areasMatch === null) {
      issues.push({
        where,
        message: "`Areas: <home|project|workflow|agent|app, ...>` 줄이 없다.",
      });
    } else {
      const rawAreas = areasMatch[1].trim();
      const areas = rawAreas
        ? rawAreas.split(",").map((part) => part.trim())
        : [];
      const invalid = areas.filter((area) => !PLATFORM_AREA_SET.has(area));
      if (areas.length === 0 || invalid.length > 0) {
        issues.push({
          where,
          message: `Areas는 ${PLATFORM_NOTE_AREAS.join(", ")} 가운데 하나 이상이어야 한다: ${rawAreas || "(비어 있음)"}`,
        });
      }
    }
  }

  for (const file of [...noteFiles].sort()) {
    if (!file.endsWith(".md")) continue;
    const id = file.slice(0, -3);
    if (!ids.has(id)) {
      issues.push({
        where: `${PLATFORM_NOTES_DIR}/${file}`,
        message: `${PLATFORM_NOTES_MANIFEST}에 없는 고아 메모 파일이다.`,
      });
    }
  }

  return issues;
}

if (import.meta.main) {
  try {
    const root = process.argv[2] ?? process.cwd();
    const issues = await checkSdkNotes(root);
    for (const issue of issues) {
      console.error(`${issue.where} ${issue.message}`);
    }
    if (!issues.length) console.log("sdk notes: 통과");
    process.exit(issues.length ? 1 : 0);
  } catch (error) {
    console.error(
      `sdk notes: 검사 실패: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
