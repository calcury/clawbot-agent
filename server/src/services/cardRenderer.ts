import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { db } from '../config/database.js';
import { Task } from '../models/types.js';

function escapeXml(unsafe: string): string {
  return (unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getFontPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'server/assets/fonts/font.ttf'),
    path.resolve(process.cwd(), 'assets/fonts/font.ttf'),
    path.resolve('/home/calcury/clawbot-agent/server/assets/fonts/font.ttf'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function renderSvgToPng(svg: string): Buffer {
  const fontFile = getFontPath();
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: fontFile ? [fontFile] : [],
      loadSystemFonts: true,
      defaultFontFamily: fontFile ? 'SimHei' : 'sans-serif',
    },
    fitTo: {
      mode: 'zoom',
      value: 1.5, // 1.5x retina clarity
    },
  });
  return resvg.render().asPng();
}

/**
 * 1. Render modern "Today's Schedule & Calendar" PNG Image
 */
export async function renderCalendarImage(userId: number): Promise<Buffer> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

  // 1. Fetch external events for today
  const externalEvents = db.prepare(`
    SELECT title, start_time, end_time, is_all_day
    FROM external_events
    WHERE user_id = ? AND end_time >= ? AND start_time <= ?
    ORDER BY start_time ASC
  `).all(userId, startOfDay, endOfDay) as { title: string; start_time: string; end_time: string; is_all_day: number }[];

  // 2. Fetch scheduled tasks for today
  const scheduledTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ?
      AND scheduled_start IS NOT NULL
      AND scheduled_end IS NOT NULL
      AND scheduled_end >= ?
      AND scheduled_start <= ?
    ORDER BY scheduled_start ASC
  `).all(userId, startOfDay, endOfDay) as Task[];

  // Combine items
  interface TimelineItem {
    timeStr: string;
    type: 'task' | 'external';
    title: string;
    badge: string;
    badgeColor: string;
    subText: string;
    isCompleted?: boolean;
    startTimeVal: number;
  }

  const items: TimelineItem[] = [];

  for (const ext of externalEvents) {
    const sDate = new Date(ext.start_time);
    const eDate = new Date(ext.end_time);
    const timeStr = ext.is_all_day
      ? '全天日程'
      : `${sDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} - ${eDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    items.push({
      timeStr,
      type: 'external',
      title: ext.title,
      badge: '外部日程',
      badgeColor: '#8b5cf6', // purple
      subText: '已从订阅日历自动同步',
      startTimeVal: sDate.getTime(),
    });
  }

  for (const t of scheduledTasks) {
    const sDate = new Date(t.scheduled_start!);
    const eDate = new Date(t.scheduled_end!);
    const timeStr = `${sDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} - ${eDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    const isCompleted = t.status === 'completed';
    items.push({
      timeStr,
      type: 'task',
      title: t.title,
      badge: isCompleted ? '已完成' : '智能待办',
      badgeColor: isCompleted ? '#10b981' : '#3b82f6', // emerald or blue
      subText: `预计 ${t.duration_minutes} 分钟 · 紧急度 ${t.urgency}/5 · 重要度 ${t.importance}/5`,
      isCompleted,
      startTimeVal: sDate.getTime(),
    });
  }

  items.sort((a, b) => a.startTimeVal - b.startTimeVal);

  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const dateTitle = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]}`;

  const width = 800;
  const itemHeight = 72;
  const headerHeight = 170;
  const footerHeight = 70;
  const totalItems = Math.max(items.length, 1);
  const height = headerHeight + totalItems * itemHeight + footerHeight;

  let itemsSvg = '';
  if (items.length === 0) {
    itemsSvg = `
      <g transform="translate(40, ${headerHeight + 20})">
        <rect width="720" height="90" rx="16" fill="#1e293b" stroke="#334155" stroke-width="1"/>
        <text x="360" y="45" fill="#94a3b8" font-size="16" text-anchor="middle" font-weight="500">今日暂无日程或排程任务，尽情享受休息或随时向助手添加新任务！</text>
        <text x="360" y="70" fill="#64748b" font-size="13" text-anchor="middle">发送“帮我安排任务...”即可即刻规划</text>
      </g>
    `;
  } else {
    items.forEach((item, idx) => {
      const y = headerHeight + idx * itemHeight;
      const titleColor = item.isCompleted ? '#64748b' : '#f8fafc';
      const textDecor = item.isCompleted ? 'text-decoration="line-through"' : '';

      itemsSvg += `
        <g transform="translate(40, ${y})">
          <!-- Card background -->
          <rect width="720" height="60" rx="14" fill="#1e293b" stroke="#334155" stroke-width="1"/>
          
          <!-- Left Accent Color Indicator -->
          <rect x="0" y="0" width="5" height="60" rx="2" fill="${item.badgeColor}"/>
          
          <!-- Time Badge -->
          <rect x="18" y="16" width="116" height="28" rx="8" fill="#0f172a"/>
          <text x="76" y="35" fill="#38bdf8" font-size="13" font-weight="bold" text-anchor="middle">${escapeXml(item.timeStr)}</text>
          
          <!-- Category Badge -->
          <rect x="146" y="18" width="70" height="24" rx="6" fill="${item.badgeColor}" opacity="0.2"/>
          <text x="181" y="35" fill="${item.badgeColor}" font-size="11" font-weight="bold" text-anchor="middle">${escapeXml(item.badge)}</text>
          
          <!-- Title -->
          <text x="230" y="32" fill="${titleColor}" font-size="15" font-weight="600" ${textDecor}>${escapeXml(item.title.length > 22 ? item.title.slice(0, 22) + '...' : item.title)}</text>
          
          <!-- Subtitle / Notes -->
          <text x="230" y="48" fill="#94a3b8" font-size="11">${escapeXml(item.subText)}</text>
        </g>
      `;
    });
  }

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1e3a8a"/>
          <stop offset="50%" stop-color="#2563eb"/>
          <stop offset="100%" stop-color="#3b82f6"/>
        </linearGradient>
        <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#090d16"/>
        </linearGradient>
      </defs>

      <!-- Main Canvas Background -->
      <rect width="${width}" height="${height}" rx="24" fill="url(#cardGrad)"/>

      <!-- Header Banner -->
      <g transform="translate(40, 30)">
        <rect width="720" height="110" rx="20" fill="url(#headerGrad)"/>
        
        <!-- Logo / Title -->
        <text x="30" y="45" fill="#ffffff" font-size="22" font-weight="bold" letter-spacing="0.5">📅 今日智能日程日历</text>
        <text x="30" y="80" fill="#e0f2fe" font-size="16" font-weight="500">${escapeXml(dateTitle)}</text>
        
        <!-- Right stats chip -->
        <rect x="520" y="35" width="170" height="40" rx="12" fill="#ffffff" opacity="0.18"/>
        <text x="605" y="60" fill="#ffffff" font-size="14" font-weight="bold" text-anchor="middle">今日日程 ${items.length} 项</text>
      </g>

      <!-- Timeline Items -->
      ${itemsSvg}

      <!-- Footer Info -->
      <g transform="translate(40, ${height - 40})">
        <text x="20" y="16" fill="#64748b" font-size="12">✨ 由 Clawbot 智能排程引擎生成 · 数据已实时同步</text>
        <text x="700" y="16" fill="#64748b" font-size="12" text-anchor="end">${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} 更新</text>
      </g>
    </svg>
  `;

  return renderSvgToPng(svg);
}

/**
 * 2. Render Google Tasks Style "Todo List" PNG Image
 */
export async function renderTodoListImage(userId: number): Promise<Buffer> {
  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ?
    ORDER BY 
      CASE status 
        WHEN 'in_progress' THEN 1 
        WHEN 'scheduled' THEN 2 
        WHEN 'pending' THEN 3 
        WHEN 'completed' THEN 4 
      END ASC,
      urgency DESC,
      scheduled_start ASC
    LIMIT 12
  `).all(userId) as Task[];

  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const scheduledCount = tasks.filter((t) => t.status === 'scheduled').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;

  const width = 800;
  const itemHeight = 74;
  const headerHeight = 170;
  const footerHeight = 70;
  const totalTasks = Math.max(tasks.length, 1);
  const height = headerHeight + totalTasks * itemHeight + footerHeight;

  let tasksSvg = '';

  if (tasks.length === 0) {
    tasksSvg = `
      <g transform="translate(40, ${headerHeight + 20})">
        <rect width="720" height="90" rx="16" fill="#1e293b" stroke="#334155" stroke-width="1"/>
        <text x="360" y="45" fill="#94a3b8" font-size="16" text-anchor="middle" font-weight="500">待办清单空空如也，真棒！</text>
        <text x="360" y="70" fill="#64748b" font-size="13" text-anchor="middle">发送“帮我安排任务...”可立即规划新任务</text>
      </g>
    `;
  } else {
    tasks.forEach((t, idx) => {
      const y = headerHeight + idx * itemHeight;
      const isCompleted = t.status === 'completed';
      const isInProgress = t.status === 'in_progress';

      // Priority color & badge
      let pColor = '#3b82f6';
      let pLabel = '普通 P3';
      if (t.urgency >= 5 || t.importance >= 5) {
        pColor = '#ef4444';
        pLabel = '紧急 P1';
      } else if (t.urgency >= 4 || t.importance >= 4) {
        pColor = '#f59e0b';
        pLabel = '加急 P2';
      }

      const checkFill = isCompleted ? '#10b981' : '#334155';
      const checkStroke = isCompleted ? '#10b981' : '#64748b';
      const titleColor = isCompleted ? '#64748b' : '#f8fafc';
      const titleDecor = isCompleted ? 'text-decoration="line-through"' : '';

      // Scheduled time or DDL
      let timeText = `耗时 ${t.duration_minutes} 分钟`;
      if (t.scheduled_start && t.scheduled_end) {
        const sTime = new Date(t.scheduled_start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
        const eTime = new Date(t.scheduled_end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
        timeText += ` · 安排: ${sTime}-${eTime}`;
      }
      if (t.deadline) {
        const dDate = new Date(t.deadline);
        timeText += ` · 截止: ${dDate.getMonth() + 1}/${dDate.getDate()} ${dDate.getHours()}:${String(dDate.getMinutes()).padStart(2, '0')}`;
      }

      tasksSvg += `
        <g transform="translate(40, ${y})">
          <!-- Card background -->
          <rect width="720" height="62" rx="14" fill="${isInProgress ? '#1e293b' : '#172033'}" stroke="${isInProgress ? '#3b82f6' : '#334155'}" stroke-width="${isInProgress ? 1.5 : 1}"/>
          
          <!-- Checkbox circle -->
          <circle cx="32" cy="31" r="12" fill="${checkFill}" stroke="${checkStroke}" stroke-width="2"/>
          ${isCompleted ? '<path d="M26 31 L30 35 L38 27" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>' : ''}
          
          <!-- Priority pill -->
          <rect x="58" y="19" width="60" height="24" rx="6" fill="${pColor}" opacity="0.2"/>
          <text x="88" y="36" fill="${pColor}" font-size="11" font-weight="bold" text-anchor="middle">${pLabel}</text>
          
          <!-- Title -->
          <text x="130" y="33" fill="${titleColor}" font-size="15" font-weight="600" ${titleDecor}>${escapeXml(t.title.length > 25 ? t.title.slice(0, 25) + '...' : t.title)}</text>
          
          <!-- Meta details -->
          <text x="130" y="50" fill="#94a3b8" font-size="11">${escapeXml(timeText)}</text>
          
          <!-- Right status tag -->
          <text x="700" y="36" fill="${isInProgress ? '#60a5fa' : isCompleted ? '#10b981' : '#94a3b8'}" font-size="12" font-weight="500" text-anchor="end">
            ${isInProgress ? '⚡ 进行中' : isCompleted ? '✅ 已打勾' : '🕒 已规划'}
          </text>
        </g>
      `;
    });
  }

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="todoHeaderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0284c7"/>
          <stop offset="50%" stop-color="#0ea5e9"/>
          <stop offset="100%" stop-color="#38bdf8"/>
        </linearGradient>
        <linearGradient id="todoBgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#090d16"/>
        </linearGradient>
      </defs>

      <!-- Background -->
      <rect width="${width}" height="${height}" rx="24" fill="url(#todoBgGrad)"/>

      <!-- Header -->
      <g transform="translate(40, 30)">
        <rect width="720" height="110" rx="20" fill="url(#todoHeaderGrad)"/>
        <text x="30" y="45" fill="#ffffff" font-size="22" font-weight="bold">📝 待办任务清单 (Todo List)</text>
        <text x="30" y="80" fill="#f0f9ff" font-size="15" font-weight="500">进行中 ${inProgressCount} · 已规划 ${scheduledCount} · 已完成 ${completedCount}</text>
        
        <rect x="520" y="35" width="170" height="40" rx="12" fill="#ffffff" opacity="0.2"/>
        <text x="605" y="60" fill="#ffffff" font-size="14" font-weight="bold" text-anchor="middle">共 ${tasks.length} 项任务</text>
      </g>

      <!-- Task items -->
      ${tasksSvg}

      <!-- Footer -->
      <g transform="translate(40, ${height - 40})">
        <text x="20" y="16" fill="#64748b" font-size="12">💡 微信回复“安排任务 [内容]”即刻智能规划 · 回复“完成任务 [名称]”打勾完成</text>
        <text x="700" y="16" fill="#64748b" font-size="12" text-anchor="end">Clawbot Tasks</text>
      </g>
    </svg>
  `;

  return renderSvgToPng(svg);
}
