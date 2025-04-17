// ManageActivitiesPage.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';

export default function ManageActivitiesPage() {
  const navigate = useNavigate();
  const { user, userid } = useUser();
  const [activities, setActivities] = useState([]);
  const [newActivity, setNewActivity] = useState({ name: '', title: '', sheet_url: '' });

  const canManage = user?.role === 'root' || user?.role === 'creator';

  useEffect(() => {
    if (!canManage) {
      navigate('/dashboard');
    } else {
	fetch('/activities')
	    .then(res => res.json())
	    .then(data => {
		console.log("Fetched activities:", data);
		setActivities(data);
	    });
    }
  }, [canManage, navigate]);

  const handleChange = (e) => {
    setNewActivity({ ...newActivity, [e.target.name]: e.target.value });
  };

  const handleAdd = async () => {
    const res = await fetch('/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newActivity)
    });
    const data = await res.json();
    setActivities([...activities, data]);
    setNewActivity({ name: '', title: '', sheet_url: '' });
  };

  const handleDelete = async (name) => {
    const res = await fetch(`/activities/${name}`, { method: 'DELETE' });

    if (res.ok) {
      setActivities(activities.filter(a => a.name !== name));
    } else {
      alert("Delete failed.");
    }
  };

const handleUpdate = async (activity) => {
  const res = await fetch(`/activities/${activity.name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: activity.title,
      sheet_url: activity.sheet_url
    })
  });

  if (res.ok) {
    const updated = await res.json();
    setActivities(activities.map(a => a.name === updated.name ? updated : a));
  } else {
    alert("Update failed.");
  }
};


  return (
    <div>
      <h2>Manage POGIL Activities</h2>

      <div>
        <h3>Add Activity</h3>
        <input name="name" placeholder="Name" value={newActivity.name} onChange={handleChange} />
        <input name="title" placeholder="Title" value={newActivity.title} onChange={handleChange} />
        <input name="sheet_url" placeholder="Google Sheet URL" value={newActivity.sheet_url} onChange={handleChange} />
        <button onClick={handleAdd}>Add</button>
      </div>

      <div>
        <h3>Current Activities</h3>
        {activities.map(activity => (
          <div key={activity.id} style={{ border: '1px solid #ccc', padding: '10px', marginTop: '10px' }}>
              <input
		  value={activity.name}
		  onChange={(e) => setActivities(activities.map(a => a.name === activity.name ? { ...a, name: e.target.value } : a))}
	      />
	      <input
		  value={activity.title}
		  onChange={(e) => setActivities(activities.map(a => a.name === activity.name ? { ...a, title: e.target.value } : a))}
	      />
	      <input
		  value={activity.sheet_url}
		  onChange={(e) => setActivities(activities.map(a => a.name === activity.name ? { ...a, sheet_url: e.target.value } : a))}
	      />
	      <button onClick={() => handleUpdate(activity)}>Update</button>
	      <button onClick={() => handleDelete(activity.name)}>Delete</button>

          </div>
        ))}
      </div>
    </div>
  );
}
