/* Lightweight logger used in development. Supports runtime toggle via localStorage key `enableDebugLogs`. */
type LogLevel = "debug" | "info" | "warn" | "error";

const isBrowser =
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const LOCAL_KEY = "enableDebugLogs";

const getEnabled = () => {
  try {
    if (isBrowser) {
      const host = window.location && window.location.hostname;
      // Auto-enable on localhost or when NODE_ENV is not production
      if (host === "localhost" || host === "127.0.0.1") return true;
      const fromStorage = window.localStorage.getItem(LOCAL_KEY);
      if (fromStorage === "1") return true;
      // Fallback: enable when not production
      if ((window as any).__DEV__ || process.env.NODE_ENV !== "production")
        return true;
      return false;
    }
    return (
      process.env.NODE_ENV !== "production" ||
      process.env.ENABLE_DEBUG_LOGS === "1"
    );
  } catch (e) {
    return false;
  }
};

let enabled = getEnabled();

export const setEnableDebugLogs = (v: boolean) => {
  enabled = v;
  if (isBrowser) window.localStorage.setItem(LOCAL_KEY, v ? "1" : "0");
};

const timestamp = () => new Date().toISOString();

const format = (level: LogLevel, args: any[]) => {
  const prefix = `[${timestamp()}] [${level.toUpperCase()}]`;
  return [prefix, ...args];
};

export const logger = {
  debug: (...args: any[]) => {
    if (!enabled) return;
    // eslint-disable-next-line no-console
    console.debug(...format("debug", args));
  },
  info: (...args: any[]) => {
    // eslint-disable-next-line no-console
    console.info(...format("info", args));
  },
  warn: (...args: any[]) => {
    // eslint-disable-next-line no-console
    console.warn(...format("warn", args));
  },
  error: (...args: any[]) => {
    // eslint-disable-next-line no-console
    console.error(...format("error", args));
  },
  isEnabled: () => enabled,
};

export default logger;
