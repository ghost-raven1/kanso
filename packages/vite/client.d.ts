declare module 'virtual:kanso/service-worker' {
  export const serviceWorkerUrl: string | undefined;
  export const serviceWorkerEnabled: boolean;
}
interface ImportMetaEnv { readonly KANSO_SERVICE_WORKER_BUILD_ID: string }
