import { Router } from "express";
import { pool } from "../db.js";
import { authRequired } from "../middleware/authRequired.js";
import { auth } from "../auth.js";

const router = Router();

/* ── Admin guard ── */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function adminRequired(req, res, next) {
  const email = req.session?.user?.email?.toLowerCase();
  if (!email || !ADMIN_EMAILS.includes(email)) {
    return res.status(403).json({ error: "Accès refusé" });
  }
  next();
}

const guard = [authRequired, adminRequired];

/* ── GET /api/admin/users ── */
router.get("/users", ...guard, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.image, u.filiere, u.annee_etude, u.bio,
              u.privacy_visible, u.privacy_pause_matching, u.createdAt
       FROM \`user\` u
       ORDER BY u.createdAt DESC`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/* ── DELETE /api/admin/users/:userId ── */
router.delete("/users/:userId", ...guard, async (req, res, next) => {
  try {
    const { userId } = req.params;
    await pool.execute("DELETE FROM `user` WHERE id = ?", [userId]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ── PUT /api/admin/users/:userId ── */
router.put("/users/:userId", ...guard, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { name, email, filiere, annee_etude, bio, privacy_visible, privacy_pause_matching } = req.body;
    await pool.execute(
      `UPDATE \`user\` SET name=?, email=?, filiere=?, annee_etude=?, bio=?,
       privacy_visible=?, privacy_pause_matching=?, updatedAt=CURRENT_TIMESTAMP(3)
       WHERE id=?`,
      [name, email, filiere, annee_etude, bio,
       privacy_visible ? 1 : 0, privacy_pause_matching ? 1 : 0, userId]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ── POST /api/admin/users ── create user via email+password ── */
router.post("/users", ...guard, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Nom, email et mot de passe requis." });
    }
    const result = await auth.api.signUpEmail({ body: { name, email, password } });
    res.json({ ok: true, user: result?.user || null });
  } catch (e) {
    const msg = e?.body?.message || e?.message || "Erreur lors de la création.";
    res.status(400).json({ error: msg });
  }
});

/* ── GET /api/admin/reports?resolved=0|1 ── contact_reports ── */
router.get("/reports", ...guard, async (req, res, next) => {
  try {
    const resolved = req.query.resolved === "1";
    const [rows] = await pool.execute(
      `SELECT cr.id, cr.sujet, cr.message, cr.created_at, cr.resolved_at, cr.resolved_by,
              u.id AS user_id, u.name AS user_name, u.email AS user_email, u.image AS user_image,
              rv.name AS resolved_by_name
       FROM contact_reports cr
       LEFT JOIN \`user\` u  ON u.id  = cr.user_id
       LEFT JOIN \`user\` rv ON rv.id = cr.resolved_by
       WHERE cr.resolved_at IS ${resolved ? "NOT NULL" : "NULL"}
       ORDER BY cr.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/* ── PATCH /api/admin/reports/:id/resolve ── marquer résolu ── */
router.patch("/reports/:id/resolve", ...guard, async (req, res, next) => {
  try {
    await pool.execute(
      "UPDATE contact_reports SET resolved_at = NOW(), resolved_by = ? WHERE id = ?",
      [req.userId, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ── PATCH /api/admin/reports/:id/unresolve ── remettre en attente ── */
router.patch("/reports/:id/unresolve", ...guard, async (req, res, next) => {
  try {
    await pool.execute(
      "UPDATE contact_reports SET resolved_at = NULL, resolved_by = NULL WHERE id = ?",
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ── GET /api/admin/message-reports?resolved=0|1 ── */
router.get("/message-reports", ...guard, async (req, res, next) => {
  try {
    const resolved = req.query.resolved === "1";
    const [rows] = await pool.execute(
      `SELECT mr.id, mr.reported_at, mr.match_id, mr.resolved_at, mr.resolved_by,
              msg.id AS message_id, msg.content AS msg_content, msg.media_url, msg.media_type,
              msg.created_at AS msg_created_at, msg.deleted_at AS msg_deleted_at,
              reporter.id AS reporter_id, reporter.name AS reporter_name, reporter.email AS reporter_email,
              author.id AS author_id, author.name AS author_name, author.email AS author_email,
              rv.name AS resolved_by_name
       FROM message_reports mr
       LEFT JOIN messages msg       ON msg.id      = mr.message_id
       LEFT JOIN \`user\` reporter  ON reporter.id = mr.user_id
       LEFT JOIN \`user\` author    ON author.id   = msg.from_user_id
       LEFT JOIN \`user\` rv        ON rv.id        = mr.resolved_by
       WHERE mr.resolved_at IS ${resolved ? "NOT NULL" : "NULL"}
       ORDER BY mr.reported_at DESC`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/* ── PATCH /api/admin/message-reports/:id/resolve ── */
router.patch("/message-reports/:id/resolve", ...guard, async (req, res, next) => {
  try {
    await pool.execute(
      "UPDATE message_reports SET resolved_at = NOW(), resolved_by = ? WHERE id = ?",
      [req.userId, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ── PATCH /api/admin/message-reports/:id/unresolve ── */
router.patch("/message-reports/:id/unresolve", ...guard, async (req, res, next) => {
  try {
    await pool.execute(
      "UPDATE message_reports SET resolved_at = NULL, resolved_by = NULL WHERE id = ?",
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ── DELETE /api/admin/messages/:messageId ── soft-delete par l'admin ── */
router.delete("/messages/:messageId", ...guard, async (req, res, next) => {
  try {
    const messageId = Number(req.params.messageId);
    await pool.execute("UPDATE messages SET deleted_at = NOW() WHERE id = ?", [messageId]);
    const [[msg]] = await pool.execute("SELECT match_id FROM messages WHERE id = ?", [messageId]);
    if (msg) {
      req.app.get("io")?.to(`match:${msg.match_id}`).emit("message:deleted", {
        matchId: msg.match_id,
        messageId,
      });
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ── PATCH /api/admin/messages/:messageId/restore ── restaurer un message supprimé ── */
router.patch("/messages/:messageId/restore", ...guard, async (req, res, next) => {
  try {
    const messageId = Number(req.params.messageId);
    await pool.execute("UPDATE messages SET deleted_at = NULL WHERE id = ?", [messageId]);
    const [[msg]] = await pool.execute("SELECT match_id FROM messages WHERE id = ?", [messageId]);
    if (msg) {
      req.app.get("io")?.to(`match:${msg.match_id}`).emit("message:restored", {
        matchId: msg.match_id,
        messageId,
      });
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ── GET /api/admin/conversations ── all matches ── */
router.get("/conversations", ...guard, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT m.id, m.status, m.created_at,
              u1.id AS u1_id, u1.name AS u1_name, u1.email AS u1_email, u1.image AS u1_image,
              u2.id AS u2_id, u2.name AS u2_name, u2.email AS u2_email, u2.image AS u2_image,
              (SELECT COUNT(*) FROM messages msg WHERE msg.match_id = m.id) AS msg_count
       FROM matches m
       LEFT JOIN \`user\` u1 ON u1.id = m.user_id_1
       LEFT JOIN \`user\` u2 ON u2.id = m.user_id_2
       ORDER BY m.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/* ── GET /api/admin/conversations/:matchId/messages ── inclut les supprimés ── */
router.get("/conversations/:matchId/messages", ...guard, async (req, res, next) => {
  try {
    const matchId = Number(req.params.matchId);
    const [rows] = await pool.execute(
      `SELECT msg.*, u.name AS sender_name, u.image AS sender_image
       FROM messages msg
       LEFT JOIN \`user\` u ON u.id = msg.from_user_id
       WHERE msg.match_id = ?
       ORDER BY msg.created_at ASC`,
      [matchId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

export default router;
