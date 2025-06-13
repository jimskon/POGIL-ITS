// src/pages/ManageActivitiesPage.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { Table, Button, Form, Container, Modal } from 'react-bootstrap';

const SERVICE_ACCOUNT_EMAIL = import.meta.env.VITE_SERVICE_ACCOUNT_EMAIL;

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

  const [showModal, setShowModal] = useState(false);
  const [pendingActivity, setPendingActivity] = useState(null);
  const canManage = user?.role === 'root' || user?.role === 'creator';

  useEffect(() => {
    if (!canManage) {
      navigate('/dashboard');
      return;
    }

    fetch(`${API_BASE_URL}/api/classes/${classId}/activities`)
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
    const activity = {
      ...newActivity,
      order_index: parseInt(newActivity.order_index, 10),
      createdBy: user?.id
    };

    if (!activity.sheet_url || activity.sheet_url.trim() === '') {
      saveActivity(activity);
      return;
    }

    setPendingActivity(activity);
    setShowModal(true);
  };

  const saveActivity = async (activity) => {
    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activity)
    });

    const data = await res.json();
    if (res.ok) {
      setActivities([...activities, data]);
      setNewActivity({ name: '', title: '', sheet_url: '', order_index: '' });
    } else {
      alert(data.error || "Add failed.");
    }
  };

  const confirmShareAndCheckAccess = async () => {
    setShowModal(false);
    if (!pendingActivity?.sheet_url) {
      saveActivity(pendingActivity);
      setPendingActivity(null);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/activities/check-access?url=${encodeURIComponent(pendingActivity.sheet_url)}`);

      let result = { access: false };
      if (res.ok) {
        const text = await res.text();
        if (text) {
          result = JSON.parse(text);
        }
      }

      if (res.ok && result.access) {
        saveActivity(pendingActivity);
      } else {
        alert("Access denied or document not found. Please ensure the document is shared and the URL is correct.");
        setNewActivity(pendingActivity);
      }
    } catch (err) {
      console.error("Error checking access:", err);
      alert("Error checking document access. Please try again.");
      setNewActivity(pendingActivity);
    }

    setPendingActivity(null);
  };

  const handleDelete = async (name) => {
    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities/${name}`, {
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

    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities/${activity.name}`, {
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
                <Button variant="info" size="sm" onClick={() => {
                  if (!activity.sheet_url) {
                    alert("No document URL specified for this activity.");
                  } else {
                    navigate(`/preview/${activity.id}`);
                  }
                }} className="me-2">Preview</Button>
                <Button variant="warning" size="sm" onClick={() => navigate(`/editor/${activity.id}`)} className="me-2">Edit</Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(activity.name)}>Delete</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {pendingActivity?.sheet_url && pendingActivity.sheet_url.trim() !== '' && (
      <Modal show={showModal} onHide={() => setShowModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Share Document Access</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>If your activity uses a Google Sheet or Doc, please ensure it is shared with:</p>
          <code>{SERVICE_ACCOUNT_EMAIL}</code>
          <p className="mt-3">Click "Continue" once you've shared access or if no document is being used.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={confirmShareAndCheckAccess}>Continue</Button>
        </Modal.Footer>
      </Modal>
      )}
    </Container>
  );
}
