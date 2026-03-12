import { Router } from "express";
import { pool } from "../db.js";
import { authRequired } from "../middleware/authRequired.js";

const router = Router();

/**
 * GET /api/me/settings
 * Returns notification + privacy settings for the current user.
 */
router.get("/", authRequired, async (req, res, next) => {
  try {
    const [[row]] = await pool.execute(
      `SELECT notif_new_messages, notif_new_matches,
              privacy_visible, privacy_pause_matching
       FROM \`user\` WHERE id=? LIMIT 1`,
      [req.userId]
    );
    if (!row) return res.status(404).json({ error: "User not found" });

    res.json({
      notifications: {
        newMessages: !!row.notif_new_messages,
        newMatches:  !!row.notif_new_matches,
      },
      privacy: {
        visible:        !!row.privacy_visible,
        pauseMatching:  !!row.privacy_pause_matching,
      },
    });
  } catch (e) { next(e); }
});

/**
 * PUT /api/me/settings
 * Body: { notifications?: { newMessages, newMatches }, privacy?: { visible, pauseMatching } }
 */
router.put("/", authRequired, async (req, res, next) => {
  try {
    const { notifications = {}, privacy = {} } = req.body;

    // Only update fields that were provided (use COALESCE pattern)
    await pool.execute(
      `UPDATE \`user\` SET
        notif_new_messages    = COALESCE(?, notif_new_messages),
        notif_new_matches     = COALESCE(?, notif_new_matches),
        privacy_visible       = COALESCE(?, privacy_visible),
        privacy_pause_matching = COALESCE(?, privacy_pause_matching),
        updatedAt             = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [
        notifications.newMessages  !== undefined ? (notifications.newMessages  ? 1 : 0) : null,
        notifications.newMatches   !== undefined ? (notifications.newMatches   ? 1 : 0) : null,
        privacy.visible            !== undefined ? (privacy.visible            ? 1 : 0) : null,
        privacy.pauseMatching      !== undefined ? (privacy.pauseMatching      ? 1 : 0) : null,
        req.userId,
      ]
    );

    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
