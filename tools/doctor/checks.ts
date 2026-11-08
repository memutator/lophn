// doctor의 check 목록. 각 check는 독립이고, 무엇을 보는지와 고치는 명령을 스스로 낸다.
// fix.apply는 --fix가 직접 고치는 안전하고 되돌릴 수 있는 변경만 둔다(sudo, network, 설치, process 시작은 없다).
import { join } from "node:path";
import process from "node:process";
import { DEFAULT_API_PORT } from "../../packages/protocol/base/limits.ts";
import {
  CONTROL_REQUEST_TIMEOUT_MS,
  controlConnect,
  controlIdentify,
} from "../../packages/protocol/client/mod.ts";
import type { ControlIdentify } from "../../packages/protocol/supervision/core-control.ts";
import type { Check, Ctx, Fix, Status } from "./types.ts";

// tests/support의 dev fake server가 쓰는 port(tools/dev.ts의 DEFAULT_FAKE_PORT).
const DEFAULT_FAKE_PORT = 7499;
const MIN_NODE = [24, 2, 0];
const MIN_NPM_MAJOR = 11;
const SECRET_KEY = /key|token|secret|password/i;

const ELECTRON_FIX: Fix = {
  command: "node node_modules/electron/install.js",
};
const NPM_CI_FIX: Fix = { command: "npm ci" };

type ParsedEnv = {
  assigned: Map<string, string>;
  optional: Map<string, string>;
};

// `.env`와 `.env.example`은 KEY=VALUE 한 줄이다. `# KEY=...`(주석)은 example에서 선택 key다.
function parseEnvFile(text: string): ParsedEnv {
  const assigned = new Map<string, string>();
  const optional = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const commented = /^#\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (commented !== null) {
      optional.set(commented[1], commented[2].trim());
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match !== null) assigned.set(match[1], match[2].trim());
  }
  return { assigned, optional };
}

// file·network에서 온 JSON. object가 아니면 null.
function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonObject(text: string): Record<string, unknown> | null {
  try {
    return recordOf(JSON.parse(text));
  } catch {
    return null;
  }
}

// "v24.20.0"처럼 v가 붙고 prerelease가 붙을 수 있다. 숫자 세 칸만 본다.
function versionAtLeast(text: string, min: number[]): boolean {
  const parts = text
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number(part));
  for (let index = 0; index < min.length; index += 1) {
    const value = parts[index] ?? 0;
    if (value > min[index]) return true;
    if (value < min[index]) return false;
  }
  return true;
}

function shown(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

// dev가 여는 data root: LOPHN_DEV_HOME이 있으면 그 root, 없으면 <root>/.dev-data(tools/dev.ts와 같다).
function devDataRootOf(ctx: Ctx): string {
  const kept = ctx.env["LOPHN_DEV_HOME"];
  if (kept !== undefined && kept !== "") return kept.replace(/\/+$/, "");
  return join(ctx.root, ".dev-data");
}

type CoreProbe =
  | { kind: "none" }
  | { kind: "identified"; core: ControlIdentify }
  | { kind: "broken"; message: string };

// 이 checkout의 dev data root core에 identify를 묻는다. core를 띄우지 않고 묻기만 한다.
async function probeCore(ctx: Ctx): Promise<CoreProbe> {
  const identified = await controlIdentify({
    dial: ctx.control(devDataRootOf(ctx)),
    timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
  });
  if (identified.ok) return { kind: "identified", core: identified.value };
  // 답이 없으면 도는 core가 없다. 계약 밖 응답이면 옛 판이거나 socket 주인이 다르다.
  return identified.error.code === "unavailable"
    ? { kind: "none" }
    : { kind: "broken", message: identified.error.message };
}

// root package.json의 workspaces를 펴서 manifest 경로를 모은다.
async function workspaceManifests(ctx: Ctx): Promise<string[]> {
  const rootText = await ctx.fs.readText(join(ctx.root, "package.json"));
  if (rootText === null) return [];
  const root = jsonObject(rootText);
  if (root === null) return [];
  const rawWorkspaces = root["workspaces"];
  let patterns: string[] = [];
  if (Array.isArray(rawWorkspaces)) {
    patterns = rawWorkspaces.filter(
      (item): item is string => typeof item === "string",
    );
  } else {
    const nested = recordOf(rawWorkspaces)?.["packages"];
    if (Array.isArray(nested)) {
      patterns = nested.filter(
        (item): item is string => typeof item === "string",
      );
    }
  }
  const manifests = ["package.json"];
  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      const base = pattern.slice(0, -2);
      for (const name of (await ctx.fs.list(join(ctx.root, base))) ?? []) {
        const manifest = `${base}/${name}/package.json`;
        if (await ctx.fs.exists(join(ctx.root, manifest))) {
          manifests.push(manifest);
        }
      }
      continue;
    }
    if (await ctx.fs.exists(join(ctx.root, pattern, "package.json"))) {
      manifests.push(`${pattern}/package.json`);
    }
  }
  return manifests;
}

