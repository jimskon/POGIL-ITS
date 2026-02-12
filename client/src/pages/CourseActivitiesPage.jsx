// src/pages/CourseActivitiesPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Container, Table, Button, ButtonGroup, Spinner, Alert } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';


export default function CourseActivitiesPage() {
  const { courseId } = useParams();
  const location = useLocation();
  const courseName = location.state?.courseName;
  const navigate = useNavigate();

  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user } = useUser();

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/courses/${courseId}/activities`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setActivities(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('❌ Failed to fetch activities:', err);
        setError('Unable to load activities.');
      } finally {
        setLoading(false);
      }
    };

    fetchActivities();
  }, [courseId]);

  const handleDoActivity = (activity, isInstructor = false) => {
    const activityId = activity.activity_id;
    const instanceId = activity.instance_id;
    const isTest = !!activity.isTest;

    const path = isInstructor
      ? (isTest
        ? `/test-setup/${courseId}/${activityId}`   // ✅ tests go here
        : `/setup-groups/${courseId}/${activityId}` // ✅ non-tests go here
      )
      : `/run/${instanceId}`;

    navigate(path, { state: { courseName } });
  };
  const toggleHidden = async (activity) => {
    const newHidden = !activity.hidden;

    const url = `${API_BASE_URL}/api/courses/${courseId}/activities/${activity.activity_id}/hidden`;
    console.log('[HIDE] url:', url, 'newHidden:', newHidden);

    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ hidden: newHidden }),
      });

      console.log('[HIDE] status:', res.status);

      const txt = await res.text();           // <-- don’t assume JSON
      console.log('[HIDE] body head:', txt.slice(0, 200));

      if (!res.ok) {
        alert(`Failed: HTTP ${res.status}`);
        return;
      }

      // only if OK:
      setActivities((prev) =>
        prev.map((a) =>
          a.activity_id === activity.activity_id ? { ...a, hidden: newHidden } : a
        )
      );
    } catch (e) {
      console.error('[HIDE] fetch failed:', e);
      alert(`Fetch failed: ${e.message}`);
    }
  };



  const isInstructorLike =
    user?.role === 'instructor' || user?.role === 'root' || user?.role === 'creator';

  return (
    <Container className="mt-4">
      <h2>{courseName ? `Course: ${courseName}` : 'Available Activities'}</h2>

      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : activities.length === 0 ? (
        <Alert variant="info">No activities available for this course.</Alert>
      ) : (
        <Table striped bordered hover>
          <thead>
            <tr>
              <th>Activity Title</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((activity) => {
              const title = activity.title || activity.activity_name || 'Untitled Activity';

              // ✅ single source of truth from backend
              const isTest = !!activity.isTest;

              return (
                <tr key={activity.activity_id}>
                  <td>{title}</td>
                  <td>
                    {user?.role === 'student' && activity.instance_id && !activity.hidden ? (

                      (() => {
                        //const isSubmitted = !!activity.submitted_at;
                        const isComplete = !!activity.is_complete;

                        return (
                          <Button
                            //variant={isSubmitted ? 'primary' : 'success'}
                            variant={isComplete ? 'primary' : 'success'}

                            onClick={() => handleDoActivity(activity)}
                          >
                            {/* {isSubmitted ? 'Review' : 'Start'} */}
                            {isComplete ? 'Review' : 'Start'}
                          </Button>
                        );
                      })()
                    ) : isInstructorLike ? (
                      <ButtonGroup>
                        {
                          isTest ? (
                            !activity.has_groups ? (
                              <Button
                                variant="primary"
                                onClick={() =>
                                  navigate(`/test-setup/${courseId}/${activity.activity_id}`, {
                                    state: { courseName },
                                  })
                                }
                              >
                                Test Setup
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  navigate(`/view-tests/${courseId}/${activity.activity_id}`, {
                                    state: { courseName },
                                  })
                                }
                              >
                                View Tests
                              </Button>
                            )
                          ) : !activity.has_groups ? (
                            <Button
                              variant="primary"
                              onClick={() => handleDoActivity(activity, true)}
                            >
                              Setup Groups
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  navigate(`/view-groups/${courseId}/${activity.activity_id}`, {
                                    state: { courseName },
                                  })
                                }
                              >
                                View Groups
                              </Button>

                              {/* 🔒 Hide only if groups exist */}
                              <Button
                                variant={activity.hidden ? 'success' : 'outline-danger'}
                                onClick={() => toggleHidden(activity)}
                              >
                                {activity.hidden ? 'Unhide' : 'Hide'}
                              </Button>
                            </>
                          )
                        }
                      </ButtonGroup>
                    ) : (
                      <span>Not available</span>
                    )}


                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Container>
  );
}
