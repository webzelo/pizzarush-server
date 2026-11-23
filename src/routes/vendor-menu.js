import { ObjectId } from "mongodb"

import { requireRole, verifyToken } from "../middleware/auth.js"
import {
  CATEGORIES,
  FREE_ACTIVE_ITEM_LIMIT,
  IMAGE_HOSTS,
  MENU_PAGE_SIZE,
  objectId,
  text,
} from "../util.js"

/** Vendor id is the user id in every vendor route. */
const vendorIdOf = (req) => String(req.user.id ?? req.user._id)

/** Port of lib/plans.ts isPremiumActive. */
function isPremiumActive(vendor) {
  return (
    vendor &&
    vendor.plan === "premium" &&
    vendor.planExpiresAt &&
    new Date(vendor.planExpiresAt).getTime() > Date.now()
  )
}

const bounded = (v, min, max) => {
  const s = text(v)
  return s && s.length >= min && s.length <= max ? s : undefined
}

function limitMessage() {
  return `The Free plan allows ${FREE_ACTIVE_ITEM_LIMIT} active menu items. Upgrade to Premium for unlimited items.`
}

export function registerVendorMenuRoutes(app) {
  const db = app.locals.db
  const menuItemsCollection = db.collection("menuItems")
  const vendorsCollection = db.collection("vendors")

  /** Port of lib/data/menu.ts toMenuItemView. */
  const toMenuItemView = (item) => ({
    id: item._id.toString(),
    vendorId: item.vendorId,
    name: item.name,
    category: item.category,
    description: item.description,
    price: item.price,
    area: item.area,
    city: item.city,
    imageUrl: item.imageUrl,
    status: item.status,
    isActive: item.isActive,
    rejectionReason: item.rejectionReason,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  })

  /** Port of lib/data/menu.ts activeItemLimitFilter. */
  const activeItemLimitFilter = (vendorId, excludeId) => {
    const filter = { vendorId, isActive: true, status: { $ne: "rejected" } }
    if (excludeId) filter._id = { $ne: excludeId }
    return filter
  }

  async function countActiveItemsForLimit(vendorId, excludeId) {
    return menuItemsCollection.countDocuments(activeItemLimitFilter(vendorId, excludeId))
  }

  /** Port of vendor-menu.ts activeLimitReached. */
  async function activeLimitReached(vendorId, excludeItemId) {
    const vendor = await vendorsCollection.findOne({ userId: vendorId })
    if (isPremiumActive(vendor)) return false
    return (
      (await countActiveItemsForLimit(vendorId, excludeItemId)) >=
      FREE_ACTIVE_ITEM_LIMIT
    )
  }

  /** Port of lib/actions/vendor-menu.ts menuItemInputSchema. */
  function validateMenuItemBody(body) {
    const name = bounded(body.name, 2, 80)
    if (!name) return "Item name must be 2–80 characters."

    if (!CATEGORIES.includes(body.category)) return "Choose a category."

    const description = bounded(body.description, 10, 1000)
    if (!description) return "Description must be 10–1000 characters."

    const price = Number(body.price)
    if (!Number.isFinite(price) || price <= 0 || price > 10000) {
      return "Enter a valid price."
    }

    const area = bounded(body.area, 1, 80)
    if (!area) return "Area is required."

    const city = bounded(body.city, 1, 80)
    if (!city) return "City is required."

    const imageUrl = text(body.imageUrl)
    try {
      const url = new URL(imageUrl)
      if (!IMAGE_HOSTS.includes(url.hostname)) {
        return "Image must be uploaded through the app."
      }
    } catch {
      return "Upload an image before saving."
    }

    const isActive =
      body.isActive === undefined
        ? true
        : body.isActive === "false"
          ? false
          : body.isActive === true

    return {
      name,
      category: body.category,
      description,
      price,
      area,
      city,
      imageUrl,
      isActive,
    }
  }

  // — GET /api/vendor/menu —
  app.get(
    "/api/vendor/menu",
    verifyToken,
    requireRole("vendor"),
    async (req, res) => {
      const vendorId = vendorIdOf(req)
      const page = Math.max(1, Number(req.query.page) || 1)
      const status = text(req.query.status)

      const query = status ? { vendorId, status } : { vendorId }
      const [items, total] = await Promise.all([
        menuItemsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * MENU_PAGE_SIZE)
          .limit(MENU_PAGE_SIZE)
          .toArray(),
        menuItemsCollection.countDocuments(query),
      ])

      return res.json({
        items: items.map(toMenuItemView),
        total,
        page,
        pageCount: Math.max(1, Math.ceil(total / MENU_PAGE_SIZE)),
      })
    }
  )

  // — POST /api/vendor/menu —
  app.post(
    "/api/vendor/menu",
    verifyToken,
    requireRole("vendor"),
    async (req, res) => {
      const vendorId = vendorIdOf(req)

      const vendor = await vendorsCollection.findOne({ userId: vendorId })
      if (!vendor) {
        return res
          .status(400)
          .json({ error: "Create your restaurant profile before adding menu items." })
      }

      const parsed = validateMenuItemBody(req.body ?? {})
      if (typeof parsed === "string") {
        return res.status(400).json({ error: parsed })
      }

      if (parsed.isActive && (await activeLimitReached(vendorId))) {
        return res.status(400).json({ error: limitMessage() })
      }

      const now = new Date()
      await menuItemsCollection.insertOne({
        _id: new ObjectId(),
        vendorId,
        name: parsed.name,
        category: parsed.category,
        description: parsed.description,
        price: parsed.price,
        area: parsed.area,
        city: parsed.city,
        imageUrl: parsed.imageUrl,
        status: "pending",
        isActive: parsed.isActive,
        rejectionReason: null,
        createdAt: now,
        updatedAt: now,
      })

      return res.json({ ok: true, message: "Menu item created." })
    }
  )

  // — PATCH /api/vendor/menu/:id —
  app.patch(
    "/api/vendor/menu/:id",
    verifyToken,
    requireRole("vendor"),
    async (req, res) => {
      const vendorId = vendorIdOf(req)
      const menuItemId = objectId(req.params.id)
      if (!menuItemId) {
        return res.status(404).json({ error: "Menu item not found." })
      }

      const existing = await menuItemsCollection.findOne({
        _id: menuItemId,
        vendorId,
      })
      if (!existing) {
        return res.status(404).json({ error: "Menu item not found." })
      }

      const parsed = validateMenuItemBody(req.body ?? {})
      if (typeof parsed === "string") {
        return res.status(400).json({ error: parsed })
      }

      if (
        parsed.isActive &&
        !existing.isActive &&
        (await activeLimitReached(vendorId, menuItemId))
      ) {
        return res.status(400).json({ error: limitMessage() })
      }

      // Editing a rejected item sends it back for review.
      const status = existing.status === "rejected" ? "pending" : existing.status

      await menuItemsCollection.updateOne(
        { _id: menuItemId, vendorId },
        {
          $set: {
            name: parsed.name,
            category: parsed.category,
            description: parsed.description,
            price: parsed.price,
            area: parsed.area,
            city: parsed.city,
            imageUrl: parsed.imageUrl,
            isActive: parsed.isActive,
            status,
            rejectionReason: status === "pending" ? null : existing.rejectionReason,
            updatedAt: new Date(),
          },
        }
      )

      return res.json({ ok: true, message: "Menu item updated." })
    }
  )

  // — DELETE /api/vendor/menu/:id —
  app.delete(
    "/api/vendor/menu/:id",
    verifyToken,
    requireRole("vendor"),
    async (req, res) => {
      const vendorId = vendorIdOf(req)
      const menuItemId = objectId(req.params.id)
      if (!menuItemId) {
        return res.status(404).json({ error: "Menu item not found." })
      }

      const result = await menuItemsCollection.deleteOne({
        _id: menuItemId,
        vendorId,
      })
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: "Menu item not found." })
      }

      return res.json({ ok: true, message: "Menu item deleted." })
    }
  )

  // — PATCH /api/vendor/menu/:id/availability —
  app.patch(
    "/api/vendor/menu/:id/availability",
    verifyToken,
    requireRole("vendor"),
    async (req, res) => {
      const vendorId = vendorIdOf(req)
      const menuItemId = objectId(req.params.id)
      if (!menuItemId) {
        return res.status(404).json({ error: "Menu item not found." })
      }

      const item = await menuItemsCollection.findOne({
        _id: menuItemId,
        vendorId,
      })
      if (!item) {
        return res.status(404).json({ error: "Menu item not found." })
      }

      if (!item.isActive && (await activeLimitReached(vendorId, menuItemId))) {
        return res.status(400).json({ error: limitMessage() })
      }

      await menuItemsCollection.updateOne(
        { _id: menuItemId, vendorId },
        { $set: { isActive: !item.isActive, updatedAt: new Date() } }
      )

      return res.json({
        ok: true,
        message: item.isActive
          ? "Item is now hidden from customers."
          : "Item is now available to customers.",
      })
    }
  )
}
