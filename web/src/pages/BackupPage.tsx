import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import {
  CxIconDownload,
  CxIconRefresh,
  CxIconTrash2,
} from "../components/icons";
﻿interface BackupInfo {
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

  useEffect(() => { loadBackups(); }, []);

  const loadBackups = async () => {
    setLoading(true);
    try {
      const result = await invoke<BackupInfo[]>("list_backups");
      setBackups(result);
    } catch (e) { toast.error(String(e)); }
    finally { setLoading(false); }
  };

  const handleCreateBackup = async () => {
    setCreating(true);
    try {
      await invoke("create_backup", { description: "手动备份" });
      toast.success("备份创建成功");
      await loadBackups();
    } catch (e) { toast.error(String(e)); }
    finally { setCreating(false); }
  };

  const handleRestore = async (filename: string) => {
    if (!confirm("确定要恢复此备份吗？当前配置将被覆盖。")) return;
    try {
      await invoke("restore_backup", { backupFilename: filename });
      toast.success("恢复成功，请重启应用使配置生效");
    } catch (e) { toast.error(String(e)); }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm("确定要删除此备份吗？")) return;
    try {
      await invoke("delete_backup", { backupFilename: filename });
      toast.success("备份已删除");
      await loadBackups();
    } catch (e) { toast.error(String(e)); }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("zh-CN");
  };

  return (
    <div className="p-5" style={{ background: "var(--cx-bg)" }}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--cx-text)" }}>
              配置备份与恢复
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--cx-text-mute)" }}>
              备份和恢复系统配置
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={loadBackups}
              className="cx-btn cx-btn-secondary"
            >
              <CxIconRefresh className="w-4 h-4" />
              刷新
            </button>
            <button
              type="button"
              onClick={handleCreateBackup}
              disabled={creating}
              className="cx-btn cx-btn-primary"
            >
              {creating ? <CxIconRefresh className="w-4 h-4 cx-animate-spin" /> : <CxIconDownload className="w-4 h-4" />}
              创建备份
            </button>
          </div>
        </div>

        {/* Info banner */}
        <div className="mb-6 px-4 py-3 rounded-lg" style={{ background: "var(--cx-accent-soft)", border: "1px solid rgba(88,166,255,0.25)" }}>
          <p className="text-sm" style={{ color: "var(--cx-accent-text)" }}>
            <strong>备份内容：</strong>
            当前包含管理端 <code className="px-1 rounded" style={{ background: "rgba(88,166,255,0.15)" }}>config/</code> 下所有文件以及
            <code className="px-1 rounded" style={{ background: "rgba(88,166,255,0.15)" }}>openclaw/openclaw.json</code>。
          </p>
        </div>

        {/* Backup list */}
        <div className="cx-card-elev">
          <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--cx-border-soft)" }}>
            <h2 className="font-semibold" style={{ color: "var(--cx-text)", fontSize: 15 }}>
              备份历史
            </h2>
          </div>

          {loading ? (
            <div className="py-12 text-center" style={{ color: "var(--cx-text-mute)" }}>加载中...</div>
          ) : backups.length === 0 ? (
            <div className="py-12 text-center">
              <div className="mb-4" style={{ color: "var(--cx-text-dim)" }}>暂无备份</div>
              <button
                type="button"
                onClick={handleCreateBackup}
                className="cx-btn cx-btn-primary"
              >
                创建第一个备份
              </button>
            </div>
          ) : (
            <div style={{ borderColor: "var(--cx-border-soft)" }}>
              {backups.map(backup => (
                <div
                  key={backup.id}
                  className="px-5 py-4 flex items-center justify-between"
                  style={{ borderBottom: "1px solid var(--cx-border-soft)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--cx-bg-hover)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ background: "var(--cx-accent-soft)" }}
                    >
                      <CxIconDownload className="w-5 h-5" style={{ color: "var(--cx-accent)" }} />
                    </div>
                    <div>
                      <div className="font-medium text-sm" style={{ color: "var(--cx-text)" }}>
                        {backup.filename}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--cx-text-mute)" }}>
                        {formatDate(backup.created_at)} · {formatSize(backup.size_bytes)}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleRestore(backup.filename)}
                      className="cx-btn cx-btn-secondary"
                      style={{ padding: "4px 12px", fontSize: 12 }}
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(backup.filename)}
                      className="cx-btn cx-btn-danger"
                      style={{ padding: "4px 8px", fontSize: 12 }}
                    >
                      <CxIconTrash2 className="w-4 h-4" />
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
