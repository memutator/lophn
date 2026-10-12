export const TKT = "tkt_01h455vb4pex5v6nkc6gd5fdw1";
export const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
export const PRB = "prb_01h455vb4pex5v6nkc6gd5fdw1";
export const QST = "qst_01h455vb4pex5v6nkc6gd5fdw1";
export const VER = "ver_01h455vb4pex5v6nkc6gd5fdw1";
export const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
export const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
export const VRF = "vrf_01h455vb4pex5v6nkc6gd5fdw1";
export const HASH = "ab".repeat(32);
export const AT = "2026-10-05T00:00:00.000Z";

export const versionRef = {
  kind: "version" as const,
  target: VER,
  address: { place: "app", document: "plan", section: null, version: 1 },
  section: null,
};

export const commandCheck = {
  kind: "test_command" as const,
  executable: "deno",
  argv: ["test", "ok"],
  cwd: "src",
  timeout_ms: 1000,
  expected_exit_code: 0,
};

export const readyCreate = {
  app: APP,
  kind: "implementation" as const,
  title: "ship the button",
  what: "add the button",
  why: "the screen has no way to save",
  references: [versionRef],
  adoption_questions: [QST],
  conditions: [
    { kind: "app_test" as const },
    commandCheck,
  ],
  inspect: ["src/button.ts"],
  preserve: ["src/save.ts"],
  problems: [] as string[],
  readiness: "ready" as const,
  needs: [] as string[],
};
