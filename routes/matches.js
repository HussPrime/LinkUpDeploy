import { Router } from "express";
import { pool } from "../db.js";
import { authRequired } from "../middleware/authRequired.js";
import { splitName } from "../utils/user.js";

const router = Router();

router.get("/", authRequired, async (req, res, next) => {
  try {
    const meId = req.userId;

  const [rows] = await pool.execute(
    `SELECT 
        m.id AS match_id,
        m.user_id_1,
        m.user_id_2,
        m.user1block,
        m.user2block,
        CASE WHEN m.user_id_1 = ? THEN m.user_id_2 ELSE m.user_id_1 END AS other_id,
        u.name,
        u.image,

        
        (SELECT content 
         FROM messages 
         WHERE match_id = m.id 
         ORDER BY created_at DESC LIMIT 1) AS last_message,

        (SELECT media_type 
         FROM messages 
         WHERE match_id = m.id 
         ORDER BY created_at DESC LIMIT 1) AS last_message_media_type,

        (SELECT media_url 
         FROM messages 
         WHERE match_id = m.id 
         ORDER BY created_at DESC LIMIT 1) AS last_message_media_url,
		 
		 (SELECT deleted_at
         FROM messages
         WHERE match_id = m.id
         ORDER BY created_at DESC LIMIT 1) AS last_message_deleted_at,

        (SELECT created_at 
         FROM messages 
         WHERE match_id = m.id 
         ORDER BY created_at DESC LIMIT 1) AS last_time,

        (SELECT COUNT(*) FROM messages
         WHERE match_id = m.id 
           AND to_user_id = ? 
           AND read_at IS NULL) AS unread_count,

        CASE WHEN m.created_at > COALESCE(
          (SELECT last_seen_matches_at FROM user WHERE id = ?),
          '1970-01-01 00:00:00'
        ) THEN 1 ELSE 0 END AS is_new_match

     FROM matches m
     JOIN user u 
       ON u.id = CASE WHEN m.user_id_1 = ? THEN m.user_id_2 ELSE m.user_id_1 END
     WHERE (m.user_id_1 = ? OR m.user_id_2 = ?)
     ORDER BY (last_time IS NULL), last_time DESC, m.created_at DESC`,
    [meId, meId, meId, meId, meId, meId]
  );

    const out = rows.map((r) => {
      const { first_name, last_name } = splitName(r.name || "");

      // Déterminer si je suis user1 ou user2
      const whoAmI = r.user_id_1 === meId ? 1 : 2;

      return {
        match_id: r.match_id,
        other_id: r.other_id,
        first_name,
        last_name,
        avatar_url: r.image || null,
      
        last_message: r.last_message || null,
        last_message_media_type: r.last_message_media_type || null,
        last_message_media_url: r.last_message_media_url || null,
		last_message_deleted: !!r.last_message_deleted_at,
      
        last_time: r.last_time || null,
        unread_count: Number(r.unread_count || 0),
        is_new_match: Boolean(r.is_new_match),
      
        user1block: Boolean(r.user1block),
        user2block: Boolean(r.user2block),
        whoAmI
      };

    });

    res.json(out);
  } catch (e) {
    next(e);
  }
});


router.patch("/:matchId/block", authRequired, async (req, res, next) => {
  try {
    const meId = req.userId;
    const { matchId } = req.params;
    const { blocked } = req.body;

    // Vérifier que le match existe et appartient à l'utilisateur
    const [rows] = await pool.execute(
      `SELECT * FROM matches 
       WHERE id = ? AND (user_id_1 = ? OR user_id_2 = ?)`,
      [matchId, meId, meId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Match not found" });
    }

    const match = rows[0];

    // Déterminer quel champ mettre à jour
    const isUser1 = match.user_id_1 === meId;
    const fieldToUpdate = isUser1 ? "user1block" : "user2block";

    // Mise à jour SQL
    await pool.execute(
      `UPDATE matches SET ${fieldToUpdate} = ? WHERE id = ?`,
      [blocked, matchId]
    );

    // Récupérer les valeurs mises à jour
    const [[updated]] = await pool.execute(
      `SELECT user1block, user2block FROM matches WHERE id = ?`,
      [matchId]
    );

    // 🔥 EMETTRE L'ÉVÉNEMENT SOCKET ICI
    const io = req.app.get("io");
    if (io) {
      const blockUpdateData = {
        matchId,
        user1block: updated.user1block,
        user2block: updated.user2block
      };
      
      // Émettre à la room du match (les deux users qui chattent)
      io.to(`match:${matchId}`).emit("block:update", blockUpdateData);
      
      // Émettre aussi à la room personnelle de chaque user (même s'ils ne chattent pas)
      io.to(`user:${match.user_id_1}`).emit("block:update", blockUpdateData);
      io.to(`user:${match.user_id_2}`).emit("block:update", blockUpdateData);
    }

    // Réponse au front
    res.json({
      success: true,
      matchId,
      user1block: updated.user1block,
      user2block: updated.user2block
    });

  } catch (e) {
    next(e);
  }
});


router.get("/:matchId/block", authRequired, async (req, res, next) => {
  try {
    const matchId = req.params.matchId;
    const meId = req.userId;

    // Vérifier que le match appartient à l'utilisateur
    const [rows] = await pool.execute(
      `SELECT user1block, user2block, user_id_1 FROM matches 
       WHERE id = ? AND (user_id_1 = ? OR user_id_2 = ?)`,
      [matchId, meId, meId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Match not found" });
    }

    res.json({ user1block: rows[0].user1block, user2block: rows[0].user2block, whoAmI: meId == rows[0].user_id_1 ? 1 : 2 });
  } catch (e) {
    next(e);
  }
});

export default router;
