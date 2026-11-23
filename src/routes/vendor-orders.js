import { requireRole, verifyToken } from "../middleware/auth.js"
import { objectId } from "../util.js"
import { orderView } from "./orders.js"

const PAGE_SIZE = 8

/** Vendor id is the user id in every vendor route. */
const vendorIdOf = (req) => String(req.user.id ?? req.user._id)

export function registerVendorOrdersRoutes(app) {
  const db = app.locals.db
  const ordersCollection = db.collection("orders")

  // — GET /api/vendor/orders —
  app.get(
    "/api/vendor/orders",
    verifyToken,
    requireRole("vendor"),
    async (req, res) => {
      const vendorId = vendorIdOf(req)
      const page = Math.max(1, Number(req.query.page) || 1)
      const status = typeof req.query.status === "string" ? req.query.status : undefined
      const query = status ? { vendorId, status } : { vendorId }

      const [orders, total] = await Promise.all([
        ordersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * PAGE_SIZE)
          .limit(PAGE_SIZE)
          .toArray(),
        ordersCollection.countDocuments(query),
      ])

      return res.json({
        orders: orders.map(orderView),
        total,
        page,
        pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      })
    }
  )

  // — PATCH /api/vendor/orders/:id/status —
  app.patch(
    "/api/vendor/orders/:id/status",
    verifyToken,
    requireRole("vendor"),
    async (req, res) => {
      const vendorId = vendorIdOf(req)
      const orderId = objectId(req.params.id)
      if (!orderId) {
        return res.status(404).json({ error: "Order not found." })
      }

      const status = req.body?.status
      const result = await ordersCollection.updateOne(
        { _id: orderId, vendorId, status: "pending" },
        { $set: { status, updatedAt: new Date() } }
      )

      if (result.matchedCount === 0) {
        return res
          .status(404)
          .json({
            error:
              "This order is no longer pending or does not belong to your restaurant.",
          })
      }

      return res.json({
        ok: true,
        message: status === "accepted" ? "Order accepted." : "Order rejected.",
      })
    }
  )
}
