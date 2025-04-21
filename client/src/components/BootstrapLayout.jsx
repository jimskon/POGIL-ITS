import React from 'react';
import { Container, Nav, Navbar } from 'react-bootstrap';
import { Link } from 'react-router-dom';

export default function BootstrapLayout({ children }) {
  return (
    <>
      <Navbar bg="primary" variant="dark" expand="lg" className="mb-4">
        <Container>
          {/* App title/logo link */}
          <Navbar.Brand as={Link} to="/dashboard">POGIL ITS</Navbar.Brand>

          <Navbar.Toggle aria-controls="basic-navbar-nav" />
          <Navbar.Collapse id="basic-navbar-nav">
            <Nav className="me-auto">
              <Nav.Link as={Link} to="/dashboard">Dashboard</Nav.Link>
              <Nav.Link as={Link} to="/manage-classes">Manage Classes</Nav.Link>
              <Nav.Link as={Link} to="/register">Register</Nav.Link>
            </Nav>
          </Navbar.Collapse>
        </Container>
      </Navbar>

      <Container>
        {children}
      </Container>
    </>
  );
}
