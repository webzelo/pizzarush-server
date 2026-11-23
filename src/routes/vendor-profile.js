import { requireRole, verifyToken } from "../middleware/auth.js"
import { IMAGE_HOSTS, text } from "../util.js"

/** Vendor id is the user id in every vendor route. */
const vendorIdOf = (req) => String(req.user.id ?? req.user._id)

const bounded = (v, min, max) => {
  const s = text(v)
  return s && s.length >= min && s.length <= max ? s : undefined
}

/** Port of lib/actions/vendor-profile.ts saveVendorProfile validation. */
function validateVendorProfileBody(body) {
  const restaurantName = bounded(body.restaurantName, 2, 80)
  if (!restaurantName) return "Restaurant name must be 2–80 characters."

  const description = bounded(body.description, 10, 1000)
  if (!description) return "Description must be 10–1000 characters."

  const cuisine = bounded(body.cuisine, 2, 60)
  if (!cuisine) return "Cuisine must be 2–60 characters."

  const phone = bounded(body.phone, 6, 30)
  if (!phone) return "Enter a valid phone number."

  const address = bounded(body.address, 5, 200)
  if (!address) return "Address must be 5–200 characters."

  const area = bounded(body.area, 1, 80)
  if (!area) return "Area is required."

  const city = bounded(body.city, 1, 80)
  if (!city) return "City is required."

  const logoUrl = optionalImageUrl(body.logoUrl)
  if (logoUrl) return logoUrl
  const coverUrl = optionalImageUrl(body.coverUrl)
  if (coverUrl) return coverUrl

  return {
    restaurantName,
    description,
    cuisine,
    phone,
    address,
    area,
    city,
    logoUrl: logoUrl ?? "",
    coverUrl: coverUrl ?? "",
  }
}

/**
 * Port of the optionalImageUrl part of lib/validation.ts: "" or an uploaded
 * image from IMAGE_HOSTS, or the error message.
 */
function optionalImageUrl(value) {
  const v = text(value)
  if (!v) return ""
  try {
    const url = new URL(v)
    if (!IMAGE_HOSTS.includes(url.hostname)) {
      return "Image must be uploaded through the app."
    }
  } catch {
    return "Upload an image before saving."
  }
  return v
}

/** Port of lib/collections.ts VendorDoc, public view. */
const vendorView = (vendor) => ({
  id: vendor._id.toString(),
  userId: vendor.userId,
  restaurantName: vendor.restaurantName,
  description: vendor.description,
  cuisine: vendor.cuisine,
  phone: vendor.phone,
  address: vendor.address,
  area: vendor.area,
  city: vendor.city,
  logoUrl: vendor.logoUrl ?? "",
  coverUrl: vendor.coverUrl ?? "",
  plan: vendor.plan,
  planExpiresAt: vendor.planExpiresAt ?? null,
  createdAt: vendor.createdAt,
  updatedAt: vendor.updatedAt,
})

export function registerVendorProfileRoutes(app) {
  const vendorsCollection = app.locals.db.collection("vendors")

  // — GET /api/vendor/profile —
  app.get(
    "/api/vendor/profile",
    verifyToken,
    requireRole("vendor"),
    async (req, res) => {
      const vendor = await vendorsCollection.findOne({
        userId: vendorIdOf(req),
      })
      return res.json({ vendor: vendor ? vendorView(vendor) : null })
    }
  )

  // — PUT /api/vendor/profile —
  app.put(
    "/api/vendor/profile",
    verifyToken,
    requireRole("vendor"),
    async (req, res) => {
      const userId = vendorIdOf(req)

      const parsed = validateVendorProfileBody(req.body ?? {})
      if (typeof parsed === "string") {
        return res.status(400).json({ error: parsed })
      }

      const now = new Date()
      await vendorsCollection.updateOne(
        { userId },
        {
          $set: { ...parsed, updatedAt: now },
          $setOnInsert: {
            userId,
            plan: "free",
            planExpiresAt: null,
            createdAt: now,
          },
        },
        { upsert: true }
      )

      return res.json({ ok: true, message: "Profile saved." })
    }
  )
}
