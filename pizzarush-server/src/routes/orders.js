import { attachUser, requireRole } from "../middleware/auth.js"
import {
  CURRENCY,
  objectId,
  text,
  deliveryDateError,
} from "../util.js"

export function registerOrdersRoutes(app) {
  const db = app.locals.db
  const ordersCollection = db.collection("orders")
  const menuItemsCollection = db.collection("menuItems")
  const vendorsCollection = db.collection("vendors")
  const usersCollection = db.collection("user")

  /** Same shape the frontend's `toOrderView` produces. */
  const orderView = (order) => ({
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
    amount: order.amount,
    currency: order.currency,
    paymentStatus: order.paymentStatus,
    paymentReference: order.paymentReference ?? null,
    deliveryDate: order.deliveryDate,
    deliveryAddress: order.deliveryAddress,
    customerMessage: order.customerMessage,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  })

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
    attachUser,
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
}
