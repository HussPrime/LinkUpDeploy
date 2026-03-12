import { Router } from "express";
import { pool } from "../db.js";
import { authRequired } from "../middleware/authRequired.js";
import { scoreCandidate } from "../services/matching.js";
import { uploadAvatar } from "../middleware/uploadAvatar.js";
import { dbUserToAppUser, dbUserToProfile } from "../utils/user.js";

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

const router = Router();

const API_BASE =
  process.env.API_PUBLIC_URL ||
  process.env.BETTER_AUTH_URL ||
  `http://localhost:${process.env.PORT || 4000}`;

// GET /profiles/me
router.get("/me", authRequired, async (req, res, next) => {
  try {
    const userId = req.userId;
    const [[dbUser]] = await pool.execute("SELECT * FROM `user` WHERE id=? LIMIT 1", [userId]);
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    const [experiences] = await pool.execute(
      "SELECT * FROM experiences WHERE profile_id=? ORDER BY COALESCE(date_fin, date_debut) DESC, id DESC",
      [userId]
    );

    res.json({
      user: dbUserToAppUser(dbUser),
      profile: dbUserToProfile(dbUser),
      experiences,
    });
  } catch (e) {
    next(e);
  }
});

// GET /profiles/recommendations (spécifique - doit venir AVANT /:userId)
router.get("/recommendations", authRequired, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 50);
    const meId = req.userId;

    const [[meRow]] = await pool.execute("SELECT * FROM `user` WHERE id=? LIMIT 1", [meId]);
    if (!meRow) return res.status(404).json({ error: "User not found" });

    const myProfile = dbUserToProfile(meRow);
    const [myExp] = await pool.execute("SELECT * FROM experiences WHERE profile_id=?", [meId]);

    const mySkillsSet = new Set(
      (myProfile?.centres_interet || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );

    // Load user preferences + privacy
    const sameFiliereOnly = !!meRow.pref_same_filiere;
    const anneeFilter = meRow.pref_annee_filter
      ? meRow.pref_annee_filter.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    // If user paused matching, signal it explicitly so the frontend can show the right state
    if (meRow.privacy_pause_matching) {
      return res.json({ paused: true, items: [] });
    }

    const [seenRows] = await pool.execute(
      `SELECT to_user_id FROM likes WHERE from_user_id=?
       UNION SELECT to_user_id FROM passes WHERE from_user_id=?`,
      [meId, meId]
    );
    const seen = new Set([meId, ...seenRows.map((r) => r.to_user_id)]);

    // Build candidates query with optional preference + privacy filters
    let candSql = `SELECT id, name, email, image, filiere, annee_etude, bio, centres_interet
       FROM \`user\`
       WHERE id <> ?
         AND TRIM(COALESCE(filiere,'')) <> ''
         AND TRIM(COALESCE(annee_etude,'')) <> ''
         AND COALESCE(privacy_visible, 1) = 1`;  /* exclude hidden profiles */
    const candParams = [meId];

    if (sameFiliereOnly && myProfile?.filiere) {
      candSql += " AND filiere = ?";
      candParams.push(myProfile.filiere);
    }

    if (anneeFilter.length > 0) {
      const placeholders = anneeFilter.map(() => "?").join(",");
      candSql += ` AND annee_etude IN (${placeholders})`;
      candParams.push(...anneeFilter);
    }

    const [candidates] = await pool.execute(candSql, candParams);

    const ids = candidates.map((c) => c.id);
    const expByUser = new Map();
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const [expRows] = await pool.query(
        `SELECT * FROM experiences WHERE profile_id IN (${placeholders})`,
        ids
      );
      for (const e of expRows) {
        const arr = expByUser.get(e.profile_id) || [];
        arr.push(e);
        expByUser.set(e.profile_id, arr);
      }
    }

    const ranked = candidates
      .filter((c) => !seen.has(c.id))
      .map((c) => ({
        user: dbUserToAppUser(c),
        profile: dbUserToProfile(c),
        experiences: expByUser.get(c.id) || [],
      }))
      .map((c) => ({ ...c, score: scoreCandidate(myProfile || {}, myExp, mySkillsSet, c) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    res.json({ paused: false, items: ranked });
  } catch (e) {
    next(e);
  }
});

