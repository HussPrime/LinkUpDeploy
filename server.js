import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import path from "path";
import { fileURLToPath } from "url";

import { auth } from "./auth.js";
import { pool } from "./db.js";
import registerSocketHandlers from "./socket.js";

import profilesRouter from "./routes/profiles.js";
import likesRouter from "./routes/likes.js";
import matchesRouter from "./routes/matches.js";
import messagesRouter from "./routes/messages.js";

import notificationsRouter from "./routes/notifications.js";
import userSettingsRouter from "./routes/userSettings.js";
import contactRouter from "./routes/contact.js";
import adminRouter from "./routes/admin.js";

import { dbUserToAppUser, dbUserToProfile, isProfileComplete } from "./utils/user.js";

import multer from "multer";

dotenv.config();

/* -------------------------------------------------- */
/* Paths / App setup                                  */
/* -------------------------------------------------- */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

const app = express();

// Hostinger = reverse proxy HTTPS
app.set("trust proxy", 1);

/* -------------------------------------------------- */
/* CORS (robuste Hostinger + preview)                 */
/* -------------------------------------------------- */

const allowedOrigins = [
  "https://linkupcpne.com",
  "https://www.linkupcpne.com",
  "https://mediumspringgreen-clam-863148.hostingersite.com",
];

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // same-origin / SSR
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

/* -------------------------------------------------- */
/* HTTP + Socket.IO                                   */
/* -------------------------------------------------- */

const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: corsOptions
});

// Make io accessible in routes
app.set("io", io);

// 1) CORS FIRST (fix preflight to /api/auth/*)
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));

// 2) Mount BetterAuth AFTER CORS
app.all("/api/auth/*", toNodeHandler(auth));

// 3) Body parser
app.use(express.json());

// Health & session info + DB user sync
app.get("/api/me", async (req, res, next) => {
  try {
    const session = await auth.api.getSession({ 
      headers: fromNodeHeaders(req.headers) 
    }); 
    if (!session) return res.status(401).json({ ok: false });

    const u = session.user || {};
if (!u.id) 
      return res.status(401).json({ ok: false });

    // Ensure `user` row exists and stays in sync with auth (do NOT overwrite profile fields).
    await pool.execute(
      `INSERT INTO \`user\` (id, name, email, image, filiere, annee_etude)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         email = VALUES(email),
         image = VALUES(image),
         updatedAt = CURRENT_TIMESTAMP(3)`,
      [u.id, u.name || null, u.email || null, u.image || null, "", ""]
    );

    const [[dbUser]] = await pool.execute(
      "SELECT * FROM `user` WHERE id=? LIMIT 1", 
      [u.id]
    );
    
    // Check if user is banned
    if (dbUser?.banned_at) {
      const isPermanent = !dbUser.banned_until;
      const isStillBanned = isPermanent || new Date(dbUser.banned_until) > new Date();
      if (isStillBanned) {
        return res.status(403).json({
          error: "Compte suspendu",
          banned: true,
          bannedUntil: dbUser.banned_until,
          banReason: dbUser.ban_reason,
        });
      }
    }
	
    const isAdmin = ADMIN_EMAILS.includes((u.email || "").toLowerCase());

    res.json({
      ok: true,
      session,
      user: dbUserToAppUser(dbUser),
      profile: dbUserToProfile(dbUser),
      needs_onboarding: !isProfileComplete(dbUser),
	    is_admin: isAdmin,
        notifications: {
        newMessages: !!dbUser?.notif_new_messages,
        newMatches:  !!dbUser?.notif_new_matches,
        newReports:  !!dbUser?.notif_new_reports,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Feature routes
app.use("/api/profiles", profilesRouter);
app.use("/api/likes", likesRouter);
app.use("/api/matches", matchesRouter);
app.use("/api", messagesRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/me/settings", userSettingsRouter);
app.use("/api/contact", contactRouter);
app.use("/api/admin", adminRouter);

/* -------------------------------------------------- */
/* Static uploads                                     */
/* -------------------------------------------------- */

const uploadsPath = path.join(__dirname, "uploads");
app.use("/api/uploads", express.static(uploadsPath));

/* -------------------------------------------------- */
/* Frontend React (racine public_html)                */
/* -------------------------------------------------- */

const rootPath = __dirname; // public_html

// Servir tous les fichiers statiques (assets, css, js, etc.)
app.use(express.static(rootPath));

// Fallback React Router (IMPORTANT)
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
    return next();
  }

  res.sendFile(path.join(rootPath, "index.html"));
});


/* -------------------------------------------------- */
/* Error handler                                      */
/* -------------------------------------------------- */

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

app.get("/", (req, res) => {
  res.redirect(process.env.CLIENT_ORIGIN);
});


/* -------------------------------------------------- */
/* Socket.IO auth                                     */
/* -------------------------------------------------- */

io.use(async (socket, next) => {
  try {
    const headers = new Headers();
    const cookie = socket.request.headers.cookie || "";
    headers.set("cookie", cookie);
    const session = await auth.api.getSession({ headers });
    if (!session) return next(new Error("unauthorized"));
    socket.data.session = session;
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});

// Middleware global pour capturer les erreurs Multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Fichier trop volumineux (max 20MB)" });
    }
    return res.status(400).json({ error: err.message });
  }

  next(err);
});

registerSocketHandlers(io);

/* -------------------------------------------------- */
/* Start server                                       */
/* -------------------------------------------------- */

const PORT = Number(process.env.PORT || 4000);

httpServer.listen(PORT, () => {
  console.log(`✅ LinkUp API running on port ${PORT}`);
});
