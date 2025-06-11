const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");

require("dotenv").config();
require("./heartbeatCleaner");

const app = express();
const PORT = process.env.PORT || 4000;
const db = require("./db");
const aiRoutes = require("./ai/routes");

// ✅ Resolve static path
const staticDir = path.join(__dirname, "../client/dist");
console.log("Resolved staticDir:", staticDir);

// ✅ Middleware
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

// ✅ Restore req.user from session if available
app.use(async (req, res, next) => {
  if (req.session.userId && !req.user) {
    try {
      const [[user]] = await db.query(
        "SELECT id, name, email, role FROM users WHERE id = ?",
        [req.session.userId]
      );
      if (user) {
        req.user = user;
      }
    } catch (err) {
      console.error("❌ Error restoring user from session:", err);
    }
  }
  next();
});

// ✅ API Routes
app.use("/api/ai", aiRoutes);
app.use("/api/auth", require("./auth/routes"));
app.use("/api/users", require("./users/routes"));
app.use("/api/courses", require("./courses/routes"));
app.use("/api/activities", require("./activities/routes"));
app.use("/api/groups", require("./groups/routes"));
app.use("/api/responses", require("./responses/routes"));
app.use("/api/events", require("./events/routes"));
app.use("/api/classes", require("./classes/routes"));
app.use("/api/activity-instances", require("./activity_instances/routes"));

// ✅ Serve frontend
app.use(express.static(staticDir));

// ✅ Handle unknown API routes
app.use("/api", (req, res) => {
  console.warn(
    `⚠️ Unknown API route accessed: ${req.method} ${req.originalUrl}`
  );
  res.status(404).json({ error: "API route not found" });
});

// ✅ Let React handle all other routes
app.all("*", (req, res) => {
  console.log(`📦 React route hit: ${req.method} ${req.originalUrl}`);
  res.sendFile(path.resolve(staticDir, "index.html"));
});

// ✅ Setup Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
app.set("io", io);

io.on("connection", (socket) => {
  console.log(`🔌 New socket connected: ${socket.id}`);

  socket.on("joinGroup", (groupId) => {
    socket.join(`group-${groupId}`);
    console.log(`🟢 Socket ${socket.id} joined group-${groupId}`);
  });

  socket.on("disconnect", () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
});

// ✅ Start server
server.listen(PORT, "0.0.0.0", () =>
  console.log(`ITS server + socket running on port ${PORT}`)
);
