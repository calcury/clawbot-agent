import React, { useState } from 'react';
import type { TaskItem } from '../types/task';
import { QUADRANTS_CONFIG } from '../constants/quadrants';
import { X, Download, Upload, Copy, Check, RotateCcw, FileText } from 'lucide-react';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: TaskItem[];
  onImport: (tasks: TaskItem[]) => void;
  onClearAll: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  tasks,
  onImport,
  onClearAll,
}) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [importJsonText, setImportJsonText] = useState('');
  const [copiedType, setCopiedType] = useState<'json' | 'markdown' | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  if (!isOpen) return null;

  // 生成 Markdown 待办格式
  const generateMarkdown = () => {
    let md = `# 艾森豪威尔四象限待办清单\n\n导出时间：${new Date().toLocaleString()}\n\n`;

    const grouped: Record<string, TaskItem[]> = {
      q1: tasks.filter((t) => t.isImportant && t.isUrgent),
      q2: tasks.filter((t) => t.isImportant && !t.isUrgent),
      q3: tasks.filter((t) => !t.isImportant && t.isUrgent),
      q4: tasks.filter((t) => !t.isImportant && !t.isUrgent),
    };

    (['q1', 'q2', 'q3', 'q4'] as const).forEach((qid) => {
      const meta = QUADRANTS_CONFIG[qid];
      const list = grouped[qid];
      md += `### ${meta.name} (${meta.action})\n`;
      if (list.length === 0) {
        md += `_暂无事项_\n\n`;
      } else {
        list.forEach((t) => {
          const check = t.isCompleted ? '[x]' : '[ ]';
          const due = t.dueDate ? ` 📅 ${t.dueDate}` : '';
          const tags = t.tags && t.tags.length > 0 ? ` 🏷️ ${t.tags.map((tg) => `#${tg}`).join(' ')}` : '';
          md += `- ${check} ${t.title}${due}${tags}\n`;
          if (t.description) {
            md += `  > ${t.description.replace(/\n/g, '\n  > ')}\n`;
          }
        });
        md += `\n`;
      }
    });

    return md;
  };

  const handleCopy = (text: string, type: 'json' | 'markdown') => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleDownloadJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(tasks, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `eisenhower_tasks_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportSubmit = () => {
    setImportError(null);
    try {
      const parsed = JSON.parse(importJsonText);
      if (!Array.isArray(parsed)) {
        throw new Error('导入数据必须是任务数组对象');
      }
      onImport(parsed);
      alert('导入成功！');
      onClose();
    } catch (err: any) {
      setImportError(err.message || 'JSON 解析失败，请检查格式');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        setImportJsonText(content);
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          onImport(parsed);
          alert(`成功从文件读取并导入 ${parsed.length} 个任务！`);
          onClose();
        }
      } catch (err: any) {
        setImportError('文件读取失败或不是合法 JSON');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-800 shadow-2xl overflow-hidden transition-all animate-in fade-in zoom-in-95 duration-150">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-neutral-800">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
            数据备份、导入与导出
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 标签栏 */}
        <div className="flex border-b border-gray-100 dark:border-neutral-800 px-6 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`pb-3 text-xs font-semibold border-b-2 mr-6 transition-all cursor-pointer ${
              activeTab === 'export'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            导出与分享
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'import'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            导入与恢复
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'export' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-gray-200 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-800/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Download className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
                      导出为完整 JSON 备份文件
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(JSON.stringify(tasks, null, 2), 'json')}
                      className="px-3 py-1.5 rounded-full border border-gray-200 text-xs text-gray-700 hover:bg-gray-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 inline-flex items-center gap-1 cursor-pointer"
                    >
                      {copiedType === 'json' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copiedType === 'json' ? '已复制' : '复制 JSON'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadJson}
                      className="px-3.5 py-1.5 rounded-full bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5" /> 下载文件
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-gray-200 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-800/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
                        导出为 Markdown 清单
                      </span>
                      <p className="text-[11px] text-gray-500 dark:text-neutral-400">
                        适合粘贴至周报、Notion 或个人笔记软件
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(generateMarkdown(), 'markdown')}
                    className="px-3.5 py-1.5 rounded-full border border-gray-200 text-xs text-gray-700 hover:bg-gray-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedType === 'markdown' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedType === 'markdown' ? '已复制' : '复制 Markdown'}</span>
                  </button>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-xs text-gray-400 dark:text-neutral-500">
                  当前待办总数：{tasks.length} 项
                </span>
                <button
                  type="button"
                  onClick={onClearAll}
                  className="text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400 inline-flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>清空所有待办</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-gray-200 dark:border-neutral-700 rounded-xl cursor-pointer hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-neutral-800/50 transition-colors">
                  <Upload className="h-6 w-6 text-gray-400 mb-1" />
                  <span className="text-xs font-medium text-gray-700 dark:text-neutral-300">
                    点击上传 JSON 备份文件
                  </span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1">
                  或直接粘贴 JSON 文本
                </label>
                <textarea
                  rows={4}
                  value={importJsonText}
                  onChange={(e) => setImportJsonText(e.target.value)}
                  placeholder='[ { "title": "任务名称", "importance": 8, "urgency": 7 } ]'
                  className="w-full rounded-xl border border-gray-300 bg-white p-3 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100 font-mono"
                />
              </div>

              {importError && (
                <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-lg border border-rose-200 dark:border-rose-900">
                  {importError}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleImportSubmit}
                  disabled={!importJsonText.trim()}
                  className="px-4 py-2 rounded-full text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 cursor-pointer"
                >
                  解析并恢复数据
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
