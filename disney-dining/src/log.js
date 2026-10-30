const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function emit(level, msg, data) {
  const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export const log = {
  debug: (msg, data) => emit('debug', msg, data),
  info: (msg, data) => emit('info', msg, data),
  warn: (msg, data) => emit('warn', msg, data),
  error: (msg, data) => emit('error', msg, data),
};
