import { requireRole, verifyToken } from "../middleware/auth.js"
import {
  CURRENCY,
  objectId,
  text,
  deliveryDateError,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
} from "../util.js"

/** Same shape the frontend's `toOrderView` produces. */
export const orderView = (order) => ({
  id: order._id.toString(),
  customerId: order.customerId,
  customerName: order.customerName,
  customerEmail: order.customerEmail,
  vendorId: order.vendorId,
  vendorName: order.vendorName,
  menuItemId: order.menuItemId,
  itemName: order.itemName,
  itemImageUrl: order.itemImageUrl,
  itemPrice: order.itemPrice,
  quantity: order.quantity,
  total: order.itemPrice * order.quantity,
  // Fallbacks for rows created before the backend stored payment fields.
  amount: order.amount ?? order.itemPrice * order.quantity,
  currency: order.currency ?? CURRENCY,
  paymentStatus: order.paymentStatus ?? "pending",
  paymentReference: order.paymentReference ?? null,
  deliveryDate: order.deliveryDate,
  deliveryAddress: order.deliveryAddress,
  customerMessage: order.customerMessage,
  status: order.status,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
})

export function registerOrdersRoutes(app) {
  const db = app.locals.db
  const ordersCollection = db.collection("orders")
  const menuItemsCollection = db.collection("menuItems")
  const vendorsCollection = db.collection("vendors")
  const usersCollection = db.collection("user")

  /**
   * Validate the POST /api/orders body against the frontend's
   * `orderInputSchema` rules: `menuItemId` (required), `quantity` (1–20),
   * `deliveryDate` ("YYYY-MM-DD", today or later), `deliveryAddress`
   * (10–300 chars), `customerMessage` (≤ 500 chars, optional).
   * Returns the message of the first failure, or null when valid.
   */
  function validatePlaceOrderBody(body) {
    if (!objectId(body.menuItemId)) {
      return "Menu item not found."
    }

    if (
      !Number.isInteger(body.quantity) ||
      body.quantity < 1 ||
      body.quantity > 20
    ) {
      return "Quantity must be between 1 and 20."
    }

    const dateError = deliveryDateError(body.deliveryDate)
    if (dateError) return dateError

    const address = text(body.deliveryAddress)
    if (!address || address.length < 10 || address.length > 300) {
      return "Delivery address must be 10–300 characters."
    }

    if (body.customerMessage !== undefined) {
      const message = String(body.customerMessage).trim()
      if (message.length > 500) {
        return "Message must be 500 characters or less."
      }
    }

    return null
  }

  /**
   * Check the dish and vendor are available, mirroring the frontend's
   * `placeOrder` checks: approved + active item, active + unbanned vendor.
   * Returns `{ error }` or `{ item, vendor }` once both pass.
   */
  async function checkPlaceOrderAvailability(body) {
    const itemId = objectId(body.menuItemId)
    const item = await menuItemsCollection.findOne({
      _id: itemId,
      status: "approved",
      isActive: true,
    })
    if (!item) return { error: "This item is no longer available." }

    const [vendor, vendorUser] = await Promise.all([
      vendorsCollection.findOne({ userId: item.vendorId }),
      usersCollection.findOne({ _id: item.vendorId, banned: true }),
    ])
    if (!vendor || vendorUser) return { error: "This vendor is not available." }

    return { item, vendor }
  }

  app.post(
    "/api/orders",
    verifyToken,
    requireRole("customer"),
    async (req, res) => {
      const body = req.body ?? {}

      const bodyError = validatePlaceOrderBody(body)
      if (bodyError) {
        return res.status(400).json({ error: bodyError })
      }

      const availability = await checkPlaceOrderAvailability(body)
      if (availability.error) {
        return res.status(409).json({ error: availability.error })
      }
      const { item, vendor } = availability

      const user = req.user
      const userId = String(user.id ?? user._id)
      const quantity = body.quantity
      const address = text(body.deliveryAddress)
      const message = String(body.customerMessage ?? "").trim()

      const now = new Date()
      const { insertedId } = await ordersCollection.insertOne({
        customerId: userId,
        customerName: user.name,
        customerEmail: user.email,
        vendorId: item.vendorId,
        vendorName: vendor.restaurantName,
        menuItemId: objectId(body.menuItemId).toString(),
        itemName: item.name,
        itemImageUrl: item.imageUrl,
        itemPrice: item.price,
        quantity,
        amount: item.price * quantity,
        currency: CURRENCY,
        paymentStatus: "pending",
        paymentReference: null,
        deliveryDate: body.deliveryDate,
        deliveryAddress: address,
        customerMessage: message,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })

      const order = await ordersCollection.findOne({ _id: insertedId })
      return res.status(201).json(orderView(order))
    }
  )

  /**
   * PATCH /api/orders/:id — save/update updatable order info + payment info.
   *
   * - Customer (owner): deliveryDate / deliveryAddress / customerMessage,
   *   only while the order is still "pending".
   * - Vendor (owner): paymentStatus / paymentReference.
   * - Admin (any): everything, including status.
   */
  app.patch("/api/orders/:id", verifyToken, async (req, res) => {
    const orderId = objectId(req.params.id)
    if (!orderId) {
      return res.status(404).json({ error: "Order not found." })
    }

    const user = req.user
    if (!user) {
      return res.status(401).json({ error: "Authentication required" })
    }

    const order = await ordersCollection.findOne({ _id: orderId })
    if (!order) {
      return res.status(404).json({ error: "Order not found." })
    }

    const userId = String(user.id ?? user._id)
    const isOwner =
      user.role === "customer"
        ? String(order.customerId) === userId
        : user.role === "vendor"
          ? String(order.vendorId) === userId
          : false
    if (!isOwner && user.role !== "admin") {
      return res.status(404).json({ error: "Order not found." })
    }

    const roleUpdatable =
      user.role === "admin"
        ? ["status", "deliveryDate", "deliveryAddress", "customerMessage", "paymentStatus", "paymentReference"]
        : user.role === "vendor"
          ? ["paymentStatus", "paymentReference"]
          : ["deliveryDate", "deliveryAddress", "customerMessage"]

    const body = req.body ?? {}
    const patch = {}

    // — Delivery info —
    if (roleUpdatable.includes("deliveryDate") && body.deliveryDate !== undefined) {
      const dateError = deliveryDateError(body.deliveryDate)
      if (dateError) {
        return res.status(400).json({ error: dateError })
      }
      patch.deliveryDate = body.deliveryDate
    }

    if (roleUpdatable.includes("deliveryAddress") && body.deliveryAddress !== undefined) {
      const address = text(body.deliveryAddress)
      if (!address || address.length < 10 || address.length > 300) {
        return res.status(400).json({ error: "Delivery address must be 10–300 characters." })
      }
      patch.deliveryAddress = address
    }

    if (roleUpdatable.includes("customerMessage") && body.customerMessage !== undefined) {
      const message = String(body.customerMessage).trim()
      if (message.length > 500) {
        return res.status(400).json({ error: "Message must be 500 characters or less." })
      }
      patch.customerMessage = message
    }

    // — Payment info —
    if (roleUpdatable.includes("paymentStatus") && body.paymentStatus !== undefined) {
      if (!PAYMENT_STATUSES.includes(body.paymentStatus)) {
        return res.status(400).json({ error: "Invalid payment status." })
      }
      patch.paymentStatus = body.paymentStatus
    }

    if (roleUpdatable.includes("paymentReference") && body.paymentReference !== undefined) {
      const reference = text(body.paymentReference)
      if (reference && reference.length > 200) {
        return res.status(400).json({ error: "Payment reference is too long." })
      }
      patch.paymentReference = reference ?? null
    }

    // — Status (admin) —
    if (roleUpdatable.includes("status") && body.status !== undefined) {
      if (!ORDER_STATUSES.includes(body.status)) {
        return res.status(400).json({ error: "Invalid order status." })
      }
      patch.status = body.status
    }

    // — Customers: cancel their own order while it is still pending —
    if (user.role === "customer") {
      if (body.status !== undefined) {
        if (body.status !== "cancelled") {
          return res.status(400).json({ error: "Only your own pending orders can be cancelled." })
        }
        if (order.status !== "pending") {
          return res.status(409).json({ error: "Only pending orders can be updated." })
        }
        patch.status = "cancelled"
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "Nothing to update." })
    }

    // Customers can only update while the order is still pending.
    if (user.role === "customer" && order.status !== "pending") {
      return res.status(409).json({ error: "Only pending orders can be updated." })
    }

    patch.updatedAt = new Date()
    const result = await ordersCollection.updateOne({ _id: orderId }, { $set: patch })
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Order not found." })
    }

    const updated = await ordersCollection.findOne({ _id: orderId })
    return res.json(orderView(updated))
  })
}
