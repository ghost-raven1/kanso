declare const __KANSO_BUILD_ID__: string;
interface Window {
  kansoMetrics?: { counterMounts: number; rowMounts: number; activeEffects: number };
  kansoReady?: boolean;
}
