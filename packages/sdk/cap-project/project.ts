import { readHost } from "./host.ts";

// protocol/apps/calls/project.ts의 ProjectSummary와 같은 모양이다(SDK는 zod를 import하지 않는다).
export type ProjectSummary = {
  id: string;
  name: string;
  purpose: string;
  archived: boolean;
};

// protocol/apps/calls/broker.ts의 APP_BROKER_PATHS.projects와 같다.
const PROJECTS_PATH = "/_lophn/broker/projects/list";

function summaryOf(value: unknown): ProjectSummary | undefined {
  if (value === null || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  if (
    typeof item["id"] !== "string" || typeof item["name"] !== "string" ||
    typeof item["purpose"] !== "string" || typeof item["archived"] !== "boolean"
  ) return;
  return {
    id: item["id"],
    name: item["name"],
    purpose: item["purpose"],
    archived: item["archived"],
  };
}

// 보관한 project도 싣는다(앱 data는 남는다). project를 고르는 UI는 shell이 맡는다.
export async function listProjects(): Promise<ProjectSummary[]> {
  const host = readHost();
  if (!host) {
    throw new Error("this code is not running inside a lophn app process");
  }
  const response = await host.post(PROJECTS_PATH, {});
  const body = response.body as { projects?: unknown } | null;
  if (response.status !== 200 || !Array.isArray(body?.projects)) {
    throw new Error("project list is not available");
  }
  const projects = body.projects.map(summaryOf);
  if (projects.some((project) => project === undefined)) {
    throw new Error("project list response did not match");
  }
  return projects as ProjectSummary[];
}

// 지금 호출의 project다. project 범위 app-api가 아니거나 호출 밖이면 null이다.
export function currentProject(): string | null {
  return readHost()?.call()?.project ?? null;
}
