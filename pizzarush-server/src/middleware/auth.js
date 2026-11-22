/**
 * Better Auth session middleware for the order API.
 *
 * The session cookie is host-scoped, so the browser reaches the Next.js app
 * on localhost:3000 with it; the same cookie is forwarded here on localhost:5000.
 */

const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3000"

/** Attach the signed-in user to the request (`req.user`), or null when logged out. */
export async function attachUser(req, res, next) {
  const cookie = req.headers.cookie
  if (!cookie) return next()

  try {
    const response = await fetch(`${WEB_ORIGIN}/api/auth/get-session`, {
      headers: { cookie },
    })
    const body = response.ok ? await response.json() : null
    req.user = body?.user ?? null
  } catch {
    req.user = null
  }

  next()
}

/** 401 when anonymous, 403 when the signed-in role does not match. */
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
