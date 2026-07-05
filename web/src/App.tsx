import toast from 'react-hot-toast';
import { useState, useEffect, Suspense, lazy } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useAppStore } from "./stores/appStore";
import InstallProgressBridge from "./components/InstallProgressBridge";
import CodexShell from "./components/layout/CodexShell";


// Lazy-loaded pages
const WizardPage = lazy(() => import("./pages/WizardPage"));
const HomePage = lazy(() => import("./pages/HomePage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RobotShopPage = lazy(() => import("./pages/RobotShopPage"));
const InstanceCreatePage = lazy(() => import("./pages/InstanceCreatePage"));
const InstancePage = lazy(() => import("./pages/InstancePage"));
const ModelConfigPage = lazy(() => import("./pages/ModelConfigPage"));
const PluginPage = lazy(() => import("./pages/PluginPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const BackupPage = lazy(() => import("./pages/BackupPage"));
const TokenUsagePage = lazy(() => import("./pages/TokenUsagePage"));
const ConsolePage = lazy(() => import("./pages/ConsolePage"));

function PageLoader() {
  return (
    <div
      className="flex items-center justify-center h-full"
      style={{ background: "var(--cx-bg)" }}
    >
      <div className="cx-shimmer rounded-lg" style={{ width: 120, height: 20 }} />
    </div>
  );
}

/** Login gate: redirect to /login if not logged in */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Shell wrapper for authenticated routes */
function AppShell({ children }: { children: React.ReactNode }) {
  return <CodexShell showChat={false}>{children}</CodexShell>;
}

function AppRoutes() {
  const { initialized, setInitialized, isLoggedIn } = useAppStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const dataDir = await invoke<string>("get_data_dir");
        console.log("[App] Data directory:", dataDir);
      } catch (e) {
        console.error("[App] Init error:", e);
      } finally {
        setInitialized(true);
        setChecking(false);
      }
    };
    init();
  }, [setInitialized]);

  if (!initialized || checking) {
    return (
      <div
        className="flex flex-col items-center justify-center h-screen gap-4"
        style={{ background: "var(--cx-bg)" }}
      >
        <div
          className="rounded-full cx-animate-spin"
          style={{
            width: 32,
            height: 32,
            border: "3px solid var(--cx-border-soft)",
            borderTopColor: "var(--cx-accent)",
          }}
        />
        <p style={{ color: "var(--cx-text-mute)", fontSize: 14 }}>
          正在加载...
        </p>
      </div>
    );
  }

  return (
    <>
      <InstallProgressBridge />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--cx-bg-overlay)",
            color: "var(--cx-text)",
            border: "1px solid var(--cx-border)",
            fontSize: 13,
          },
        }}
      />
      <Routes>
        {/* Root: redirect based on login state */}
        <Route
          path="/"
          element={
            isLoggedIn ? (
              <Navigate to="/home" replace />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        {/* Public: login page */}
        <Route
          path="/login"
          element={
            <Suspense fallback={<PageLoader />}>
              <LoginPage />
            </Suspense>
          }
        />

        {/* Wizard: accessible without shell (for module setup) */}
        <Route
          path="/wizard"
          element={
            <RequireAuth>
              <Suspense fallback={<PageLoader />}>
                <WizardPage />
              </Suspense>
            </RequireAuth>
          }
        />

        {/* Authenticated routes (with shell) */}
        <Route
          path="/home"
          element={
            <RequireAuth>
              <AppShell>
                <Suspense fallback={<PageLoader />}>
                  <HomePage />
                </Suspense>
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/robots"
          element={
            <RequireAuth>
              <AppShell>
                <Suspense fallback={<PageLoader />}>
                  <RobotShopPage />
                </Suspense>
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/instances/new"
          element={
            <RequireAuth>
              <AppShell>
                <Suspense fallback={<PageLoader />}>
                  <InstanceCreatePage />
                </Suspense>
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/instances"
          element={
            <RequireAuth>
              <AppShell>
                <Suspense fallback={<PageLoader />}>
                  <InstancePage />
                </Suspense>
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/models"
          element={
            <RequireAuth>
              <AppShell>
                <Suspense fallback={<PageLoader />}>
                  <ModelConfigPage />
                </Suspense>
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/plugins"
          element={
            <RequireAuth>
              <AppShell>
                <Suspense fallback={<PageLoader />}>
                  <PluginPage />
                </Suspense>
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <AppShell>
                <Suspense fallback={<PageLoader />}>
                  <SettingsPage />
                </Suspense>
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/backup"
          element={
            <RequireAuth>
              <AppShell>
                <Suspense fallback={<PageLoader />}>
                  <BackupPage />
                </Suspense>
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/usage"
          element={
            <RequireAuth>
              <AppShell>
                <Suspense fallback={<PageLoader />}>
                  <TokenUsagePage />
                </Suspense>
              </AppShell>
            </RequireAuth>
          }
        />
        {/* Console: embedded Control UI */}
        <Route
          path="/console"
          element={
            <RequireAuth>
              <AppShell>
                <Suspense fallback={<PageLoader />}>
                  <ConsolePage />
                </Suspense>
              </AppShell>
            </RequireAuth>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
