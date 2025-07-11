import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Navbar, Nav, Container, Button } from 'react-bootstrap';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';


export default function NavBar({ bgColor = "dark", fixed = false, statusText = "", roleLabel = "" }) {


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


  if (loading) return null;




  return (
    <Navbar bg={bgColor || "dark"} variant="dark" expand="lg" className="mb-4 fixed-top flex-nowrap">


      <Container>
        <Navbar.Brand as={Link} to="/dashboard">
          POGIL ITS
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="pogil-navbar" />
        <Navbar.Collapse id="pogil-navbar">
          <Nav className="me-auto flex-row gap-3">
            {user && (
              <>
                <Nav.Link as={Link} to="/dashboard" className="px-2">
                  Dashboard
                </Nav.Link>
                {["root", "creator", "instructor"].includes(user.role) && (
                  <Nav.Link as={Link} to="/manage-courses" className="px-2">
                    Manage Courses
                  </Nav.Link>
                )}
                {(user.role === "root" || user.role === "creator") && (
                  <Nav.Link as={Link} to="/manage-classes" className="px-2">
                    Manage Classes
                  </Nav.Link>
                )}
                {user.role === "root" && (
                  <Nav.Link as={Link} to="/admin/users" className="px-2">
                    Manage Users
                  </Nav.Link>
                )}
              </>
            )}
          </Nav>



          <Nav className="ms-auto d-flex align-items-center flex-row gap-3">

            {user && (
              <>
                {statusText && (
                  <Navbar.Text className="text-white me-5">
                    {statusText}
                  </Navbar.Text>
                )}

                <div className="d-flex align-items-center">
                  <Navbar.Text className="text-white me-3">
                    {roleLabel
                      ? `${roleLabel}, ${user.name} (${user.role})`
                      : `Welcome, ${user.name} (${user.role})`}
                  </Navbar.Text>

                  <Button
                    variant="outline-light"
                    size="sm"
                    onClick={handleLogout}
                  >
                    Logout
                  </Button>
                </div>
              </>
            )}

            {!user && (
              <div className="d-flex align-items-center">
                <Nav.Link as={Link} to="/register">
                  Register
                </Nav.Link>
                <Nav.Link as={Link} to="/">
                  Login
                </Nav.Link>
              </div>
            )}
          </Nav>

        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}
