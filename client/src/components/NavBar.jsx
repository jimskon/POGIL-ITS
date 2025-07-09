import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Navbar, Nav, Container, Button } from 'react-bootstrap';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';


export default function NavBar() {
  const { user, setUser, loading } = useUser();

  const navigate = useNavigate();

  const handleLogout = async () => {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }); // Optional: only if your backend supports logout

    localStorage.removeItem('user'); // Clear persisted user
    setUser(null);                   // Update context
    navigate("/", { replace: true }); // Redirect without reloading the page
  };


  if (loading || user === null) return null;



  return (
    <Navbar bg="dark" variant="dark" expand="lg" className="mb-4">
      <Container>
        <Navbar.Brand as={Link} to="/dashboard">
          POGIL ITS
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="pogil-navbar" />
        <Navbar.Collapse id="pogil-navbar">
          <Nav className="me-auto">
            <Nav.Link as={Link} to="/dashboard">
              Dashboard
            </Nav.Link>
            {["root", "creator", "instructor"].includes(user?.role) && (
              <Nav.Link as={Link} to="/manage-courses">
                Manage Courses
              </Nav.Link>
            )}

            {(user?.role === "root" || user?.role === "creator") && (
              <Nav.Link as={Link} to="/manage-classes">
                Manage Classes
              </Nav.Link>
            )}

            {user?.role === "root" && (
              <Nav.Link as={Link} to="/admin/users">
                Manage Users
              </Nav.Link>
            )}
          </Nav>

          <Nav className="ms-auto align-items-center">
            {!user ? (
              <>
                <Nav.Link as={Link} to="/register">
                  Register
                </Nav.Link>
                <Nav.Link as={Link} to="/">
                  Login
                </Nav.Link>
              </>
            ) : (
              <>
                <Navbar.Text className="text-white me-3">
                  Welcome, {user.name} ({user.role})
                </Navbar.Text>
                <Button
                  variant="outline-light"
                  size="sm"
                  onClick={handleLogout}
                >
                  Logout
                </Button>
              </>
            )}
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}
