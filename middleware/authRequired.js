import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { pool } from "../db.js";

/**
 * Middleware: requires a valid BetterAuth session.
 * Also ensures the authenticated user exists in the SQL table `user`
 * (so the rest of the app can store profile + matching data).
 */
export async function authRequired(req, res, next) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) return res.status(401).json({ error: "Unauthorized" });

    req.session = session;
    req.userId = session.user?.id;

    // Keep DB user row in sync (minimal fields). Do NOT overwrite profile fields.
    if (req.userId) {
      const u = session.user || {};
      await pool.execute(
        `INSERT INTO \`user\` (id, name, email, image, filiere, annee_etude)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           name=VALUES(name),
           email=VALUES(email),
           image=VALUES(image),
           updatedAt=CURRENT_TIMESTAMP(3)`,
        [u.id, u.name || null, u.email || null, u.image || null, "", ""]
      );

      // Check if user is banned
      const [[banCheck]] = await pool.execute(
        "SELECT banned_at, banned_until, ban_reason FROM `user` WHERE id=? LIMIT 1",
        [req.userId]
      );
      if (banCheck?.banned_at) {
        const isPermanent = !banCheck.banned_until;
        const isStillBanned = isPermanent || new Date(banCheck.banned_until) > new Date();
        if (isStillBanned) {
          return res.status(403).json({
            error: "Compte suspendu",
            banned: true,
            bannedUntil: banCheck.banned_until,
            banReason: banCheck.ban_reason,
          });
        }
      }
    }

    next();
  } catch (e) {
    next(e);
  }
}
