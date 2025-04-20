// ManageActivitiesPage.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';

export default function ManageActivitiesPage() {
  const { id: classId } = useParams();
  const { user } = useUser();
  const navigate = useNavigate();

  const [activities, setActivities] = useState([]);
  const [newActivity, setNewActivity] = useState({
    name: '',
    title: '',
    sheet_url: '',
    order_index: ''
  });

  const canManage = user?.role === 'root' || user?.role === 'creator';

  useEffect(() => {
    if (!canManage) {
      navigate('/dashboard');
      return;
    }

    fetch(`${API_BASE_URL}/classes/${classId}/activities`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setActivities(data);
        } else {
          console.error("Unexpected response format:", data);
        }
      })
      .catch(err => {
        console.error("Fetch error:", err);
      });
  }, [canManage, classId, navigate]);

  const handleChange = (e) => {
    setNewActivity({ ...newActivity, [e.target.name]: e.target.value });
  };

  const handleAdd = async () => {
    const payload = {
      name: newActivity.name,
      title: newActivity.title,
      sheet_url: newActivity.sheet_url,
      order_index: parseInt(newActivity.order_index, 10),
      createdBy: user?.id
    };

    const res = await fetch(`${API_BASE_URL}/classes/${classId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok) {
      setActivities([...activities, data]);
      setNewActivity({ name: '', title: '', sheet_url: '', order_index: '' });
    } else {
      alert(data.error || "Add failed.");
    }
  };

  const handleDelete = async (name) => {
    const res = await fetch(`${API_BASE_URL}/classes/${classId}/activities/${name}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      setActivities(activities.filter(a => a.name !== name));
    } else {
      alert("Delete failed.");
    }
  };

  const handleUpdate = async (activity) => {
    const payload = {
      title: activity.title,
      sheet_url: activity.sheet_url,
      order_index: parseInt(activity.order_index, 10)
    };

    const res = await fetch(`${API_BASE_URL}/classes/${classId}/activities/${activity.name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const updated = await res.json();
      setActivities(activities.map(a => a.name === updated.name ? updated : a));
    } else {
      const err = await res.text();
      console.error("Update failed:", err);
      alert("Update failed.");
    }
  };

  return (
    <div>
      <h2>Manage POGIL Activities for Class {classId}</h2>

      <div>
        <h3>Add Activity</h3>
        <input name="name" placeholder="Name" value={newActivity.name} onChange={handleChange} />
        <input name="title" placeholder="Title" value={newActivity.title} onChange={handleChange} />
        <input name="sheet_url" placeholder="Google Sheet URL" value={newActivity.sheet_url} onChange={handleChange} />
        <input name="order_index" type="number" placeholder="Order" value={newActivity.order_index} onChange={handleChange} />
        <button onClick={handleAdd}>Add</button>
      </div>

      <div>
        <h3>Current Activities</h3>
        {activities.map(activity => (
          <div key={activity.name} style={{ border: '1px solid #ccc', padding: '10px', marginTop: '10px' }}>
            <input value={activity.name} readOnly />
            <input
              value={activity.title}
              onChange={(e) =>
                setActivities(activities.map(a => a.name === activity.name ? { ...a, title: e.target.value } : a))
              }
            />
            <input
              value={activity.sheet_url}
              onChange={(e) =>
                setActivities(activities.map(a => a.name === activity.name ? { ...a, sheet_url: e.target.value } : a))
              }
            />
            <input
              type="number"
              value={activity.order_index}
              onChange={(e) =>
                setActivities(activities.map(a => a.name === activity.name ? { ...a, order_index: parseInt(e.target.value, 10) } : a))
              }
            />
            <button onClick={() => handleUpdate(activity)}>Update</button>
            <button onClick={() => handleDelete(activity.name)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