// GET /profiles/me/preferences
router.get("/me/preferences", authRequired, async (req, res, next) => {
  try {
    const [[row]] = await pool.execute(
      "SELECT pref_same_filiere, pref_annee_filter FROM `user` WHERE id=? LIMIT 1",
      [req.userId]
    );
    if (!row) return res.status(404).json({ error: "User not found" });
    res.json({
      sameFiliereOnly: !!row.pref_same_filiere,
      anneeFilter: row.pref_annee_filter
        ? row.pref_annee_filter.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    });
  } catch (e) { next(e); }
});

// GET /profiles/:userId (public profile - générique, doit venir APRÈS les routes spécifiques)
router.get("/:userId", authRequired, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const [[dbUser]] = await pool.execute("SELECT * FROM `user` WHERE id=? LIMIT 1", [userId]);
    if (!dbUser) return res.status(404).json({ error: "User not found" });
    
    // Don't show profile if user is hidden
    if (!dbUser.privacy_visible) {
      return res.status(404).json({ error: "User not found" });
    }

    const [experiences] = await pool.execute(
      "SELECT * FROM experiences WHERE profile_id=? ORDER BY COALESCE(date_fin, date_debut) DESC, id DESC",
      [userId]
    );

    res.json({
      user: dbUserToAppUser(dbUser),
      profile: dbUserToProfile(dbUser),
      experiences,
    });
  } catch (e) {
    next(e);
  }
});

// PUT /profiles/me
router.put("/me", authRequired, async (req, res, next) => {
  try {
    const userId = req.userId;
    const { filiere, annee_etude, bio, centres_interet, experiences } = req.body;

    await pool.execute(
      `UPDATE \`user\`
       SET filiere=?, annee_etude=?, bio=?, centres_interet=?, updatedAt=CURRENT_TIMESTAMP(3)
       WHERE id=?`,
      [filiere, annee_etude, bio || null, centres_interet || null, userId]
    );

    await pool.execute("DELETE FROM experiences WHERE profile_id = ?", [userId]);
    for (const e of experiences || []) {
      await pool.execute(
        `INSERT INTO experiences (profile_id, entreprise, poste, date_debut, date_fin, description)
         VALUES (?,?,?,?,?,?)`,
        [userId, e.entreprise, e.poste, e.date_debut || null, e.date_fin || null, e.description || null]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// PUT /profiles/me/preferences
router.put("/me/preferences", authRequired, async (req, res, next) => {
  try {
    const { sameFiliereOnly = false, anneeFilter = [] } = req.body;
    const anneeStr = Array.isArray(anneeFilter) && anneeFilter.length
      ? anneeFilter.join(",")
      : null;
    await pool.execute(
      "UPDATE `user` SET pref_same_filiere=?, pref_annee_filter=?, updatedAt=CURRENT_TIMESTAMP(3) WHERE id=?",
      [sameFiliereOnly ? 1 : 0, anneeStr, req.userId]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// DELETE /profiles/experiences/:id
router.delete("/experiences/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const userId = req.userId;

    await pool.execute("DELETE FROM experiences WHERE id=? AND profile_id=?", [id, userId]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// PUT /profiles/me/avatar
router.put("/me/avatar", authRequired, uploadAvatar.single("avatar"), async (req, res, next) => {
  try {
    const userId = req.userId;
    if (!req.file) return res.status(400).json({ error: "Aucune image envoyée" });

    const [[dbUser]] = await pool.execute("SELECT * FROM `user` WHERE id=? LIMIT 1", [userId]);
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    // Delete old avatar if it was stored in our uploads folder
    if (dbUser.image) {
      const oldFilename = String(dbUser.image).split("/").pop();
      const oldFsPath = path.join(process.cwd(), "src", "uploads", "avatars", oldFilename);
      if (oldFilename && fs.existsSync(oldFsPath)) {
        fs.unlinkSync(oldFsPath);
      }
    }

    const avatarUrl = `${API_BASE}/api/uploads/avatars/${req.file.filename}`;

    await pool.execute(
      "UPDATE `user` SET image=?, updatedAt=CURRENT_TIMESTAMP(3) WHERE id=?",
      [avatarUrl, userId]
    );

    res.json({ ok: true, avatar_url: avatarUrl });
  } catch (e) {
    next(e);
  }
});

export default router;
