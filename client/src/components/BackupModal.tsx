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
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden transition-all animate-in fade-in zoom-in-95 duration-150">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            数据备份、导入与导出
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 标签栏 */}
        <div className="flex border-b border-slate-100 dark:border-slate-800 px-6 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`pb-3 text-xs font-semibold border-b-2 mr-6 transition-all ${
              activeTab === 'export'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            导出与分享
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'import'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            导入与恢复
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'export' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Download className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      导出为完整 JSON 备份文件
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(JSON.stringify(tasks, null, 2), 'json')}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                    >
                      {copiedType === 'json' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copiedType === 'json' ? '已复制' : '复制 JSON'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadJson}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 inline-flex items-center gap-1"
                    >
                      <Download className="h-3.5 w-3.5" /> 下载文件
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        导出为 Markdown 清单
                      </span>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        适合粘贴至周报、Notion 或个人笔记软件
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(generateMarkdown(), 'markdown')}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                  >
                    {copiedType === 'markdown' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedType === 'markdown' ? '已复制' : '复制 Markdown'}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  方式一：选择本地 JSON 备份文件直接读取
                </label>
                <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <Upload className="h-6 w-6 text-slate-400 mb-1" />
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    点击选择 .json 格式备份文件
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
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  方式二：粘贴 JSON 文本导入
                </label>
                <textarea
                  rows={4}
                  value={importJsonText}
                  onChange={(e) => setImportJsonText(e.target.value)}
                  placeholder="在此处粘贴此前导出的 JSON 任务数据..."
                  className="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 font-mono"
                />
              </div>

              {importError && (
                <div className="text-xs text-rose-600 dark:text-rose-400">
                  {importError}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('确定要清空当前所有任务吗？此操作无法撤销。')) {
                      onClearAll();
                      onClose();
                    }
                  }}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600 dark:hover:text-rose-400"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> 清空全部任务
                </button>

                <button
                  type="button"
                  onClick={handleImportSubmit}
                  disabled={!importJsonText.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40"
                >
                  确认导入
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
