import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, RefreshCw, Loader2 } from 'lucide-react';
import { Plus, Play, Square, Edit, Trash2 } from 'lucide-react';
import PluginConfigComponent from '../components/wizard/PluginConfig';

export default function PluginPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="p-2 text-gray-500 hover:text-gray-700"
            title="返回首页"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">聊天插件管理</h1>
            <p className="text-sm text-gray-500">选择需要安装的聊天平台插件</p>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6">
          <PluginConfigComponent onNext={() => navigate('/home')} onPrev={() => navigate('/home')} />
        </div>
      </div>
    </div>
  );
}
