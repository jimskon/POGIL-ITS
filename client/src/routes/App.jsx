import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import DashboardPage from '../pages/DashboardPage';
import NavBar from '../components/NavBar';
import { UserProvider, useUser } from '../context/UserContext';
import ManageActivitiesPage from '../pages/ManageActivitiesPage';

function AppRoutes() {
  const { user } = useUser();

  return (
    <>
      <NavBar user={user} />
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/dashboard" element={<DashboardPage user={user} />} />
	<Route path="/manage-activities" element={<ManageActivitiesPage />} />  
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
