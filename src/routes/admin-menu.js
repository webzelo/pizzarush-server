import { requireRole, verifyToken } from "../middleware/auth.js"
import {
  PAGE_SIZE,
  escapeRegex,
  isPremiumActive,
  objectId,
  text,
} from "../util.js"

const MENU_STATUSES = ["pending", "approved", "rejected"]

export function registerAdminMenuRoutes(app) {
  const db = app.locals.db
  const menuItemsCollection = db.collection("menuItems")
  const vendorsCollection = db.collection("vendors")
  const usersCollection = db.collection("user")

  /** Port of listAdminMenuItems. */
  function adminMenuItemView(item, vendorsById, emailsById) {
    const vendor = vendorsById.get(item.vendorId)
    return {
      id: item._id.toString(),
      name: item.name,
      category: item.category,
      price: item.price,
      imageUrl: item.imageUrl,
      status: item.status,
      isActive: item.isActive,
      rejectionReason: item.rejectionReason,
      createdAt: item.createdAt,
      vendorId: item.vendorId,
      vendorName: vendor?.restaurantName ?? "Unknown vendor",
      vendorEmail: emailsById.get(item.vendorId) ?? "",
      premium: isPremiumActive(vendor),
    }
  }

  // — GET /api/admin/menu —
  app.get(
    "/api/admin/menu",
    verifyToken,
    requireRole("admin"),
    async (req, res) => {
      const page = Math.max(1, Number(req.query.page) || 1)
      const status = text(req.query.status)
      const q = text(req.query.q)

      const query = {}
      if (status) query.status = status
      if (q) {
        const regex = new RegExp(escapeRegex(q), "i")
        query.$or = [{ name: regex }, { category: regex }, { description: regex }]
      }

      const [items, total] = await Promise.all([
        menuItemsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * PAGE_SIZE)
          .limit(PAGE_SIZE)
          .toArray(),
        menuItemsCollection.countDocuments(query),
      ])

      const vendorIds = [...new Set(items.map((item) => item.vendorId))]
      const userObjectIds = vendorIds
        .map((id) => objectId(id))
        .filter(Boolean)
      const [vendors, users] =
        vendorIds.length > 0
          ? await Promise.all([
              vendorsCollection.find({ userId: { $in: vendorIds } }).toArray(),
              usersCollection
                .find({ _id: { $in: userObjectIds } })
                .project({ email: 1 })
                .toArray(),
            ])
          : [[], []]

      const vendorsById = new Map(vendors.map((vendor) => [vendor.userId, vendor]))
      const emailsById = new Map(users.map((user) => [user._id.toString(), user.email]))

      return res.json({
        items: items.map((item) => adminMenuItemView(item, vendorsById, emailsById)),
        total,
        page,
        pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      })
    }
  )

  // — PATCH /api/admin/menu/:id/status —
  app.patch(
    "/api/admin/menu/:id/status",
    verifyToken,
    requireRole("admin"),
    async (req, res) => {
      const itemId = objectId(req.params.id)
      if (!itemId) {
        return res.status(404).json({ error: "Menu item not found." })
      }

      const status = req.body?.status
      if (!MENU_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status." })
      }

      const result = await menuItemsCollection.updateOne(
        { _id: itemId },
        {
          $set: {
            status,
            rejectionReason:
              status === "rejected"
                ? text(req.body?.reason) || "Rejected by an administrator"
                : null,
            updatedAt: new Date(),
          },
        }
      )

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: "Menu item not found." })
      }

      return res.json({ ok: true, message: `Item marked as ${status}.` })
    }
  )

  // — DELETE /api/admin/menu/:id —
  app.delete(
    "/api/admin/menu/:id",
    verifyToken,
    requireRole("admin"),
    async (req, res) => {
      const itemId = objectId(req.params.id)
      if (!itemId) {
        return res.status(404).json({ error: "Menu item not found." })
      }

      const result = await menuItemsCollection.deleteOne({ _id: itemId })
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: "Menu item not found." })
      }

      return res.json({ ok: true, message: "Menu item deleted." })
    }
  )
}
