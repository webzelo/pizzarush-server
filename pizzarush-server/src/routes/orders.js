import { requireRole } from "../middleware/auth.js"

export function registerOrdersRoutes(app) {
  const db = app.locals.db
  const ordersCollection = db.collection("orders")

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
}
