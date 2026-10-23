import {
  OAUTH_FAILED,
  OAUTH_READY,
  OAUTH_SETUP,
  OAUTH_SIGNED_IN,
  OAUTH_WAITING,
  SECRETS_ONLY,
} from "./data.ts";
import { SecretRows } from "./secret-rows.tsx";
import styles from "./secret-rows.module.css";

export const AccessSecrets = () => (
  <div className={styles.page}>
    <SecretRows rows={SECRETS_ONLY} />
  </div>
);
export const AccessOAuthSetup = () => (
  <div className={styles.page}>
    <SecretRows rows={OAUTH_SETUP} />
  </div>
);
export const AccessOAuthReady = () => (
  <div className={styles.page}>
    <SecretRows rows={OAUTH_READY} />
  </div>
);
export const AccessOAuthWaiting = () => (
  <div className={styles.page}>
    <SecretRows rows={OAUTH_WAITING} />
  </div>
);
export const AccessOAuthSignedIn = () => (
  <div className={styles.page}>
    <SecretRows rows={OAUTH_SIGNED_IN} />
  </div>
);
export const AccessOAuthFailed = () => (
  <div className={styles.page}>
    <SecretRows rows={OAUTH_FAILED} />
  </div>
);
