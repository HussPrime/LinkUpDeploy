import { Router } from "express";
import { pool } from "../db.js";
import { authRequired } from "../middleware/authRequired.js";

const router = Router();

// POST /likes { to_user_id, action: "like" | "skip" }
router.post("/", authRequired, async (req, res, next) => {
  try {
    const action = req.body.action || "like";
    const toUserId = String(req.body.to_user_id || "");
    const meId = req.userId;

    if (!toUserId) return res.status(400).json({ error: "to_user_id is required" });
    if (toUserId === meId) return res.status(400).json({ error: "Cannot like yourself" });

    if (action === "skip") {
      await pool.execute(
        "INSERT IGNORE INTO passes (from_user_id, to_user_id) VALUES (?,?)",
        [meId, toUserId]
      );
      return res.json({ ok: true, skipped: true });
    }

    await pool.execute(
      "INSERT IGNORE INTO likes (from_user_id, to_user_id) VALUES (?,?)",
      [meId, toUserId]
    );

    const [[mutual]] = await pool.execute(
      "SELECT id FROM likes WHERE from_user_id=? AND to_user_id=? LIMIT 1",
      [toUserId, meId]
    );

    let matched = false;
    let matchId = null;

    if (mutual) {
      const a = meId < toUserId ? meId : toUserId;
      const b = meId < toUserId ? toUserId : meId;

      await pool.execute(
        "INSERT IGNORE INTO matches (user_id_1, user_id_2) VALUES (?,?)",
        [a, b]
      );

      const [[m]] = await pool.execute(
        "SELECT id FROM matches WHERE user_id_1=? AND user_id_2=? LIMIT 1",
        [a, b]
      );

      matchId = m?.id || null;
      matched = !!matchId;

      // Notify the other user about the new match via their personal room
      if (matched) {
        const io = req.app.get("io");
        if (io) {
          io.to(`user:${toUserId}`).emit("match:new", { matchId });
        }
      }
    }

    res.json({ ok: true, liked: true, matched, match_id: matchId });
  } catch (e) {
    next(e);
  }
});

export default router;
