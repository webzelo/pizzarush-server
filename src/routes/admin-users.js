import { requireRole, verifyToken } from "../middleware/auth.js"
import {
  PAGE_SIZE,
  escapeRegex,
  formatCurrency,
  isPremiumActive,
  objectId,
  text,
} from "../util.js"

export function registerAdminUsersRoutes(app) {
  const db = app.locals.db
  const usersCollection = db.collection("user")
  const vendorsCollection = db.collection("vendors")

  /**
   * Port of listAdminUsers + getVendorByUserId lookup: `vendors` keyed by
   * their string userId, `users` keyed by their ObjectId _id.
   */
  function adminUserView(user, vendorsById) {
    const vendor = vendorsById.get(String(user._id))
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      image: user.image ?? "",
      role: user.role,
      banned: Boolean(user.banned),
      banReason: user.banReason ?? "",
      createdAt: user.createdAt,
      restaurantName: vendor?.restaurantName ?? "",
      plan: isPremiumActive(vendor) ? "premium" : "free",
    }
  }

  // — GET /api/admin/stats —
  app.get(
    "/api/admin/stats",
    verifyToken,
    requireRole("admin"),
    async (_req, res) => {
      const [
        totalUsers,
        totalVendors,
        totalCustomers,
        totalMenuItems,
        pendingMenuItems,
        totalTransactions,
        paid,
      ] = await Promise.all([
        usersCollection.countDocuments(),
        usersCollection.countDocuments({ role: "vendor" }),
        usersCollection.countDocuments({ role: "customer" }),
        db.collection("menuItems").countDocuments(),
        db.collection("menuItems").countDocuments({ status: "pending" }),
        db.collection("transactions").countDocuments(),
        db.collection("transactions")
          .aggregate([
            { $match: { paymentStatus: "paid" } },
            { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount" } } },
          ])
          .toArray(),
      ])

      return res.json({
        totalUsers,
        totalVendors,
        totalCustomers,
        totalMenuItems,
        pendingMenuItems,
        totalTransactions,
        paidTransactions: paid[0]?.count ?? 0,
        revenue: formatCurrency(paid[0]?.amount ?? 0),
      })
    }
  )

  // — GET /api/admin/users —
  app.get(
    "/api/admin/users",
    verifyToken,
    requireRole("admin"),
    async (req, res) => {
      const page = Math.max(1, Number(req.query.page) || 1)
      const role = text(req.query.role)
      const q = text(req.query.q)

      const query = {}
      if (role) query.role = role
      if (q) {
        const regex = new RegExp(escapeRegex(q), "i")
        query.$or = [{ name: regex }, { email: regex }]
      }

      const [users, total] = await Promise.all([
        usersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * PAGE_SIZE)
          .limit(PAGE_SIZE)
          .toArray(),
        usersCollection.countDocuments(query),
      ])

      const vendorIds = users
        .filter((user) => user.role === "vendor")
        .map((user) => user._id)
      // `vendors.userId` is stored as a string (like `menuItems.vendorId`).
      const vendors =
        vendorIds.length > 0
          ? await vendorsCollection
              .find({ userId: { $in: vendorIds.map((id) => id.toString()) } })
              .toArray()
          : []
      const vendorsById = new Map(
        vendors.map((vendor) => [String(vendor.userId), vendor])
      )

      return res.json({
        users: users.map((user) => adminUserView(user, vendorsById)),
        total,
        page,
        pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      })
    }
  )

  // — PATCH /api/admin/users/:id/block —
  app.patch(
    "/api/admin/users/:id/block",
    verifyToken,
    requireRole("admin"),
    async (req, res) => {
      const adminId = String(req.user.id ?? req.user._id)
      const userId = objectId(req.params.id)
      if (!userId) {
        return res.status(404).json({ error: "User not found." })
      }
      const blocked = req.body?.blocked === true

      const target = await usersCollection.findOne({ _id: userId })
      if (!target) {
        return res.status(404).json({ error: "User not found." })
      }
      if (String(target._id) === adminId) {
        return res.status(400).json({ error: "You cannot block your own account." })
      }
      if (target.role === "admin") {
        return res.status(400).json({ error: "Admin accounts cannot be blocked." })
      }

      await usersCollection.updateOne(
        { _id: userId },
        {
          $set: {
            banned: blocked,
            banReason: blocked ? "Blocked by an administrator" : null,
            updatedAt: new Date(),
          },
        }
      )

      if (blocked) {
        // Sign out every active session immediately.
        await db.collection("session").deleteMany({ userId: target._id })
      }

      return res.json({
        ok: true,
        message: blocked
          ? `${target.name} has been blocked.`
          : `${target.name} can use the platform again.`,
      })
    }
  )
}
