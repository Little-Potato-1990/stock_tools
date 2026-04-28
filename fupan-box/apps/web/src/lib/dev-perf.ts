const isNonProd = process.env.NODE_ENV !== "production";
const isEnabledByEnv = process.env.NEXT_PUBLIC_DEV_PERF === "1";

function isEnabledByWindow(): boolean {
  if (typeof window === "undefined") return false;
  return (window as { __DEV_PERF__?: boolean }).__DEV_PERF__ === true;
}

export function isDevPerfEnabled(): boolean {
  if (!isNonProd) return false;
  return isEnabledByEnv || isEnabledByWindow();
}

export function logDevPerf(scope: string, name: string, ms: number, payload: Record<string, unknown>): void {
  if (!isDevPerfEnabled()) return;
  console.debug(`[${scope}] ${name} -> ${ms.toFixed(1)}ms`, payload);
}
