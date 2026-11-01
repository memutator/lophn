// 선언이 사람과 agent에게 무엇을 설명하는지, 비어 있는 자리가 어디인지 본다
// 구조가 맞는지(`validateDeclaration`)와는
// 다른 근거이고 이 파일은 설명의 빈자리만 센다.
import type { AppDeclaration, InputSchema } from "./mod.ts";

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function inputGaps(path: string, schema: InputSchema, gaps: string[]): void {
  if (blank(schema.description)) gaps.push(path);
  if (schema.properties !== undefined) {
    for (const [name, child] of Object.entries(schema.properties)) {
      inputGaps(`${path}.${name}`, child, gaps);
    }
  }
  if (schema.items !== undefined) inputGaps(`${path}[]`, schema.items, gaps);
}

// 설명이 없거나 빈 자리의 경로. 화면의 이름·시작 위치·크기, operation의 title, command의 설명과 입력 항목의
// 뜻과 선택값을 본다. 입력 항목은 `commands.<name>.inputSchema.<필드>` 꼴이다.
export function descriptionGaps(declaration: AppDeclaration): string[] {
  const gaps: string[] = [];
  if (blank(declaration.name)) gaps.push("name");
  if (blank(declaration.description)) gaps.push("description");
  for (const screen of declaration.screens) {
    if (blank(screen.label)) gaps.push(`screens.${screen.key}.label`);
    if (blank(screen.path)) gaps.push(`screens.${screen.key}.path`);
    if (screen.sizes.length === 0) gaps.push(`screens.${screen.key}.sizes`);
  }
  for (const operation of declaration.operations) {
    if (blank(operation.title)) gaps.push(`operations.${operation.name}.title`);
  }
  for (const command of declaration.commands) {
    if (blank(command.description)) {
      gaps.push(`commands.${command.name}.description`);
    }
    if (command.inputSchema !== null) {
      inputGaps(
        `commands.${command.name}.inputSchema`,
        command.inputSchema,
        gaps,
      );
    }
  }
  return gaps.sort();
}
