import { Router } from "express";
import { pool } from "../db.js";
import { authRequired } from "../middleware/authRequired.js";

const router = Router();

router.post("/", authRequired, async (req, res, next) => {
  try {
    const userId = req.userId;
    const { sujet, message } = req.body;
    if (!userId || !sujet || !message) {
      return res.status(400).json({ error: "Champs requis manquants." });
    }
    await pool.execute(
      "INSERT INTO contact_reports (user_id, sujet, message, created_at) VALUES (?, ?, ?, NOW())",
      [userId, sujet, message]
    );
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;
