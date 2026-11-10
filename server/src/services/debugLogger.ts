export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  module: 'Weixin' | 'LLM' | 'Scheduler' | 'Calendar' | 'Auth' | 'System';
  message: string;
  details?: any;
}

const MAX_LOGS = 600;
const logBuffer: LogEntry[] = [];
let logIdCounter = 1;

// Keep original console references to avoid duplicate capture
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

export function addDebugLog(
  module: LogEntry['module'],
  level: LogEntry['level'],
  message: string,
  details?: any
): LogEntry {
  const entry: LogEntry = {
    id: `log-${Date.now()}-${logIdCounter++}`,
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    details: details ? (typeof details === 'object' ? details : { raw: String(details) }) : undefined,
  };

  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }

  // Print to standard console without triggering intercepted re-capture
  const prefix = `[${entry.module}] [${entry.level.toUpperCase()}]`;
  if (level === 'error') {
    originalConsoleError(prefix, message, details || '');
  } else if (level === 'warn') {
    originalConsoleWarn(prefix, message, details || '');
  } else {
    originalConsoleLog(prefix, message, details || '');
  }

  return entry;
}

export function getRecentLogs(limit = 200, level?: string, module?: string): LogEntry[] {
  let logs = [...logBuffer];
  if (level && level !== 'all') {
    logs = logs.filter((l) => l.level === level);
  }
  if (module && module !== 'all') {
    logs = logs.filter((l) => l.module.toLowerCase() === module.toLowerCase());
  }
  return logs.slice(-limit);
}

export function clearLogs(): void {
  logBuffer.length = 0;
  addDebugLog('System', 'info', '调试日志缓冲区已重置清空');
}

export function installConsoleInterceptor() {
  console.log = (...args: any[]) => {
    originalConsoleLog.apply(console, args);
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    if (msg.startsWith('[Weixin') || msg.startsWith('[Scheduler') || msg.startsWith('[LLM') || msg.startsWith('[Calendar')) {
      const mod = msg.includes('Weixin')
        ? 'Weixin'
        : msg.includes('Scheduler')
        ? 'Scheduler'
        : msg.includes('LLM')
        ? 'LLM'
        : 'System';
      logBuffer.push({
        id: `log-${Date.now()}-${logIdCounter++}`,
        timestamp: new Date().toISOString(),
        level: 'info',
        module: mod as any,
        message: msg,
      });
      if (logBuffer.length > MAX_LOGS) logBuffer.shift();
    }
  };

  console.warn = (...args: any[]) => {
    originalConsoleWarn.apply(console, args);
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    logBuffer.push({
      id: `log-${Date.now()}-${logIdCounter++}`,
      timestamp: new Date().toISOString(),
      level: 'warn',
      module: msg.includes('Weixin') ? 'Weixin' : 'System',
      message: msg,
    });
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  };

  console.error = (...args: any[]) => {
    originalConsoleError.apply(console, args);
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    logBuffer.push({
      id: `log-${Date.now()}-${logIdCounter++}`,
      timestamp: new Date().toISOString(),
      level: 'error',
      module: msg.includes('Weixin') ? 'Weixin' : 'System',
      message: msg,
    });
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  };
}
