import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props { onNext: () => void; onPrev: () => void; }
interface InstallStatus { installed: boolean; installerAvailable: boolean; installerRunning: boolean; installerPath?: string; installerExitCode?: number | null; }

export default function CodexInstall({ onNext, onPrev }: Props) {
  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => invoke<InstallStatus>("get_codex_install_status").then(setStatus).catch((reason) => setError(String(reason)));
  useEffect(() => { void refresh(); const id = window.setInterval(() => void refresh(), 2000); return () => window.clearInterval(id); }, []);
  const install = async () => { setError(null); try { setStatus(await invoke<InstallStatus>("start_codex_chatgpt_install")); } catch (reason) { setError(String(reason)); } };
  return <div className="space-y-6 max-w-xl mx-auto">
    <div className="text-center"><h2 className="text-2xl font-semibold">安装 ChatGPT</h2><p className="mt-2 text-sm text-slate-600">Codex 模块需要 ChatGPT 桌面应用。安装完成后可返回首页。</p></div>
    {status?.installed ? <div className="border border-green-200 bg-green-50 p-4 text-green-800">已检测到 ChatGPT 桌面应用。</div> : <div className="border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">内置包：{status?.installerPath ?? "检测中..."}</div>}
    {error ? <div className="border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div> : null}
    <div className="flex justify-between border-t pt-4"><button onClick={onPrev} className="px-4 py-2 text-slate-600">上一步</button>{status?.installed ? <button onClick={onNext} className="rounded bg-blue-600 px-5 py-2 text-white">返回首页</button> : <button disabled={!status?.installerAvailable || status?.installerRunning} onClick={install} className="rounded bg-blue-600 px-5 py-2 text-white disabled:opacity-50">{status?.installerRunning ? "安装程序运行中" : "安装 ChatGPT"}</button>}</div>
  </div>;
}
