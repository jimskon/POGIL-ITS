import { Link } from 'react-router-dom';

export default function NavBar({ user, userid }) {
  return (
    <nav style={{ background: '#eee', padding: '10px' }}>
      <Link to="/">Login</Link> |{' '}
      <Link to="/register">Register</Link> |{' '}
      <Link to="/dashboard">Dashboard</Link>
	{user && <span style={{ marginLeft: '20px' }}>Welcome, {user.name} ({user.role}) ID: {user.userid} </span>}
    </nav>
  );
}
