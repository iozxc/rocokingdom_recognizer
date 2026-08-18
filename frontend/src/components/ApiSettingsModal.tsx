import React, { useState } from 'react';
import {
  X,
  Server,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Download,
  Upload,
  Code2,
  Trash2,
} from 'lucide-react';
import { api } from '../services/api';
import { sound } from '../services/sound';
import { ConfirmDialog } from './ConfirmDialog';

interface ApiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshData: () => void;
  onExportData: () => void;
  onImportData: (jsonStr: string) => boolean;
  onClearAll: () => void;
}

export const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({
  isOpen,
  onClose,
  onRefreshData,
  onExportData,
  onImportData,
  onClearAll,
}) => {
  const [baseUrl, setBaseUrl] = useState(api.getApiBase());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<'api' | 'data' | 'guide'>('api');
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isConfirmClearAllOpen, setIsConfirmClearAllOpen] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    sound.playScan();
    setTesting(true);
    setTestResult(null);

    // Update base in service first
    api.setApiBase(baseUrl);

    const res = await api.checkHealth();
    setTesting(false);
    if (res.online) {
      sound.playEncounter();
      setTestResult({ success: true, message: '后端连接成功！(GET /icons 响应 200 OK)' });
      onRefreshData();
    } else {
      sound.playToggleOff();
      setTestResult({
        success: false,
        message: `${res.message}。若在浏览器直接调试本地后端，请确保 Python 后端已开启 CORS (flask-cors)。`,
      });
    }
  };

  const handleSaveUrl = () => {
    sound.playClick();
    api.setApiBase(baseUrl);
    onRefreshData();
    onClose();
  };

  const handleResetUrl = () => {
    sound.playClick();
    api.resetApiBase();
    setBaseUrl(api.getApiBase());
    setTestResult(null);
  };

  const handleImportSubmit = () => {
    sound.playClick();
    if (!importText.trim()) return;
    const ok = onImportData(importText.trim());
    if (ok) {
      sound.playEncounter();
      setImportStatus('图鉴数据导入成功！');
      setImportText('');
    } else {
      sound.playToggleOff();
      setImportStatus('JSON 格式不正确，导入失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div
        className="relative w-full max-w-2xl bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl p-6 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b-2 border-[#F1F5F9]">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[#F5F9FF] text-[#2B78C4] border-2 border-[#E6EEF8] flex items-center justify-center font-bold">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800 tracking-tight">
                图像识别服务 & 数据设置
              </h3>
              <p className="text-xs text-slate-500">
                配置 Python 图像识别后端 Base URL 及本地存储管理
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="p-2 rounded-2xl text-slate-400 hover:text-slate-700 hover:bg-[#F5F9FF] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="mt-4 flex items-center gap-2 border-b-2 border-[#F1F5F9] pb-2.5">
          <button
            onClick={() => setActiveTab('api')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all ${
              activeTab === 'api'
                ? 'bg-[#7ABCF4] text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-[#F5F9FF]'
            }`}
          >
            后端地址配置
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all ${
              activeTab === 'guide'
                ? 'bg-[#7ABCF4] text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-[#F5F9FF]'
            }`}
          >
            API 文档与 CORS 指南
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all ${
              activeTab === 'data'
                ? 'bg-[#7ABCF4] text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-[#F5F9FF]'
            }`}
          >
            本地图鉴备份 / 恢复
          </button>
        </div>

        {/* Content Tabs */}
        <div className="mt-4 flex-1 overflow-y-auto pr-1">
          {activeTab === 'api' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">
                  图形识别服务后端 Base URL:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="http://127.0.0.1:5000"
                    className="flex-1 px-3.5 py-2 text-xs font-mono bg-[#F5F9FF] border-2 border-[#E6EEF8] rounded-xl outline-hidden focus:border-[#7ABCF4] focus:bg-white text-slate-800 font-medium"
                  />
                  <button
                    onClick={handleResetUrl}
                    className="px-3.5 py-2 text-xs font-black text-slate-600 hover:text-slate-800 border-2 border-[#E6EEF8] bg-[#F5F9FF] hover:bg-white rounded-xl"
                  >
                    恢复默认
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  默认指向本地 Python 图像识别服务 (http://127.0.0.1:5000)
                </p>
              </div>

              {/* Test Button & Result */}
              <div>
                <button
                  disabled={testing}
                  onClick={handleTestConnection}
                  className="px-4 py-2.5 roco-btn-primary text-xs font-black flex items-center gap-1.5 disabled:opacity-50"
                >
                  {testing ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Server className="w-3.5 h-3.5" />
                  )}
                  <span>测试连接 (Ping Backend)</span>
                </button>

                {testResult && (
                  <div
                    className={`mt-3 p-3.5 rounded-2xl border-2 text-xs flex items-start gap-2.5 ${
                      testResult.success
                        ? 'bg-[#F2FBF0] border-[#95D151] text-[#2D6613]'
                        : 'bg-[#FEF9E6] border-[#FEE061] text-[#854D0E]'
                    }`}
                  >
                    {testResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-[#95D151] shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-[#A67C00] shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="font-black">{testResult.message}</p>
                      {!testResult.success && (
                        <p className="text-[11px] text-slate-500 mt-1">
                          提示：当前前端自带全套离线仿真精灵图鉴与模拟预测算法，您仍可自由体验全部功能。
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'guide' && (
            <div className="space-y-3 text-xs text-slate-600">
              <div className="p-3.5 bg-[#F5F9FF] rounded-2xl border-2 border-[#E6EEF8]">
                <div className="flex items-center gap-1.5 font-black text-slate-800 mb-1.5">
                  <Code2 className="w-4 h-4 text-[#7ABCF4]" />
                  <span>Python Flask 后端推荐配置 (包含 CORS)</span>
                </div>
                <pre className="bg-slate-900 text-slate-100 p-3.5 rounded-xl text-[11px] font-mono overflow-x-auto">
{`from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app) # 开启跨域访问

@app.route('/predict', methods=['POST'])
def predict():
    image = request.files['image']
    map_num = int(request.form.get('map_num', 1))
    threshold = float(request.form.get('threshold', 0.7))
    # 模型预测逻辑...
    return jsonify({
        "status": "success",
        "data": {
            "filename": "0.png",
            "score": 0.985,
            "view_url": f"http://127.0.0.1:5000/icons/map{map_num}/0.png"
        }
    })`}
                </pre>
              </div>

              <div className="p-3.5 bg-[#FEF9E6] rounded-2xl border-2 border-[#FEE061] text-[#854D0E]">
                <p className="font-black text-[#854D0E] mb-1">前端接口协议映射：</p>
                <ul className="list-disc list-inside space-y-1 text-[11px]">
                  <li><strong>POST /predict:</strong> 包含 image 文件、map_num(1/2/3)、threshold(0.7)</li>
                  <li><strong>GET /icons:</strong> 返回所有地图的图标列表</li>
                  <li><strong>GET /icons/&lt;map_name&gt;/&lt;filename&gt;:</strong> 获取具体精灵切图</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-[#F5F9FF] rounded-2xl border-2 border-[#E6EEF8]">
                <p className="text-xs font-black text-slate-700 mb-2">备份与导出数据</p>
                <button
                  onClick={onExportData}
                  className="px-4 py-2 roco-btn-secondary text-xs font-black flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-[#7ABCF4]" />
                  <span>导出已遇见图鉴记录 (JSON)</span>
                </button>
              </div>

              <div className="p-3.5 bg-[#F5F9FF] rounded-2xl border-2 border-[#E6EEF8] space-y-2">
                <p className="text-xs font-black text-slate-700">导入 / 恢复图鉴数据</p>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="在此粘贴导出的 JSON 记录..."
                  className="w-full h-20 p-2.5 text-xs font-mono bg-white border-2 border-[#E6EEF8] rounded-xl outline-hidden focus:border-[#7ABCF4]"
                />
                <button
                  onClick={handleImportSubmit}
                  className="px-4 py-2 roco-btn-primary text-xs font-black flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>执行恢复</span>
                </button>
                {importStatus && (
                  <p className="text-xs text-[#2B78C4] font-black">{importStatus}</p>
                )}
              </div>

              <div className="p-3.5 bg-rose-50 rounded-2xl border-2 border-rose-200 flex items-center justify-between">
                <div>
                  <p className="text-xs font-black text-rose-800">清空所有图鉴数据</p>
                  <p className="text-[11px] text-rose-600">
                    将重置所有地图的【已遇见】绿勾标记与计数
                  </p>
                </div>
                <button
                  onClick={() => {
                    sound.playClick();
                    setIsConfirmClearAllOpen(true);

                  }}
                  className="px-3.5 py-1.5 bg-rose-600 text-white rounded-xl text-xs font-black hover:bg-rose-700 transition-colors flex items-center gap-1 shadow-xs cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  全部清空
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Clear All Confirmation Dialog */}
        <ConfirmDialog
            isOpen={isConfirmClearAllOpen}
            title="清空全部图鉴数据"
            description="警告：确定要清空全部地图的所有已遇见记录吗？此操作无法撤销。"
            confirmText="确定全部清空"
            cancelText="取消"
            danger={true}
            onConfirm={() => {
              onClearAll();
              onClose();
            }}
            onClose={() => setIsConfirmClearAllOpen(false)}
        />

        {/* Footer */}
        <div className="mt-5 pt-3.5 border-t-2 border-[#F1F5F9] flex items-center justify-end gap-2">
          <button
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="px-4 py-2 roco-btn-secondary text-xs font-black"
          >
            取消
          </button>
          <button
            onClick={handleSaveUrl}
            className="px-5 py-2.5 roco-btn-primary text-xs font-black"
          >
            保存并应用
          </button>
        </div>
      </div>
    </div>
  );
};
