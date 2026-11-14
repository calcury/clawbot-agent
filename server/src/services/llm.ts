import OpenAI from 'openai';
import { LLMExtractionResult, UserSettings } from '../models/types.js';

export async function parseUserMessageWithLLM(
  message: string,
  settings: UserSettings,
  pendingContext?: any
): Promise<LLMExtractionResult> {
  const endpoint = settings.llm_endpoint || 'https://api.deepseek.com/v1';
  const apiKey = settings.llm_api_key || process.env.DEEPSEEK_API_KEY || '';
  const model = settings.llm_model || 'deepseek-chat';

  if (!apiKey) {
    throw new Error('未配置 LLM API Key，请先在管理后台设置中填入 DeepSeek API Key');
  }

  const client = new OpenAI({
    baseURL: endpoint,
    apiKey: apiKey,
  });

  const now = new Date();
  const currentLocalTimeStr = now.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
  });

  const systemPrompt = `你是一个智能日程与任务提取助手。
当前时间上下文是：${currentLocalTimeStr}（中国标准时间）。
请分析用户的微信消息，提取日程与待办事项关键信息，并严格以纯 JSON 格式返回，不要包含 markdown 标记或任何其他文本。
必须严格与 oxoxox-oxox/Eisenhower-Matrix 任务模型字段标准对齐。

JSON 格式规范：
{
  "intent": "create_task" | "status_update" | "query_schedule" | "other",
  "title": string | null,               // 任务名称/事件标题
  "description": string | null,         // 任务背景描述、备注或详情
  "estimatedMinutes": number | null,    // 预计耗时分钟数（例如 1小时提取为 60，半小时为 30）
  "duration_minutes": number | null,    // 同 estimatedMinutes，预估耗时分钟数
  "importance": number | null,          // 战略重要度评分，浮点数 0.0 ~ 10.0（5.0为重要临界线，涉及核心交付、领导、关键考试为 7.0~9.0，一般事务为 2.0~4.0，默认 7.0）
  "urgency": number | null,             // 紧迫度评分，浮点数 0.0 ~ 10.0（若用户未明说，将依据截止期迫近算法由 dueDate 自动计算，可设为 null 或 2.0~5.0）
  "dueDate": string | null,             // 截止日期，格式严格为 "YYYY-MM-DD"（例如 "2026-11-15"）
  "deadline": string | null,            // 截止时间，结合当前时间转换为完整 ISO 8601 字符串（例如 "2026-11-15T18:00:00+08:00"）
  "tags": string[] | null,              // 自动提取的标签数组（例如 ["工作", "紧急", "汇报"]）
  "status_action": "complete" | "extend" | "reschedule" | "cancel" | null, // 用户状态汇报动作
  "extend_minutes": number | null,      // 延长时间分钟数（若用户说"再延半小时"则为 30）
  "target_task_name": string | null     // 关联的任务名（如有）
}

说明与示例：
1. 若用户正在回答上一轮补齐问题（当前存在待补齐上下文：${JSON.stringify(pendingContext || null)}），请将用户的新消息解析并合并到字段中。
2. 若用户说"我弄完了"、"提前完成了"、"搞定" -> intent 为 "status_update", status_action 为 "complete"
3. 若用户说"时间不够，延半小时" -> intent 为 "status_update", status_action 为 "extend", extend_minutes 为 30
4. 若用户说"重新安排" -> intent 为 "status_update", status_action 为 "reschedule"
5. 若用户说"看看今天的日程"、"待办有哪些" -> intent 为 "query_schedule"
6. 若只是问候或无关问题 -> intent 为 "other"
7. 字段对齐要求：
   - title: 任务简明标题
   - description: 详细说明
   - estimatedMinutes / duration_minutes: 必须保持一致为整数分钟
   - dueDate: 本地日期 "YYYY-MM-DD"
   - deadline: 完整 ISO 时间
   - importance: 0.0 ~ 10.0 浮点数，>= 5.0 为重要
   - urgency: 0.0 ~ 10.0 浮点数，>= 5.0 为紧迫
   - tags: 任务关键词分类
`;

  try {
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('LLM 返回内容为空');
    }

    const parsed = JSON.parse(content) as LLMExtractionResult;
    return parsed;
  } catch (err: any) {
    console.error('LLM 解析出错:', err.message);
    throw err;
  }
}