// package.json의 dependency 절. 판이 string이 아니면 건너뛴다.
function pinnedDependencies(
  manifest: Record<string, unknown>,
): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    const deps = recordOf(manifest[section]);
    if (deps === null) continue;
    for (const [name, value] of Object.entries(deps)) {
      if (typeof value === "string") result.push([name, value]);
    }
  }
  return result;
}

function firstFew(items: string[]): string {
  const head = items.slice(0, 3).join(", ");
  return items.length > 3 ? `${head} 외 ${items.length - 3}` : head;
}

// port를 이미 누가 쥐고 있을 때 그 주인이 누구인지: 이 checkout의 core, 다른 root의 core, 남의 process.
// 이 checkout의 core는 자기 data root의 control socket에 identify로 답하고 api_url을 알린다.
async function classifyPortOwner(
  ctx: Ctx,
  port: number,
): Promise<"this-core" | "other-core" | "foreign"> {
  // 이 checkout의 core는 자기 control socket에 api_url(`http://127.0.0.1:<port>`)로 답한다.
  const probe = await probeCore(ctx);
  if (
    probe.kind === "identified" &&
    probe.core.api_url === `http://127.0.0.1:${port}`
  ) {
    return "this-core";
  }
  // 다른 data root의 core가 이 port를 쥐었는지는 그 core의 control socket에 물을 길이 없다.
  // 인증 없이 부르면 lophn core는 unauthorized를 낸다. Host가 다르면 남의 process다.
  const anonymous = await ctx.net.httpGet(`http://127.0.0.1:${port}/healthz`, {
    timeoutMs: 2000,
  });
  if (anonymous.kind === "response") {
    const body = jsonObject(anonymous.body);
    const error = recordOf(body?.["error"]);
    if (error?.["code"] === "unauthorized") return "other-core";
  }
  return "foreign";
}

