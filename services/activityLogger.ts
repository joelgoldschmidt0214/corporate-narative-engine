type EventPayload = Record<string, any>;

const isNode =
  typeof process !== "undefined" &&
  !!(process as any).versions &&
  !!(process as any).versions.node;

let LOG_DIR: string | null = null;
let LOG_FILE: string | null = null;
let fs: any = null;
let path: any = null;

// Initialize file system modules for Node environment
const initFs = async () => {
  if (isNode && !fs) {
    try {
      fs = await import("fs");
      path = await import("path");
      LOG_DIR = path.join(process.cwd(), "debug", "logs");
      LOG_FILE = path.join(LOG_DIR, "activity.log");
    } catch (e) {
      // ignore - running in browser
    }
  }
};

// Call init immediately
initFs();

const ensureDir = () => {
  if (!isNode || !fs || !LOG_DIR) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (e) {
    // ignore
  }
};

const timestamp = () => new Date().toISOString();

// In-memory log buffer for debugging UI
const logBuffer: any[] = [];
const MAX_BUFFER_SIZE = 500;

export const logEvent = (event: string, payload: EventPayload = {}) => {
  try {
    const entry = {
      ts: timestamp(),
      event,
      payload,
    };

    // Always add to in-memory buffer
    logBuffer.push(entry);
    if (logBuffer.length > MAX_BUFFER_SIZE) {
      logBuffer.shift();
    }

    if (isNode && fs && LOG_FILE) {
      ensureDir();
      fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", {
        encoding: "utf-8",
      });
    } else {
      // Browser fallback: write to console.debug
      // eslint-disable-next-line no-console
      console.debug("activityLog:", entry);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("activityLogger failed", e);
  }
};

// Export log buffer for debugging UI
export const getLogBuffer = () => [...logBuffer];
export const clearLogBuffer = () => {
  logBuffer.length = 0;
};
export const exportLogs = () => JSON.stringify(logBuffer, null, 2);

export default { logEvent, getLogBuffer, clearLogBuffer, exportLogs };
