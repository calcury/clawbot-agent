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

JSON 格式规范：
{
  "intent": "create_task" | "status_update" | "query_schedule" | "other",
  "title": string | null,               // 任务名称/事件标题
  "duration_minutes": number | null,     // 预估耗时分钟数（例如 1小时提取为 60，半小时为 30）
  "urgency": number | null,              // 紧急程度 1~5（5为最紧急，如果提到加急、紧急则为 4或5，一般默认为 3）
  "importance": number | null,           // 重要程度 1~5（5为最重要，涉及核心汇报、领导、客户则为 4或5，一般默认为 3）
  "deadline": string | null,             // 截止时间，必须结合当前时间转换为完整 ISO 8601 字符串（例如 "2026-11-10T18:00:00+08:00"）
  "status_action": "complete" | "extend" | "reschedule" | "cancel" | null, // 用户状态汇报动作
  "extend_minutes": number | null,       // 延长时间分钟数（若用户说"再延半小时"则为 30）
  "target_task_name": string | null      // 关联的任务名（如有）
}

说明与示例：
1. 若用户正在回答上一轮补齐问题（当前存在待补齐上下文：${JSON.stringify(pendingContext || null)}），请将用户的新消息解析并合并到字段中。
2. 若用户说"我弄完了"、"提前完成了"、"搞定" -> intent 为 "status_update", status_action 为 "complete"
3. 若用户说"时间不够，延半小时" -> intent 为 "status_update", status_action 为 "extend", extend_minutes 为 30
4. 若用户说"重新安排" -> intent 为 "status_update", status_action 为 "reschedule"
5. 若用户说"看看今天的日程"、"待办有哪些" -> intent 为 "query_schedule"
6. 若只是问候或无关问题 -> intent 为 "other"
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
