import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../context/UserContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { setUser } = useUser();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch("http://138.28.162.128:4000/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok) {
        
        setUser({ username: data.username, role: data.role });	
        navigate("/dashboard");
      } else {
        alert(data.error || "Login failed.");
      }
    } catch (err) {
      alert("Error connecting to server.");
    }
  };

  return (
   <div>
    <h1>Login</h1>
    <form onSubmit={handleSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" /><br />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" /><br />
      <button type="submit">Login</button>
    </form>
       <p>Don't have an account? <Link to="/register">Register here</Link></p>
   </div>
  );
}
