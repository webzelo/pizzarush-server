import { ObjectId } from "mongodb"

/**
 * Access-token middleware: reads the signed-in user's Better Auth session
 * token from the `Authorization: Bearer <token>` header, loads the user from
 * the `session` and `user` collections, and sets `req.user` (or 401).
 *
 * User and role come from the database — never from the client.
 */
export async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const token = authHeader.split(" ")[1]
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const db = req.app.locals.db
  const session = await db.collection("session").findOne({ token })
  if (!session || new Date(session.expiresAt) < new Date()) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const user = await db.collection("user").findOne({
    _id: new ObjectId(session.userId),
  })
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  req.user = user
  next()
}

/** 401 when anonymous, 403 when the verified role does not match. */
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" })
    }
    if (req.user.role !== role) {
      return res.status(403).json({ error: "Not your role" })
    }
    next()
  }
}
