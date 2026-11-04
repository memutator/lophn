// domain의 lophn data 자리. shell main이 import하므로 import를 두지 않는다.
// 자리는 `<data>/domains/<dom>/`이고 kind 파일, DOMAIN.md, skill이 든다.
export const DOMAINS_AREA = "domains";
export const DOMAIN_DOC_FILE = "DOMAIN.md";
export const DOMAIN_KINDS_FILE = "kinds.yaml";
export const DOMAIN_SKILLS_FOLDER = "skills";

export function domainFolder(dataRoot: string, domain: string): string {
  return `${dataRoot}/${DOMAINS_AREA}/${domain}`;
}

export function domainKindsFile(dataRoot: string, domain: string): string {
  return `${domainFolder(dataRoot, domain)}/${DOMAIN_KINDS_FILE}`;
}

export function domainDocFile(dataRoot: string, domain: string): string {
  return `${domainFolder(dataRoot, domain)}/${DOMAIN_DOC_FILE}`;
}

export function domainSkillsFolder(dataRoot: string, domain: string): string {
  return `${domainFolder(dataRoot, domain)}/${DOMAIN_SKILLS_FOLDER}`;
}

// domains 폴더 안에서 domain 폴더만 가려낸다.
export function domainIdOfFolder(name: string): string | null {
  return /^dom_[0-9a-z]+$/.test(name) ? name : null;
}
