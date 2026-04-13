
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import InviteCodePage from './pages/InviteCodePage';
import UserPage from './pages/UserPage';
import StatsPage from './pages/StatsPage';

function App() {
  const { user, loading } = useAuthStore();

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <Router>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <LoginPage />} />
        <Route path="/dashboard" element={user ? <DashboardPage /> : <Navigate to="/login" />} />
        <Route path="/invite-codes" element={user ? <InviteCodePage /> : <Navigate to="/login" />} />
        <Route path="/users" element={user && user.role === 'admin' ? <UserPage /> : <Navigate to="/dashboard" />} />
        <Route path="/stats" element={user ? <StatsPage /> : <Navigate to="/login" />} />
        <Route path="/register" element={<Navigate to="/login" />} />
        <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} />} />
      </Routes>
    </Router>
  );
}

export default App;
