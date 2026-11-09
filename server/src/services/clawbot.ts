import axios from 'axios';
import { Task, UserSettings } from '../models/types.js';

export const templates = {
  /**
   * 当任务关键字段缺失时，向用户索取补充信息的模板
   */
  askMissingFields: (
    title: string,
    missing: {
      duration: boolean;
      deadline: boolean;
      urgency: boolean;
      importance: boolean;
    }
  ) => {
    const list: string[] = [];
    let idx = 1;
    if (missing.duration) {
      list.push(`${idx++}️⃣ 预计耗时多少分钟？（如：45分钟、2小时）`);
    }
    if (missing.deadline) {
      list.push(`${idx++}️⃣ 最晚何时前需要搞定（DDL）？（如：今天下午6点、明天中午12点）`);
    }
    if (missing.urgency) {
      list.push(`${idx++}️⃣ 紧急程度？（1-5分，5为最加急）`);
    }
    if (missing.importance) {
      list.push(`${idx++}️⃣ 重要程度？（1-5分，5为最重要）`);
    }

    return (
      `📝【待办信息确认】\n` +
      `已识别到新任务「${title}」，请回复补充以下信息以智能排入日历：\n\n` +
      list.join('\n') +
      `\n\n💡 一句话回复全部即可，例如："耗时1小时，周五前完成，紧急4重要4"`
    );
  },

  /**
   * 日程规划成功提醒
   */
  scheduleSuccess: (
    title: string,
    startStr: string,
    endStr: string,
    duration: number,
    urgency: number,
    importance: number
  ) => {
    return (
      `📅【日程已智能安排】\n` +
      `📌 任务：${title}\n` +
      `🕒 时间：${startStr} ~ ${endStr}\n` +
      `⏳ 耗时：${duration} 分钟\n` +
      `⚡ 紧急度：${urgency}/5 | 重要度：${importance}/5\n` +
      `✨ 已避开您的现有外部日程，安排在空闲工作时段内。\n` +
      `已自动同步至您的专属 TODO 订阅日历！`
    );
  },

  /**
   * 排程未找到合适空隙的提醒
   */
  scheduleFailed: (title: string, duration: number, reason: string) => {
    return (
      `⚠️【日程安排提醒】\n` +
      `任务「${title}」（需 ${duration} 分钟）暂时无法排入日历。\n` +
      `原因：${reason}\n` +
      `建议：您可以回复调整截止时间，或在管理后台调整工作时段。`
    );
  },

  /**
   * 提前完成模板
   */
  taskCompleted: (title: string) => {
    return (
      `🎉【任务已提前完成】\n` +
      `任务「${title}」已标记完成！\n` +
      `该任务剩余时间已为您自动释放回可用空闲时段。`
    );
  },

  /**
   * 延长时长模板
   */
  taskExtended: (title: string, extendMinutes: number, newEndStr: string) => {
    return (
      `⏱️【任务时间已延长】\n` +
      `任务「${title}」已延长 ${extendMinutes} 分钟，新的预计结束时间为：${newEndStr}。\n` +
      `系统已同步校验后续日程安排。`
    );
  },

  /**
   * 重新安排模板
   */
  taskRescheduled: (title: string, newStartStr: string, newEndStr: string) => {
    return (
      `🔄【任务已重新规划】\n` +
      `任务「${title}」已重新调整排程！\n` +
      `新时间为：${newStartStr} ~ ${newEndStr}，已同步至日历。`
    );
  },

  /**
   * 开始前提醒模板
   */
  reminderBeforeStart: (title: string, startStr: string, endStr: string, minutes: number) => {
    return (
      `🔔【日程开始提醒】\n` +
      `您安排的任务「${title}」即将在 ${minutes} 分钟后开始！\n` +
      `规划时间：${startStr} ~ ${endStr}\n` +
      `请做好准备，保持专注～`
    );
  },

  /**
   * 结束前核对询问模板
   */
  reminderBeforeEnd: (title: string, minutes: number) => {
    return (
      `⏰【任务进度核对】\n` +
      `您的任务「${title}」预计还有约 ${minutes} 分钟结束。\n` +
      `请问当前是否已经完成？\n\n` +
      `• 已搞定：直接回复「已完成」\n` +
      `• 需延时：直接回复「延长30分钟」（或具体分钟）\n` +
      `• 需重排：直接回复「重新安排」`
    );
  },

  /**
   * 每日日程概览
   */
  scheduleQueryList: (tasks: Task[], dateStr: string) => {
    if (tasks.length === 0) {
      return `📅【${dateStr} 日程概览】\n今天暂无规划中的待办任务，享受高效轻松的一天吧！`;
    }

    const lines = tasks.map((t, i) => {
      const s = t.scheduled_start ? new Date(t.scheduled_start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--';
      const e = t.scheduled_end ? new Date(t.scheduled_end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--';
      const statusIcon = t.status === 'completed' ? '✅' : '📌';
      return `${i + 1}. ${statusIcon} [${s}-${e}] ${t.title} (${t.duration_minutes}分钟)`;
    });

    return `📅【${dateStr} 日程待办】\n` + lines.join('\n');
  },
};

/**
 * Send message out to WeChat via Clawbot Gateway API
 */
export async function sendClawbotMessage(settings: UserSettings, message: string): Promise<boolean> {
  if (!settings.clawbot_outbound_url) {
    console.log('[Clawbot Outbound Mock] (未配置 outbound_url，直接打印至控制台):');
    console.log(message);
    return true;
  }

  try {
    const payload = {
      to: settings.clawbot_to_wxid || undefined,
      content: message,
      text: message,
      message: message,
      key: settings.clawbot_outbound_key || undefined,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (settings.clawbot_outbound_key) {
      headers['Authorization'] = `Bearer ${settings.clawbot_outbound_key}`;
    }

    await axios.post(settings.clawbot_outbound_url, payload, {
      headers,
      timeout: 8000,
    });
    return true;
  } catch (err: any) {
    console.error('[Clawbot Outbound Error]:', err.message);
    return false;
  }
}
