// src/pages/ManageActivitiesPage.jsx

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
    <div className="container mt-4">
      <h2>Manage POGIL Activities for Class {classId}</h2>

      <div className="card p-3 mb-4">
        <h4>Add Activity</h4>
        <input className="form-control mb-2" name="name" placeholder="Name" value={newActivity.name} onChange={handleChange} />
        <input className="form-control mb-2" name="title" placeholder="Title" value={newActivity.title} onChange={handleChange} />
        <input className="form-control mb-2" name="sheet_url" placeholder="Google Doc URL" value={newActivity.sheet_url} onChange={handleChange} />
        <input className="form-control mb-2" name="order_index" type="number" placeholder="Order" value={newActivity.order_index} onChange={handleChange} />
        <button className="btn btn-primary" onClick={handleAdd}>Add</button>
      </div>

      <div>
        <h4>Current Activities</h4>
        {activities.map(activity => (
          <div key={activity.name} className="border rounded p-3 mb-3">
            <input className="form-control mb-2" value={activity.name} readOnly />
            <input
              className="form-control mb-2"
              value={activity.title}
              onChange={(e) =>
                setActivities(activities.map(a => a.name === activity.name ? { ...a, title: e.target.value } : a))
              }
            />
            <input
              className="form-control mb-2"
              value={activity.sheet_url}
              onChange={(e) =>
                setActivities(activities.map(a => a.name === activity.name ? { ...a, sheet_url: e.target.value } : a))
              }
            />
            <input
              className="form-control mb-2"
              type="number"
              value={activity.order_index}
              onChange={(e) =>
                setActivities(activities.map(a => a.name === activity.name ? { ...a, order_index: parseInt(e.target.value, 10) } : a))
              }
            />
            <div className="mt-2">
              <button className="btn btn-success me-2" onClick={() => handleUpdate(activity)}>Update</button>
              <button className="btn btn-danger me-2" onClick={() => handleDelete(activity.name)}>Delete</button>
              <button className="btn btn-secondary" onClick={() => navigate(`/preview/${activity.name}`)}>Preview</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
