import { Router } from "express";
import { pool } from "../db.js";
import { authRequired } from "../middleware/authRequired.js";

const router = Router();

/**
 * GET /api/notifications/counts
 * Retourne le nombre de matches créés après `last_seen_matches_at` de l'utilisateur.
 */
router.get("/counts", authRequired, async (req, res, next) => {
  try {
    const meId = req.userId;

    const [[u]] = await pool.execute(
      "SELECT last_seen_matches_at FROM `user` WHERE id=? LIMIT 1",
      [meId]
    );

    const lastSeen = u?.last_seen_matches_at || null;

    let count;
    if (lastSeen) {
      const [[row]] = await pool.execute(
        `SELECT COUNT(*) AS cnt FROM matches
         WHERE (user_id_1=? OR user_id_2=?)
           AND created_at > ?`,
        [meId, meId, lastSeen]
      );
      count = Number(row.cnt);
    } else {
      const [[row]] = await pool.execute(
        `SELECT COUNT(*) AS cnt FROM matches
         WHERE (user_id_1=? OR user_id_2=?)`,
        [meId, meId]
      );
      count = Number(row.cnt);
    }

    // Count unread messages (messages sent TO me that have no read_at)
    const [[msgRow]] = await pool.execute(
      "SELECT COUNT(*) AS cnt FROM messages WHERE to_user_id=? AND read_at IS NULL",
      [meId]
    );
    const unreadMessagesCount = Number(msgRow.cnt);

    res.json({ unreadMatchesCount: count, unreadMessagesCount });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/notifications/seen-matches
 * Marque tous les matches actuels comme vus (met à jour last_seen_matches_at = now).
 */
router.post("/seen-matches", authRequired, async (req, res, next) => {
  try {
    const meId = req.userId;

    await pool.execute(
      "UPDATE `user` SET last_seen_matches_at = NOW() WHERE id = ?",
      [meId]
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
