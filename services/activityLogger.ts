import type {} from "node:fs";

type EventPayload = Record<string, any>;

const isNode =
  typeof process !== "undefined" &&
  !!(process as any).versions &&
  !!(process as any).versions.node;

let LOG_DIR: string | null = null;
let LOG_FILE: string | null = null;
let fs: any = null;
let path: any = null;

if (isNode) {
  // require lazily so bundlers don't include fs for browser builds
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  fs = require("fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  path = require("path");
  LOG_DIR = path.join(process.cwd(), "debug", "logs");
  LOG_FILE = path.join(LOG_DIR, "activity.log");
}

const ensureDir = () => {
  if (!isNode || !fs || !LOG_DIR) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (e) {
    // ignore
  }
};

const timestamp = () => new Date().toISOString();

export const logEvent = (event: string, payload: EventPayload = {}) => {
  try {
    const entry = {
      ts: timestamp(),
      event,
      payload,
    };
    if (isNode && fs && LOG_FILE) {
      ensureDir();
      fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", {
        encoding: "utf-8",
      });
    } else {
      // Browser fallback: write to console.debug to avoid breaking UI
      // eslint-disable-next-line no-console
      console.debug("activityLog (browser):", entry);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("activityLogger failed", e);
  }
};

export default { logEvent };
