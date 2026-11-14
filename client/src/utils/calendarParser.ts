import ICAL from 'ical.js';
import type { CalendarEvent } from '../types/calendar';

/**
 * 获取并拉取远程订阅链接的 ICS 文本内容
 */
export async function fetchIcsFeed(url: string): Promise<string> {
  const cleanUrl = url.trim();
  if (!cleanUrl) {
    throw new Error('订阅链接不能为空');
  }

  let localProxyError: string | null = null;

  // 尝试策略 1: 本地开发与预览代理端点 (/api/calendar-proxy)
  try {
    const proxyEndpoint = `/api/calendar-proxy?url=${encodeURIComponent(cleanUrl)}`;
    const res = await fetch(proxyEndpoint);
    if (res.ok) {
      const data = await res.text();
      if (data && data.includes('BEGIN:VCALENDAR')) {
        return data;
      }
    } else {
      const errMsg = await res.text();
      localProxyError = errMsg || `HTTP ${res.status}`;
      console.warn('Local proxy failed with message:', localProxyError);
    }
  } catch (e: any) {
    localProxyError = e.message || '本地代理服务未响应';
    console.warn('Local proxy request error:', e);
  }

  // 尝试策略 2: 公共 CORS 代理 (在无法访问本地 Vite 代理时的后备)
  const targetUrl = cleanUrl.replace(/^webcal:\/\//i, 'https://');
  try {
    const fallbackEndpoint = `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`;
    const res = await fetch(fallbackEndpoint);
    if (res.ok) {
      const data = await res.text();
      if (data && data.includes('BEGIN:VCALENDAR')) {
        return data;
      }
    }
  } catch (e) {
    console.warn('Fallback proxy failed:', e);
  }

  // 尝试策略 3: 直接 fetch (部分支持跨域 CORS 的日历服务器)
  try {
    const directRes = await fetch(targetUrl);
    if (directRes.ok) {
      const data = await directRes.text();
      if (data && data.includes('BEGIN:VCALENDAR')) {
        return data;
      }
    }
  } catch {
    // 忽略直接跨域失败
  }

  // 若全部失败，优先抛出本地代理给出的具体诊断错误，而不是模糊的 Failed to fetch
  if (localProxyError) {
    throw new Error(`日历订阅拉取失败: ${localProxyError}`);
  }

  throw new Error('无法连接到日历订阅源，请检查链接有效性或网络连接');
}

/**
 * 将 ICAL.Time 转换为本地墙上时钟时间 (Wall-Clock Date)
 * 解决教务/课表导出系统将本地 09:00 误标记为 UTC Z (09:00Z) 导致在本地 UTC+8 环境下被错误偏移到 17:00 的问题
 */
export function icalTimeToWallClockDate(icalTime: any): Date {
  if (!icalTime) return new Date();

  // 若为全天事件
  if (icalTime.isDate) {
    return new Date(icalTime.year, icalTime.month - 1, icalTime.day, 0, 0, 0, 0);
  }

  // 提取原始小时、分钟与秒数，直接按当地时钟构建，锁定真实作息时间（早九就是 09:00）
  return new Date(
    icalTime.year,
    icalTime.month - 1,
    icalTime.day,
    icalTime.hour || 0,
    icalTime.minute || 0,
    icalTime.second || 0,
    0
  );
}

/**
 * 将 ICS 文本解析为结构化的 CalendarEvent 数组，支持完整的 RRULE 循环日程展开与墙上时钟锁定
 */
export function parseIcsText(
  icsText: string,
  rangeStart?: Date,
  rangeEnd?: Date
): CalendarEvent[] {
  try {
    // 剔除可能存在的 UTF-8 BOM 字符与头尾空白
    const sanitizedIcs = icsText.replace(/^\uFEFF/, '').trim();
    if (!sanitizedIcs.includes('BEGIN:VCALENDAR')) {
      throw new Error('返回的内容不是合法的 iCalendar (ICS) 数据');
    }

    const jcalData = ICAL.parse(sanitizedIcs);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents('vevent');

    const now = new Date();
    // 默认展开时间窗：过去 90 天至未来 365 天（完整覆盖大学学期与全学年日程）
    const windowStart = rangeStart || new Date(now.getTime() - 90 * 24 * 3600 * 1000);
    const windowEnd = rangeEnd || new Date(now.getTime() + 365 * 24 * 3600 * 1000);

    const parsedList: CalendarEvent[] = [];

    for (const subcomp of vevents) {
      const event = new ICAL.Event(subcomp);

      let isAllDay = false;
      let durationMs = 3600 * 1000;

      if (!event.startDate) continue;
      isAllDay = event.startDate.isDate;

      if (event.duration) {
        durationMs = event.duration.toSeconds() * 1000;
      } else if (event.endDate && event.startDate) {
        const s = icalTimeToWallClockDate(event.startDate);
        const e = icalTimeToWallClockDate(event.endDate);
        durationMs = Math.max(15 * 60 * 1000, e.getTime() - s.getTime());
      }

      // 1. 普通非重复事件
      if (!event.isRecurring()) {
        const startDate = icalTimeToWallClockDate(event.startDate);
        const endDate = event.endDate
          ? icalTimeToWallClockDate(event.endDate)
          : new Date(startDate.getTime() + durationMs);

        parsedList.push({
          id: event.uid || `event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: event.summary || '未命名既定日程',
          start: startDate,
          end: endDate,
          description: event.description || undefined,
          location: event.location || undefined,
          isAllDay,
        });
      } else {
        // 2. 周期性重复事件 (如大学课程表 RRULE:FREQ=WEEKLY)
        try {
          const it = event.iterator();
          let next: any;
          let count = 0;
          const maxOccurrences = 500; // 防止无限循环

          while ((next = it.next()) && count < maxOccurrences) {
            count++;
            const occStart = icalTimeToWallClockDate(next);

            // 若发生时间已超出未来窗口，终止迭代
            if (occStart > windowEnd) {
              break;
            }

            // 若落在目标窗口内，记录该具体发生实例
            if (occStart >= windowStart) {
              const occEnd = new Date(occStart.getTime() + durationMs);
              parsedList.push({
                id: `${event.uid || 'course'}-occ-${occStart.getTime()}`,
                title: event.summary || '未命名周期课程',
                start: occStart,
                end: occEnd,
                description: event.description || undefined,
                location: event.location || undefined,
                isAllDay,
              });
            }
          }
        } catch (iterErr) {
          console.warn(`展开循环事件 "${event.summary}" 失败，降级使用单次起始时间`, iterErr);
          const startDate = icalTimeToWallClockDate(event.startDate);
          const endDate = event.endDate
            ? icalTimeToWallClockDate(event.endDate)
            : new Date(startDate.getTime() + durationMs);
          parsedList.push({
            id: event.uid || `event-${Date.now()}`,
            title: event.summary || '未命名日程',
            start: startDate,
            end: endDate,
            description: event.description || undefined,
            location: event.location || undefined,
            isAllDay,
          });
        }
      }
    }

    return parsedList;
  } catch (err: any) {
    console.error('ICS parse error:', err);
    throw new Error(`解析日历数据失败: ${err.message || '文件格式不合法'}`);
  }
}

/**
 * 筛选属于指定日期的非全天与全天事件
 */
export function getEventsForDay(events: CalendarEvent[], targetDate: Date): CalendarEvent[] {
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  return events.filter((ev) => {
    return ev.start < endOfDay && ev.end > startOfDay;
  });
}
