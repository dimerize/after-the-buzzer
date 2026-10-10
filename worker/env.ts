export interface Env {
  DB: D1Database; ASSETS: Fetcher; APP_PASSWORD?: string; LOCAL_DEV?: string;
  OPENAI_API_KEY?: string; AI_MODEL?: string; AI_MONTHLY_LIMIT?: string;
  VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string;
}
