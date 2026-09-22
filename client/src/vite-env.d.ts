/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Game server origin (e.g. https://api.example.com) when the client is hosted elsewhere; default: same origin. */
  readonly VITE_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
