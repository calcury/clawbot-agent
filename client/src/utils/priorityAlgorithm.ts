/**
 * 基于截止期迫近与最小松弛度 (Least Laxity First) 的动态紧迫度算法
 */

export interface DynamicUrgencyParams {
  dueDate: string | null;         // 截止日期 (YYYY-MM-DD 或 ISO 字符串)
  estimatedMinutes?: number;     // 预计耗时 (分钟)
  fallbackUrgency?: number;       // 若无截止日期时的保底紧迫度 (0~10)
  currentTime?: Date;            // 用于测试或基准时间
}

/**
 * 计算动态紧迫度 (0.0 ~ 10.0 分)
 * 核心原理：
 * 1. 剩余时间 T_remaining (小时)
 * 2. 预计耗时 T_effort (小时)
 * 3. 松弛时间 Slack = T_remaining - T_effort
 * 4. 随着 Slack 减小，紧迫度呈非线性（加速）增长：
 *    - 已逾期 (Slack < 0): 10.0 分 (极度危机)
 *    - 剩余可用松弛时间 < 12h: 9.0 ~ 9.9 分 (迫在眉睫)
 *    - 剩余可用松弛时间 < 24h: 7.5 ~ 8.9 分 (紧急冲刺)
 *    - 剩余可用松弛时间 < 72h (3天): 5.5 ~ 7.4 分 (需重点推进)
 *    - 剩余可用松弛时间 < 7天: 3.5 ~ 5.4 分 (进入视野)
 *    - 剩余时间 > 7天: 1.0 ~ 3.4 分 (从容按计划推进)
 */
export function calculateDynamicUrgency({
  dueDate,
  estimatedMinutes = 30,
  fallbackUrgency = 2.0,
  currentTime = new Date(),
}: DynamicUrgencyParams): {
  urgency: number;
  slackHours: number | null;
  remainingHours: number | null;
  statusText: string;
} {
  if (!dueDate) {
    return {
      urgency: Math.max(0, Math.min(10, fallbackUrgency)),
      slackHours: null,
      remainingHours: null,
      statusText: '未设置截止日期',
    };
  }

  // 计算目标截止时间（如果只有日期，默认按当天 23:59:59 截止）
  let dueDateTime: Date;
  if (dueDate.includes('T')) {
    dueDateTime = new Date(dueDate);
  } else {
    const [year, month, day] = dueDate.split('-').map(Number);
    dueDateTime = new Date(year, month - 1, day, 23, 59, 59);
  }

  const diffMs = dueDateTime.getTime() - currentTime.getTime();
  const remainingHours = diffMs / (1000 * 60 * 60);
  const effortHours = Math.max(0.1, (estimatedMinutes || 30) / 60);
  const slackHours = remainingHours - effortHours;

  let calculatedUrgency: number;
  let statusText: string;

  if (remainingHours <= 0) {
    // 已经逾期
    calculatedUrgency = 10.0;
    const overdueDays = Math.abs(Math.floor(remainingHours / 24));
    statusText = overdueDays > 0 ? `已逾期 ${overdueDays} 天` : '今天已逾期';
  } else if (slackHours <= 0) {
    // 剩余时间已不足以完成预计耗时（严重卡点）
    calculatedUrgency = 9.8;
    statusText = '耗时超限，剩余时间不足！';
  } else if (slackHours <= 12) {
    // 12小时以内
    calculatedUrgency = 9.0 + (1 - slackHours / 12) * 0.8;
    statusText = `余 ${Math.round(remainingHours)} 小时截止 (极紧迫)`;
  } else if (slackHours <= 24) {
    // 24小时以内 (今天)
    calculatedUrgency = 7.5 + (1 - (slackHours - 12) / 12) * 1.5;
    statusText = '24小时内到期';
  } else if (slackHours <= 72) {
    // 3天以内
    calculatedUrgency = 5.5 + (1 - (slackHours - 24) / 48) * 2.0;
    statusText = `余 ${Math.ceil(remainingHours / 24)} 天截止`;
  } else if (slackHours <= 168) {
    // 7天以内
    calculatedUrgency = 3.5 + (1 - (slackHours - 72) / 96) * 2.0;
    statusText = `余 ${Math.ceil(remainingHours / 24)} 天截止`;
  } else if (slackHours <= 720) {
    // 30天以内
    calculatedUrgency = 2.0 + (1 - (slackHours - 168) / 552) * 1.5;
    statusText = `余 ${Math.ceil(remainingHours / 24)} 天截止`;
  } else {
    // 长期任务
    calculatedUrgency = 1.0;
    statusText = '长期从容任务';
  }

  const rounded = Math.round(calculatedUrgency * 10) / 10;

  return {
    urgency: Math.max(0, Math.min(10, rounded)),
    slackHours: Math.round(slackHours * 10) / 10,
    remainingHours: Math.round(remainingHours * 10) / 10,
    statusText,
  };
}
