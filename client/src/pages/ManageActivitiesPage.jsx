// src/pages/ManageActivitiesPage.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { Table, Button, Form, Container } from 'react-bootstrap';

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

  const handleFieldChange = (name, field, value) => {
    setActivities(activities.map(a =>
      a.name === name ? { ...a, [field]: value } : a
    ));
  };

  return (
    <Container>
      <h2 className="mb-4">Manage POGIL Activities for Class {classId}</h2>

      <Form className="mb-4">
        <h4>Add New Activity</h4>
        <Form.Group className="mb-2">
          <Form.Control
            name="name"
            placeholder="Activity ID"
            value={newActivity.name}
            onChange={handleChange}
          />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Control
            name="title"
            placeholder="Title"
            value={newActivity.title}
            onChange={handleChange}
          />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Control
            name="sheet_url"
            placeholder="Google Sheet or Doc URL"
            value={newActivity.sheet_url}
            onChange={handleChange}
          />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Control
            name="order_index"
            type="number"
            placeholder="Order Index"
            value={newActivity.order_index}
            onChange={handleChange}
          />
        </Form.Group>
        <Button variant="primary" onClick={handleAdd}>Add Activity</Button>
      </Form>

      <h4>Current Activities</h4>
      <Table striped bordered hover responsive>
        <thead>
          <tr>
            <th>Name</th>
            <th>Title</th>
            <th>Sheet URL</th>
            <th>Order</th>
            <th style={{ width: '30%' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {activities.map(activity => (
            <tr key={activity.name}>
              <td>
                <Form.Control value={activity.name} readOnly />
              </td>
              <td>
                <Form.Control
                  value={activity.title}
                  onChange={e => handleFieldChange(activity.name, 'title', e.target.value)}
                />
              </td>
              <td>
                <Form.Control
                  value={activity.sheet_url}
                  onChange={e => handleFieldChange(activity.name, 'sheet_url', e.target.value)}
                />
              </td>
              <td>
                <Form.Control
                  type="number"
                  value={activity.order_index}
                  onChange={e => handleFieldChange(activity.name, 'order_index', parseInt(e.target.value, 10))}
                />
              </td>
              <td>
                <Button variant="success" size="sm" onClick={() => handleUpdate(activity)} className="me-2">Update</Button>
                <Button variant="info" size="sm" onClick={() => navigate(`/preview/${activity.name}`)} className="me-2">Preview</Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(activity.name)}>Delete</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Container>
  );
}
