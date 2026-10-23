// Access 탭 secret 줄의 고정 data. 상태 이름은 ao-contract가 고정한 것과 같다. protocol이 서면 그것으로 바꾼다.
export type OAuthState = "none" | "in_progress" | "signed_in" | "failed";

export type OAuthReason =
  | "callback_timeout"
  | "state_mismatch"
  | "exchange_failed"
  | "refresh_rejected"
  | "expired"
  | "store_failed";

export interface SecretRowData {
  name: string;
  /** 값이 들어 있는가. OAuth 줄에서는 쓰지 않는다. */
  configured: boolean;
  oauth: null | {
    /** 앱이 선언한 sign-in 곳. 사람이 바꿀 수 없다. */
    authorizeHost: string;
    scopes: readonly string[];
    clientId: string | null;
    clientSecretSet: boolean;
    state: OAuthState;
    /** state가 failed일 때만 있다. */
    reason: OAuthReason | null;
  };
}

const drive = {
  authorizeHost: "accounts.google.com",
  scopes: ["drive.file"],
  clientId: "412907-drive.apps.googleusercontent.com",
  clientSecretSet: true,
  state: "none",
  reason: null,
} as const;

export const SECRETS_ONLY: readonly SecretRowData[] = [
  { name: "SMTP_PASSWORD", configured: false, oauth: null },
  { name: "WEBHOOK_KEY", configured: true, oauth: null },
];

export const OAUTH_SETUP: readonly SecretRowData[] = [
  {
    name: "GDRIVE_TOKEN",
    configured: false,
    oauth: { ...drive, clientId: null, clientSecretSet: false },
  },
  { name: "SMTP_PASSWORD", configured: true, oauth: null },
];

export const OAUTH_READY: readonly SecretRowData[] = [
  { name: "GDRIVE_TOKEN", configured: false, oauth: drive },
];

export const OAUTH_WAITING: readonly SecretRowData[] = [
  {
    name: "GDRIVE_TOKEN",
    configured: false,
    oauth: { ...drive, state: "in_progress" },
  },
];

export const OAUTH_SIGNED_IN: readonly SecretRowData[] = [
  {
    name: "GDRIVE_TOKEN",
    configured: true,
    oauth: { ...drive, state: "signed_in" },
  },
];

const REASONS: readonly OAuthReason[] = [
  "callback_timeout",
  "state_mismatch",
  "exchange_failed",
  "refresh_rejected",
  "expired",
  "store_failed",
];

// 서비스마다 host와 scope가 다른 OAuth secret 여섯이 한 목록에 쌓인다.
const SERVICES = [
  ["GDRIVE_TOKEN", "accounts.google.com", ["drive.file"]],
  ["GMAIL_TOKEN", "accounts.google.com", ["gmail.readonly", "gmail.send"]],
  ["NOTION_TOKEN", "api.notion.com", ["read_content"]],
  ["SLACK_TOKEN", "slack.com", ["chat:write"]],
  ["GITHUB_TOKEN", "github.com", ["repo"]],
  ["DROPBOX_TOKEN", "www.dropbox.com", ["files.content.write"]],
] as const;

export const OAUTH_FAILED: readonly SecretRowData[] = REASONS.map((
  reason,
  i,
) => ({
  name: SERVICES[i][0],
  configured: false,
  oauth: {
    ...drive,
    authorizeHost: SERVICES[i][1],
    scopes: SERVICES[i][2],
    state: "failed",
    reason,
  },
}));
