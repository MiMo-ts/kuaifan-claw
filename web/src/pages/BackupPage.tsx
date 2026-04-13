import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, RefreshCw, Trash2 } from 'lucide-react';

interface BackupInfo {
  id: string;
  filename: string;
  created_at: string;
  size_bytes: number;
  description?: string;
}

export default function BackupPage() {
  const navigate = useNavigate();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    setLoading(true);
    try {
      const result = await invoke<BackupInfo[]>('list_backups');
      setBackups(result);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    setCreating(true);
    try {
      await invoke('create_backup', { description: '手动备份' });
      toast.success('备份创建成功');
      await loadBackups();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (filename: string) => {
    if (!confirm('确定要恢复此备份吗？当前配置将被覆盖。')) return;
    try {
      await invoke('restore_backup', { backupFilename: filename });
      toast.success('恢复成功，请重启应用使配置生效');
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm('确定要删除此备份吗？')) return;
    try {
      await invoke('delete_backup', { backupFilename: filename });
      toast.success('备份已删除');
      await loadBackups();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString('zh-CN');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/home')}
              className="p-2 text-gray-500 hover:text-gray-700"
              title="返回首页"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">配置备份与恢复</h1>
              <p className="text-gray-500">备份和恢复系统配置</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={loadBackups}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg flex items-center hover:bg-gray-200"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              刷新
            </button>
            <button
              type="button"
              onClick={handleCreateBackup}
              disabled={creating}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg flex items-center disabled:opacity-50 hover:bg-blue-600"
            >
              {creating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              创建备份
            </button>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-800">
            <strong>备份内容：</strong>
            当前包含管理端 <code className="bg-blue-100 px-1 rounded">config/</code> 下所有文件（含嵌套目录）以及
            <code className="bg-blue-100 px-1 rounded">openclaw-cn/openclaw.json</code>（OpenClaw 主配置）。
            备份文件体积取决于配置丰富程度，并非越大越好，体积小仅说明当前配置较少。
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm">
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold text-gray-900">备份历史</h2>
          </div>

          {loading ? (
            <div className="p-12 text-center text-gray-500">加载中...</div>
          ) : backups.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-gray-400 mb-4">暂无备份</div>
              <button
                type="button"
                onClick={handleCreateBackup}
                className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                创建第一个备份
              </button>
            </div>
          ) : (
            <div className="divide-y">
              {backups.map(backup => (
                <div key={backup.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-4">
                      <Download className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">{backup.filename}</div>
                      <div className="text-sm text-gray-500">
                        {formatDate(backup.created_at)} · {formatSize(backup.size_bytes)}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleRestore(backup.filename)}
                      className="px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(backup.filename)}
                      className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
