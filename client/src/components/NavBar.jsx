// source/components/NavBar.jsx
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Navbar, Nav, Container, Button } from 'react-bootstrap';
import { useUser } from '../context/UserContext';


export default function NavBar() {
  const { user, setUser } = useUser();
  const navigate = useNavigate();


  const handleLogout = () => {
    setUser(null);
    navigate('/');
  };


  return (
    <Navbar bg="dark" variant="dark" expand="lg" className="mb-4">
      <Container>
        <Navbar.Brand as={Link} to="/dashboard">POGIL ITS</Navbar.Brand>
        <Navbar.Toggle aria-controls="pogil-navbar" />
        <Navbar.Collapse id="pogil-navbar">
          <Nav className="me-auto">
            <Nav.Link as={Link} to="/dashboard">Dashboard</Nav.Link>

            {(user?.role === 'root' || user?.role === 'creator' || user?.role === 'instructor') && (
              <Nav.Link as={Link} to="/manage-courses">Manage Courses</Nav.Link>
            )}

            {(user?.role === 'root' || user?.role === 'creator') && (
              <Nav.Link as={Link} to="/manage-classes">Manage Classes</Nav.Link>
            )}

            {user?.role === 'root' && (
              <Nav.Link as={Link} to="/admin/users">Manage Users</Nav.Link>
            )}
          </Nav>


          <Nav className="ms-auto align-items-center">
            {!user ? (
              <>
                <Nav.Link as={Link} to="/register">Register</Nav.Link>
                <Nav.Link as={Link} to="/">Login</Nav.Link>
              </>
            ) : (
              <>
                <Navbar.Text className="text-white me-3">
                  Welcome, {user.name} ({user.role})
                </Navbar.Text>
                <Button variant="outline-light" size="sm" onClick={handleLogout}>
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