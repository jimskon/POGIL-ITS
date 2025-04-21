import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import DashboardPage from '../pages/DashboardPage';
import NavBar from '../components/NavBar';
import { UserProvider, useUser } from '../context/UserContext';
import ManageActivitiesPage from '../pages/ManageActivitiesPage';
import ManageClassesPage from '../pages/ManageClassesPage';
import ActivityPreview from '../pages/ActivityPreview';
import AdminUsersPage from '../pages/AdminUsersPage';

function AppRoutes() {
  const { user } = useUser();

  return (
    <>
      <NavBar user={user} />
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/dashboard" element={<DashboardPage user={user} />} />
        <Route path="/manage-classes" element={<ManageClassesPage />} />
        <Route path="/class/:id" element={<ManageActivitiesPage />} />
        <Route path="/preview/:activityName" element={<ActivityPreview />} />
	<Route path="/admin/users" element={<AdminUsersPage />} />
  
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <UserProvider>
      <Router>
        <AppRoutes />
      </Router>
    </UserProvider>
  );
}