export const checks: Check[] = [
  {
    id: "node-version",
    title: "Node ≥ 24.2.0",
    async run() {
      // native TS type stripping과 import.meta.main을 쓴다.
      if (versionAtLeast(process.version, MIN_NODE)) {
        return {
          status: "pass",
          detail: `${process.version} (>= 24.2.0)`,
        };
      }
      return {
        status: "fail",
        detail: `${process.version}은 24.2.0보다 낮다. type stripping과 import.meta.main을 쓸 수 없다`,
        fix: { command: "nvm install 24 && nvm use 24" },
      };
    },
  },
  {
    id: "npm-version",
    title: "npm ≥ 11",
    async run(ctx) {
      const out = await ctx.spawn("npm", ["--version"], { timeoutMs: 3000 });
      if (out.error !== undefined || out.code !== 0) {
        return {
          status: "fail",
          detail: `npm을 실행하지 못했다: ${out.error ?? out.stderr.trim()}`,
          fix: { command: "npm install -g npm@11.19.0" },
        };
      }
      const version = out.stdout.trim();
      if (Number(version.split(".")[0]) >= MIN_NPM_MAJOR) {
        return { status: "pass", detail: version };
      }
      return {
        status: "fail",
        detail: `${version}은 11보다 낮다(packages/core가 11.19.0을 고정한다)`,
        fix: { command: "npm install -g npm@11.19.0" },
      };
    },
  },
  {
    id: "git",
    title: "git on PATH",
    async run(ctx) {
      const out = await ctx.spawn("git", ["--version"], { timeoutMs: 3000 });
      const version = out.stdout.trim();
      if (out.error === undefined && out.code === 0 && version !== "") {
        return { status: "pass", detail: version };
      }
      return {
        status: "fail",
        detail: `git을 실행하지 못했다: ${out.error ?? out.stderr.trim()}`,
        fix: { command: "sudo apt install git" },
      };
    },
  },
  {
    id: "electron",
    title: "Electron binary와 Temporal",
    async run(ctx) {
      const electron = ctx.electronPath;
      if (electron === null) {
        return {
          status: "fail",
          detail: "electron package를 resolve하지 못했다",
          fix: ELECTRON_FIX,
        };
      }
      if (!(await ctx.fs.exists(electron))) {
        return {
          status: "fail",
          detail: `${shown(ctx.root, electron)}가 없다`,
          fix: ELECTRON_FIX,
        };
      }
      // core는 Temporal을 쓴다. 기계의 node에는 없고 Electron의 Node에만 있다.
      const out = await ctx.spawn(
        electron,
        ["-e", "process.stdout.write(typeof Temporal)"],
        { env: { ELECTRON_RUN_AS_NODE: "1" }, timeoutMs: 4000 },
      );
      const got = out.stdout.trim();
      if (out.error === undefined && out.code === 0 && got === "object") {
        return {
          status: "pass",
          detail: `${shown(ctx.root, electron)} → typeof Temporal = object`,
        };
      }
      const reason =
        out.error ?? out.stderr.trim().split("\n")[0] ?? `typeof ${got || "?"}`;
      return {
        status: "fail",
        detail: `ELECTRON_RUN_AS_NODE로 Temporal을 확인하지 못했다: ${reason}`,
        fix: ELECTRON_FIX,
      };
    },
  },
  {
    id: "electron-sandbox",
    title: "Electron sandbox",
    async run(ctx) {
      if (process.platform !== "linux") {
        return { status: "pass", detail: `${process.platform}에는 해당 없음` };
      }
      const restriction = (
        await ctx.fs.readText(
          "/proc/sys/kernel/apparmor_restrict_unprivileged_userns",
        )
      )?.trim();
      if (restriction !== "1") {
        return { status: "pass", detail: "apparmor userns 제한 없음" };
      }
      const sandbox = join(
        ctx.root,
        "node_modules/electron/dist/chrome-sandbox",
      );
      const stat = await ctx.fs.stat(sandbox);
      if (stat !== null && stat.uid === 0 && (stat.mode & 0o4000) !== 0) {
        return {
          status: "pass",
          detail: "chrome-sandbox가 root 소유 setuid다",
        };
      }
      const state =
        stat === null
          ? "chrome-sandbox가 없다"
          : "chrome-sandbox가 setuid root가 아니다";
      return {
        status: "warn",
        detail: `apparmor가 unprivileged userns를 막고 ${state}. 지금은 ELECTRON_NO_SANDBOX=1 npm run dev로 띄운다`,
        fix: {
          command:
            "sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox",
        },
      };
    },
  },
  {
    id: "env-file",
    title: ".env와 .env.example",
    async run(ctx) {
      const examplePath = join(ctx.root, ".env.example");
      const envPath = join(ctx.root, ".env");
      const exampleText = await ctx.fs.readText(examplePath);
      if (exampleText === null) {
        return {
          status: "fail",
          detail: ".env.example이 없다. eval·test:live가 읽는 key 목록이다",
        };
      }
      const example = parseEnvFile(exampleText);
      const envText = await ctx.fs.readText(envPath);
      if (envText === null) {
        return {
          status: "warn",
          detail: ".env가 없다(eval·test:live만 읽는다)",
          fix: {
            command: "cp .env.example .env && chmod 600 .env",
            apply: () => ctx.fs.copyText(examplePath, envPath, 0o600),
          },
        };
      }
      const env = parseEnvFile(envText);
      const formats: Record<string, (value: string) => boolean> = {
        ANTHROPIC_API_KEY: (value) =>
          value === "" || value.startsWith("sk-ant-"),
        OPENAI_API_KEY: (value) => value === "" || value.startsWith("sk-"),
        LOPHN_LIVE_RECORD: (value) => value === "" || value === "1",
      };
      // 값은 절대 찍지 않는다(SECRET_KEY). key 이름만 낸다.
      const problems: string[] = [];
      for (const [key, value] of env.assigned) {
        const format = formats[key];
        if (format !== undefined && !format(value)) {
          problems.push(`${key} 형식이 틀렸다(값은 숨긴다)`);
        }
      }
      if (problems.length > 0) {
        return { status: "fail", detail: problems.join("; ") };
      }
      const warnings: string[] = [];
      const known = new Set([
        ...example.assigned.keys(),
        ...example.optional.keys(),
      ]);
      const unknown = [...env.assigned.keys()].filter((key) => !known.has(key));
      if (unknown.length > 0) {
        warnings.push(`${unknown.join(", ")}는 .env.example에 없다(오타?)`);
      }
      const missing = [...example.assigned.keys()].filter(
        (key) => !env.assigned.has(key),
      );
      if (missing.length > 0) {
        warnings.push(`${missing.join(", ")}가 .env에 없다`);
      }
      const stat = await ctx.fs.stat(envPath);
      const modeFix: Fix = {
        command: "chmod 600 .env",
        apply: () => ctx.fs.chmod(envPath, 0o600),
      };
      const wide = stat !== null && (stat.mode & 0o077) !== 0;
      if (wide && stat !== null) {
        warnings.push(
          `.env mode가 0${(stat.mode & 0o777).toString(8)}다(0600이어야 한다)`,
        );
      }
      if (warnings.length > 0) {
        return {
          status: "warn",
          detail: warnings.join("; "),
          fix: wide ? modeFix : undefined,
        };
      }
      const secretKeys = [...env.assigned.keys()].filter((key) =>
        SECRET_KEY.test(key),
      );
      const secretState = secretKeys.every(
        (key) => env.assigned.get(key) === "",
      )
        ? "secret key는 비어 있다"
        : "secret key는 채워져 있다";
      return {
        status: "pass",
        detail: `.env ok (${env.assigned.size} keys, mode 0600, ${secretState})`,
      };
    },
  },
  {
    id: "telemetry-env",
    title: "telemetry env",
    async run(ctx) {
      const problems: string[] = [];
      const shownValues: string[] = [];
      const enumValue = (
        key: string,
        allowed: string[],
      ): string | undefined => {
        const value = ctx.env[key];
        if (value === undefined || value === "") return undefined;
        if (!allowed.includes(value)) {
          problems.push(`${key}=${value} (${allowed.join("|")} 중 하나)`);
          return undefined;
        }
        shownValues.push(`${key}=${value}`);
        return value;
      };
      const telemetry = enumValue("LOPHN_TELEMETRY", [
        "off",
        "console",
        "otlp",
      ]);
      enumValue("LOPHN_LOG_LEVEL", ["debug", "info", "warn", "error"]);
      enumValue("LOPHN_LOG_FORMAT", ["json", "pretty"]);
      const endpointText = ctx.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
      let endpoint: URL | null = null;
      let endpointFixProblem = false;
      if (endpointText !== undefined && endpointText !== "") {
        try {
          endpoint = new URL(endpointText);
          const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"];
          if (endpoint.protocol !== "http:") {
            // core는 node:http로 보낸다. https collector는 받지 않는다.
            problems.push(
              "OTEL_EXPORTER_OTLP_ENDPOINT는 http URL이어야 한다(core는 node:http로 보낸다)",
            );
            endpointFixProblem = true;
            endpoint = null;
          } else if (!loopback.includes(endpoint.hostname)) {
            // core는 network에 나가지 않고 loopback collector로만 보낸다.
            problems.push(
              `OTEL_EXPORTER_OTLP_ENDPOINT의 host ${endpoint.hostname}가 loopback이 아니다. core keeps network on loopback; run a local collector`,
            );
            endpointFixProblem = true;
            endpoint = null;
          } else {
            shownValues.push(`OTEL_EXPORTER_OTLP_ENDPOINT=${endpointText}`);
          }
        } catch {
          problems.push("OTEL_EXPORTER_OTLP_ENDPOINT가 URL로 parse되지 않는다");
        }
      }
      if (
        telemetry === "otlp" &&
        endpoint === null &&
        (endpointText === undefined || endpointText === "")
      ) {
        problems.push(
          "LOPHN_TELEMETRY=otlp인데 OTEL_EXPORTER_OTLP_ENDPOINT가 없다",
        );
      }
      const fakeText = ctx.env["LOPHN_DEV_FAKE_PORT"];
      if (fakeText !== undefined && fakeText !== "") {
        const fakePort = Number(fakeText);
        if (!Number.isInteger(fakePort) || fakePort < 1 || fakePort > 65535) {
          problems.push(`LOPHN_DEV_FAKE_PORT=${fakeText} (1–65535 정수)`);
        } else {
          shownValues.push(`LOPHN_DEV_FAKE_PORT=${fakePort}`);
        }
      }
      if (problems.length > 0) {
        return {
          status: "fail",
          detail: problems.join("; "),
          fix: endpointFixProblem
            ? {
                command:
                  "export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318",
              }
            : undefined,
        };
      }
      if (telemetry === "otlp" && endpoint !== null) {
        const port =
          endpoint.port === ""
            ? endpoint.protocol === "https:"
              ? 443
              : 80
            : Number(endpoint.port);
        const host = endpoint.hostname.replace(/^\[|\]$/g, "");
        const collector = await ctx.net.tcp(host, port, 2000);
        if (!collector.ok) {
          return {
            status: "warn",
            detail: `LOPHN_TELEMETRY=otlp지만 ${host}:${port}에 collector가 없다(${collector.message}). span은 버려진다`,
          };
        }
      }
      if (shownValues.length === 0) {
        return { status: "pass", detail: "telemetry env 없음(기본 off)" };
      }
      return { status: "pass", detail: shownValues.join(" ") };
    },
  },
  {
    id: "dependencies",
    title: "dependency integrity",
    async run(ctx) {
      const modules = join(ctx.root, "node_modules");
      if (!(await ctx.fs.exists(modules))) {
        return {
          status: "fail",
          detail: "node_modules가 없다",
          fix: NPM_CI_FIX,
        };
      }
      const lockText = await ctx.fs.readText(
        join(ctx.root, "package-lock.json"),
      );
      if (lockText === null) {
        return {
          status: "fail",
          detail: "package-lock.json이 없다",
          fix: NPM_CI_FIX,
        };
      }
      const lock = jsonObject(lockText);
      if (lock === null) {
        return {
          status: "fail",
          detail: "package-lock.json이 JSON이 아니다",
          fix: NPM_CI_FIX,
        };
      }
      const packages = recordOf(lock["packages"]);
      if (packages === null) {
        return {
          status: "fail",
          detail: "package-lock.json에 packages가 없다",
          fix: NPM_CI_FIX,
        };
      }
      const missing: string[] = [];
      const mismatch: string[] = [];
      let checked = 0;
      for (const [key, rawEntry] of Object.entries(packages)) {
        if (!key.startsWith("node_modules/")) continue;
        const entry = recordOf(rawEntry);
        if (entry === null || entry["link"] === true) continue;
        const manifest = await ctx.fs.readText(
          join(ctx.root, key, "package.json"),
        );
        if (manifest === null) {
          // 플랫폼 때문에 skip된 optional package는 없는 게 정상이다.
          if (entry["optional"] === true) continue;
          missing.push(key.slice("node_modules/".length));
          continue;
        }
        checked += 1;
        const name = key.slice("node_modules/".length);
        const parsed = jsonObject(manifest);
        if (parsed === null) {
          mismatch.push(`${name} package.json이 JSON이 아니다`);
          continue;
        }
        const expected = entry["version"];
        const actual = parsed["version"];
        if (
          typeof expected === "string" &&
          typeof actual === "string" &&
          actual !== expected
        ) {
          mismatch.push(`${name} ${actual} != ${expected}`);
        }
      }
      const pinProblems: string[] = [];
      for (const manifestPath of await workspaceManifests(ctx)) {
        const text = await ctx.fs.readText(join(ctx.root, manifestPath));
        if (text === null) continue;
        const manifest = jsonObject(text);
        if (manifest === null) continue;
        for (const [name, version] of pinnedDependencies(manifest)) {
          // workspace 안의 상대 참조는 고정 판이 아니다.
          if (version.startsWith("workspace:")) continue;
          if (/^[\^~><*=]|(^|\.)x($|[.-])/.test(version)) {
            pinProblems.push(`${manifestPath}: ${name}@${version}`);
          }
        }
      }
      if (missing.length > 0 || mismatch.length > 0) {
        const parts: string[] = [];
        if (missing.length > 0) {
          parts.push(`없음 ${missing.length}: ${firstFew(missing)}`);
        }
        if (mismatch.length > 0) {
          parts.push(`version 다름 ${mismatch.length}: ${firstFew(mismatch)}`);
        }
        return {
          status: "fail",
          detail: `${parts.join("; ")} (node_modules와 package-lock.json이 다르다)`,
          fix: NPM_CI_FIX,
        };
      }
      if (pinProblems.length > 0) {
        return {
          status: "warn",
          detail: `정확히 고정하지 않은 dependency ${pinProblems.length}: ${firstFew(pinProblems)} (AGENTS.md는 정확한 판을 고정한다)`,
        };
      }
      return {
        status: "pass",
        detail: `${checked} packages가 package-lock.json과 맞다`,
      };
    },
  },
  {
    id: "binaries",
    title: "required binaries",
    async run(ctx) {
      const bins = [
        "node_modules/.bin/biome",
        "node_modules/.bin/tsc",
        "node_modules/.bin/esbuild",
      ];
      const pty = "node_modules/node-pty/build/Release/pty.node";
      const missingBins: string[] = [];
      for (const bin of bins) {
        if (!(await ctx.fs.exists(join(ctx.root, bin)))) missingBins.push(bin);
      }
      const missingPty = !(await ctx.fs.exists(join(ctx.root, pty)));
      if (missingBins.length === 0 && !missingPty) {
        return {
          status: "pass",
          detail: "biome, tsc, esbuild, pty.node 있음",
        };
      }
      const missing = [...missingBins, ...(missingPty ? [pty] : [])].map(
        (path) => shown(ctx.root, join(ctx.root, path)),
      );
      return {
        status: "fail",
        detail: `없음: ${missing.join(", ")}`,
        // npm ci가 install script까지 돌려 pty.node를 만든다.
        fix:
          missingBins.length > 0
            ? NPM_CI_FIX
            : { command: "npm rebuild node-pty" },
      };
    },
  },
  {
    id: "dev-data-root",
    title: "dev data root",
    async run(ctx) {
      const dataRoot = devDataRootOf(ctx);
      const relative = shown(ctx.root, dataRoot);
      const stat = await ctx.fs.stat(dataRoot);
      const cache = join(ctx.root, ".cache");
      const cacheFix: Fix = {
        command: "mkdir -p .cache",
        apply: () => ctx.fs.mkdir(cache, 0o755),
      };
      if (stat === null) {
        const cacheMissing = !(await ctx.fs.exists(cache));
        if (cacheMissing) {
          return {
            status: "warn",
            detail: `${relative} 없음(npm run dev가 만든다); .cache도 없다(dev가 .cache/dev-cli를 쓴다)`,
            fix: cacheFix,
          };
        }
        return {
          status: "pass",
          detail: `${relative} 없음 (npm run dev가 만든다)`,
        };
      }
      if (!stat.isDir) {
        return { status: "fail", detail: `${relative}가 폴더가 아니다` };
      }
      const uid = process.getuid?.();
      if (uid !== undefined && stat.uid !== uid) {
        return {
          status: "fail",
          detail: `${relative} 소유자가 uid ${stat.uid}다(현재 ${uid}). chown은 사람이 정한다`,
        };
      }
      if ((stat.mode & 0o777) !== 0o700) {
        return {
          status: "fail",
          detail: `${relative} mode가 0${(stat.mode & 0o777).toString(8)}다(0700이어야 core가 뜬다)`,
          fix: {
            command: `chmod 700 ${relative}`,
            apply: () => ctx.fs.chmod(dataRoot, 0o700),
          },
        };
      }
      if (!(await ctx.fs.exists(cache))) {
        return {
          status: "warn",
          detail: `${relative}는 0700이다; .cache가 없다(dev가 .cache/dev-cli를 쓴다)`,
          fix: cacheFix,
        };
      }
      return { status: "pass", detail: `${relative} 0700, .cache 있음` };
    },
  },
  {
    id: "ports",
    title: "dev ports",
    async run(ctx) {
      const fakeText = ctx.env["LOPHN_DEV_FAKE_PORT"];
      const parsedFake =
        fakeText === undefined || fakeText === "" ? NaN : Number(fakeText);
      const fakePort =
        Number.isInteger(parsedFake) && parsedFake >= 1 && parsedFake <= 65535
          ? parsedFake
          : DEFAULT_FAKE_PORT;
      const [core, fake] = await Promise.all([
        ctx.net.probe(DEFAULT_API_PORT),
        ctx.net.probe(fakePort),
      ]);
      let status: Status = "pass";
      let fix: Fix | undefined;
      const details: string[] = [];
      let ownCore = false;
      if (core === "free") {
        details.push(`${DEFAULT_API_PORT} free`);
      } else {
        const owner = await classifyPortOwner(ctx, DEFAULT_API_PORT);
        if (owner === "this-core") {
          ownCore = true;
          details.push(`${DEFAULT_API_PORT}: this checkout의 core가 떠 있다`);
        } else if (owner === "other-core") {
          status = "warn";
          details.push(
            `${DEFAULT_API_PORT}: 다른 data root의 lophn core가 쥐고 있다. npm run dev:core가 실패한다`,
          );
          fix = {
            command: `npm run dev:core -- --port=${await ctx.net.freePort()}`,
          };
        } else {
          status = "fail";
          details.push(`${DEFAULT_API_PORT}: lophn이 아닌 process가 쥐고 있다`);
          fix = { command: `ss -ltnp 'sport = :${DEFAULT_API_PORT}'` };
        }
      }
      if (fake === "free") {
        details.push(`${fakePort} free`);
      } else if (ownCore) {
        // 이 checkout의 npm run dev가 core와 fake를 같이 띄운다. 둘 다 쥐고 있으면 같은 실행이다.
        details.push(`${fakePort}: 같은 npm run dev의 fake server`);
      } else {
        if (status !== "fail") status = "warn";
        details.push(`${fakePort}: 이미 쓰고 있다(다른 npm run dev?)`);
        fix ??= {
          command: `LOPHN_DEV_FAKE_PORT=${await ctx.net.freePort()} npm run dev`,
        };
      }
      return { status, detail: details.join("; "), fix };
    },
  },
  {
    id: "core-readiness",
    title: "core readiness",
    async run(ctx) {
      const probe = await probeCore(ctx);
      if (probe.kind === "none") {
        return {
          status: "pass",
          detail: "core not running (control socket이 답하지 않는다)",
        };
      }
      const staleFix: Fix = { command: "npm run dev:core" };
      if (probe.kind === "broken") {
        return {
          status: "warn",
          detail: `core control 응답이 계약과 다르다(${probe.message}). 옛 core가 떠 있나?`,
          fix: staleFix,
        };
      }
      const identified = probe.core;
      if (identified.state === "starting") {
        return {
          status: "warn",
          detail: "core가 아직 시작 중이다",
          fix: staleFix,
        };
      }
      if (identified.state === "stopping") {
        return {
          status: "warn",
          detail: "core가 끝나는 중이다",
          fix: staleFix,
        };
      }
      if (identified.api_url === null) {
        return {
          status: "warn",
          detail:
            "core가 ready인데 API 주소를 알리지 않는다(control 계약 위반)",
          fix: staleFix,
        };
      }
      // /readyz는 자격이 필요하다. 일반 connect로 받아 확인하고 출력에는 내지 않는다.
      const connected = await controlConnect(
        {
          dial: ctx.control(devDataRootOf(ctx)),
          timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
        },
        "cli",
      );
      if (!connected.ok) {
        return {
          status: "warn",
          detail: `control connect가 실패했다(${connected.error.code}). 새로 띄운다`,
          fix: staleFix,
        };
      }
      const url = identified.api_url;
      const res = await ctx.net.httpGet(`${url}/readyz`, {
        token: connected.value.user_token,
        timeoutMs: 3000,
      });
      if (res.kind === "error") {
        const detail =
          res.message === "ECONNREFUSED"
            ? `core는 ${url}을 알리는데 답하지 않는다(죽었나?)`
            : `/readyz 요청이 실패했다: ${res.message}`;
        return { status: "warn", detail, fix: staleFix };
      }
      if (res.status === 404) {
        return {
          status: "warn",
          detail: "core가 /readyz를 모른다(옛 core). 새로 띄운다",
          fix: staleFix,
        };
      }
      if (res.status === 401 || res.status === 403) {
        return {
          status: "warn",
          detail: `core가 connect로 받은 자격을 거절했다(status ${res.status})`,
          fix: staleFix,
        };
      }
      const body = jsonObject(res.body);
      const rawComponents = body?.["components"];
      const components: Array<{
        component: string;
        available: boolean;
        reason?: string;
      }> = [];
      if (Array.isArray(rawComponents)) {
        for (const raw of rawComponents) {
          const component = recordOf(raw);
          if (component === null) continue;
          const name = component["component"];
          const reason = component["reason"];
          components.push({
            component: typeof name === "string" ? name : "?",
            available: component["available"] === true,
            reason: typeof reason === "string" ? reason : undefined,
          });
        }
      }
      const statusText = body?.["status"];
      const reasonOf = (name: string): string => {
        const match = components.find(
          (component) => component.component === name,
        );
        return `${name}: ${match?.reason ?? "이유 없음"}`;
      };
      const unavailable = components
        .filter((component) => !component.available)
        .map((component) => reasonOf(component.component));
      const rawDegraded = body?.["degraded"];
      const degraded = Array.isArray(rawDegraded)
        ? rawDegraded.filter((item): item is string => typeof item === "string")
        : [];
      if (statusText === "ready") {
        return {
          status: "pass",
          detail: `ready (${components.length} components, ${res.latencyMs}ms)`,
        };
      }
      if (statusText === "degraded" || res.status === 200) {
        const listing =
          degraded.length > 0 ? degraded.map(reasonOf) : unavailable;
        return {
          status: "warn",
          detail:
            listing.length === 0
              ? "degraded (본문에서 unavailable component를 읽지 못했다)"
              : `degraded: ${firstFew(listing)}`,
        };
      }
      if (statusText === "not_ready" || res.status === 503) {
        return {
          status: "fail",
          detail:
            unavailable.length === 0
              ? "not_ready (unavailable component를 본문에서 읽지 못했다)"
              : `not_ready: ${firstFew(unavailable)}`,
        };
      }
      return {
        status: "warn",
        detail: `/readyz가 예상 밖 status ${res.status}를 냈다`,
        fix: staleFix,
      };
    },
  },
  {
    id: "connectivity",
    title: "external connectivity",
    async run(ctx) {
      // HTTP 요청이 아니라 TCP connect만 한다(key를 보내지 않는다).
      const targets = [
        { host: "registry.npmjs.org", fatal: true },
        { host: "models.dev", fatal: false },
        { host: "api.anthropic.com", fatal: false },
        { host: "api.openai.com", fatal: false },
      ];
      const results = await Promise.all(
        targets.map(async (target) => ({
          ...target,
          result: await ctx.net.tcp(target.host, 443, 3000),
        })),
      );
      const unreachable = results.filter((entry) => !entry.result.ok);
      if (unreachable.length === 0) {
        return {
          status: "pass",
          detail: `${targets.map((target) => target.host).join(", ")}:443 연결됨`,
        };
      }
      const detail = unreachable
        .map((entry) => {
          const reason = entry.result.ok ? "" : entry.result.message;
          return `${entry.host}:443 ${reason}`;
        })
        .join("; ");
      if (unreachable.some((entry) => entry.fatal)) {
        return {
          status: "fail",
          detail: `${detail}. npm ci와 app release build가 registry를 필요로 한다`,
        };
      }
      return { status: "warn", detail };
    },
  },
];
