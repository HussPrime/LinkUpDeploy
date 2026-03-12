import { Router } from "express";
import { pool } from "../db.js";
import { authRequired } from "../middleware/authRequired.js";
import { uploadMedia } from "../middleware/uploadMedia.js";

const API_BASE =
  process.env.API_PUBLIC_URL ||
  process.env.BETTER_AUTH_URL ||
  `http://localhost:${process.env.PORT || 4000}`;

const router = Router();

async function ensureMember(matchId, userId) {
  const [[m]] = await pool.execute("SELECT * FROM matches WHERE id=? LIMIT 1", [matchId]);
  if (!m) return false;
  return m.user_id_1 === userId || m.user_id_2 === userId;
}

router.get("/matches/:matchId/messages", authRequired, async (req, res, next) => {
  try {
    const matchId = Number(req.params.matchId);
    const after = req.query.after ? new Date(req.query.after) : null;
    const meId = req.userId;

    if (!(await ensureMember(matchId, meId))) return res.status(403).json({ error: "Forbidden" });

    const sql = `SELECT * FROM messages WHERE match_id=? ${after ? "AND created_at > ?" : ""} ORDER BY created_at ASC LIMIT 100`;
    const params = after ? [matchId, after] : [matchId];
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post(
  "/matches/:matchId/messages",
  authRequired,
  uploadMedia.array("files", 10), // jusqu'à 10 fichiers
  async (req, res, next) => {
    try {
      if (req.files && req.files.length > 10) {
        return res.status(400).json({ error: "Maximum 10 fichiers autorisés." });
      }
      const matchId = Number(req.params.matchId);
      const meId = req.userId;

      let content = req.body.content;

      if (typeof content === "string") {
        content = content.trim();
      } else {
        content = null;
      }

      const files = req.files || [];

      if (!content && files.length === 0) {
        return res.status(400).json({ error: "Message vide" });
      }

      if (!(await ensureMember(matchId, meId))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const [[m]] = await pool.execute("SELECT * FROM matches WHERE id=? LIMIT 1", [matchId]);

      // Vérification blocage
      if (
        (m.user_id_1 === meId && m.user1block) ||
        (m.user_id_2 === meId && m.user2block) ||
        (m.user_id_1 !== meId && m.user1block) ||
        (m.user_id_2 !== meId && m.user2block)
      ) {
        return res.status(403).json({ error: "Message impossible : un utilisateur a bloqué l'autre." });
      }

      const to = m.user_id_1 === meId ? m.user_id_2 : m.user_id_1;
      const nowIso = new Date().toISOString();

      // Si plusieurs fichiers → on crée plusieurs messages
      const insertedMessages = [];

      if (files.length > 0) {
        for (const f of files) {
          const mediaType = f.mimetype.startsWith("image") ? "image" : "video";
          const mediaUrl = `${API_BASE}/api/uploads/media/${f.filename}`;

          const [r] = await pool.execute(
            "INSERT INTO messages (match_id, from_user_id, to_user_id, content, media_url, media_type) VALUES (?,?,?,?,?,?)",
            [matchId, meId, to, content || "", mediaUrl, mediaType]
          );

          insertedMessages.push({
            id: r.insertId,
            match_id: matchId,
            from_user_id: meId,
            to_user_id: to,
            content: content || "",
            media_url: mediaUrl,
            media_type: mediaType,
            created_at: nowIso,
            read_at: null
          });
        }
      } else {
        // Message texte seul
        const [r] = await pool.execute(
          "INSERT INTO messages (match_id, from_user_id, to_user_id, content) VALUES (?,?,?,?)",
          [matchId, meId, to, content]
        );

        insertedMessages.push({
          id: r.insertId,
          match_id: matchId,
          from_user_id: meId,
          to_user_id: to,
          content,
          media_url: null,
          media_type: null,
          created_at: nowIso,
          read_at: null
        });
      }

      // SOCKET.IO
      const io = req.app.get("io");
      if (io) {
        for (const msg of insertedMessages) {
          io.to(`match:${matchId}`).emit("message:new", msg);

          io.to(`user:${to}`).emit("conversation:update", {
            matchId,
            lastMessage: msg.media_url ? "[media]" : msg.content,
            lastTime: nowIso,
            fromUserId: meId
          });
        }
      }

      res.json({ ok: true, messages: insertedMessages });
    } catch (e) {
      next(e);
    }
  }
);

// POST /matches/:matchId/read — mark all messages TO me in this match as read
router.post("/matches/:matchId/read", authRequired, async (req, res, next) => {
  try {
    const matchId = Number(req.params.matchId);
    const meId = req.userId;

    if (!(await ensureMember(matchId, meId))) return res.status(403).json({ error: "Forbidden" });

    await pool.execute(
      "UPDATE messages SET read_at = NOW() WHERE match_id=? AND to_user_id=? AND read_at IS NULL",
      [matchId, meId]
    );

    // Notify the sender via socket that messages were read (readBy = who read them)
    const io = req.app.get("io");
    if (io) {
      io.to(`match:${matchId}`).emit("messages:read", { matchId, readBy: meId });
    }

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});


/* ── DELETE /matches/:matchId/messages/:messageId ── soft-delete par l'expéditeur ── */
router.delete("/matches/:matchId/messages/:messageId", authRequired, async (req, res, next) => {
  try {
    const matchId = Number(req.params.matchId);
    const messageId = Number(req.params.messageId);
    const meId = req.userId;

    if (!(await ensureMember(matchId, meId))) return res.status(403).json({ error: "Forbidden" });

    // Vérifier que le message appartient bien à l'utilisateur
    const [[msg]] = await pool.execute(
      "SELECT * FROM messages WHERE id = ? AND match_id = ? LIMIT 1",
      [messageId, matchId]
    );
    if (!msg) return res.status(404).json({ error: "Message introuvable" });
    if (msg.from_user_id !== meId) return res.status(403).json({ error: "Forbidden" });

    await pool.execute("UPDATE messages SET deleted_at = NOW() WHERE id = ?", [messageId]);

    const io = req.app.get("io");
    io?.to(`match:${matchId}`).emit("message:deleted", { matchId, messageId });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/messages/:messageId/report", authRequired, async (req, res, next) => {
  try {
    const messageId = Number(req.params.messageId);
    const userId = req.userId;
    const { matchId } = req.body;
    if (!messageId || !userId || !matchId) return res.status(400).json({ error: "Données manquantes." });
    // Vérifie que le message existe
    const [[msg]] = await pool.execute("SELECT * FROM messages WHERE id=? AND match_id=? LIMIT 1", [messageId, matchId]);
    if (!msg) return res.status(404).json({ error: "Message introuvable" });
    await pool.execute(
      "INSERT INTO message_reports (message_id, user_id, match_id, reported_at) VALUES (?, ?, ?, NOW())",
      [messageId, userId, matchId]
    );
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;
