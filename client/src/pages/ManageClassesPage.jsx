// pages/ManageClassesPage.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';

export default function ManageClassesPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [newClass, setNewClass] = useState({ name: '', description: '' });

  useEffect(() => {
    if (!user || (user.role !== 'root' && user.role !== 'creator')) {
      navigate('/dashboard');
    } else {
      fetch(`${API_BASE_URL}/classes`)
        .then(res => res.json())
        .then(data => setClasses(data));
    }
  }, [user, navigate]);

  const handleChange = (e) => {
    setNewClass({ ...newClass, [e.target.name]: e.target.value });
  };

  const handleAdd = async () => {
    const res = await fetch(`${API_BASE_URL}/classes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newClass, createdBy: user.id })
    });
    const data = await res.json();
    setClasses([...classes, data]);
    setNewClass({ name: '', description: '' });
  };

  const handleDelete = async (id) => {
    await fetch(`${API_BASE_URL}/classes/${id}`, { method: 'DELETE' });
    setClasses(classes.filter(c => c.id !== id));
  };

  const handleUpdate = async (updatedClass) => {
    const res = await fetch(`${API_BASE_URL}/classes/${updatedClass.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedClass)
    });
    const data = await res.json();
    setClasses(classes.map(c => c.id === data.id ? data : c));
  };

  return (
    <div>
      <h2>Manage Classes</h2>
      <div>
        <h3>Add New Class</h3>
        <input name="name" value={newClass.name} onChange={handleChange} placeholder="Class Name" />
        <input name="description" value={newClass.description} onChange={handleChange} placeholder="Description" />
        <button onClick={handleAdd}>Add Class</button>
      </div>

      <div>
        <h3>Existing Classes</h3>
        {classes.map(c => (
          <div key={c.id} style={{ border: '1px solid #ccc', padding: '10px', marginTop: '10px' }}>
            <input value={c.name} onChange={e => handleUpdate({ ...c, name: e.target.value })} />
            <input value={c.description} onChange={e => handleUpdate({ ...c, description: e.target.value })} />
            <button onClick={() => navigate(`/class/${c.id}`)}>Manage Activities</button>
            <button onClick={() => handleDelete(c.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
