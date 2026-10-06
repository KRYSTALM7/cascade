/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin for production builds, e.g. https://cascade-api-xyz.a.run.app. Empty = same origin. */
  readonly VITE_API_BASE_URL?: string;
}
