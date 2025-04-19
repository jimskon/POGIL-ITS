// DashboardPage.jsx
import React from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function DashboardPage({ user }) {
  const navigate = useNavigate();
  console.log("User in dashboard:", user);

  if (!user) {
    return (
      <div>
        <h1>Dashboard</h1>
        <p>You must log in to view this page.</p>
      </div>
    );
  }

  const canManage = user.role === 'root' || user.role === 'creator';

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome, {user.name}!</p>

      {canManage && (
        <div>
          <h3>Admin Tools</h3>
          <Link to="/manage-classes">Manage POGIL Classes</Link><br />
        </div>
      )}

      {!canManage && (
        <p>You do not have permission to manage POG activities.</p>
      )}
    </div>
  );
}
