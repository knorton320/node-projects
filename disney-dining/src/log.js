import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

let logFile = null;

// Also append every log line to `file`. If the file is already over `maxBytes`, it is renamed to
// `<file>.1` first (replacing any older one), so only one old file is kept.
export function enableFileLog(file, { maxBytes = 5 * 1024 * 1024 } = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (statSync(file).size > maxBytes) renameSync(file, `${file}.1`);
  } catch {
    // no file yet
  }
  logFile = file;
}

export function disableFileLog() {
  logFile = null;
}

function emit(level, msg, data) {
  const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
  if (logFile) {
    try {
      appendFileSync(logFile, `${line}\n`);
    } catch {
      // logging must never crash a check
    }
  }
}

export const log = {
  debug: (msg, data) => emit('debug', msg, data),
  info: (msg, data) => emit('info', msg, data),
  warn: (msg, data) => emit('warn', msg, data),
  error: (msg, data) => emit('error', msg, data),
};
