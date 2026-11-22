import express from "express"
import cors from "cors"
import { MongoClient, ObjectId } from "mongodb"
import "dotenv/config"

import { registerOrdersRoutes } from "./src/routes/orders.js"

const app = express()
const port = Number(process.env.PORT) || 5000
const mongoUri =
  process.env.MONGODB_URI ||
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.8evmyeo.mongodb.net/`

if (!process.env.MONGODB_URI && (!process.env.DB_USER || !process.env.DB_PASSWORD)) {
  console.error("MONGODB_URI (or DB_USER + DB_PASSWORD) is missing. Add it to .env.")
  process.exit(1)
}

app.use(express.json())
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || "http://localhost:3000",
  credentials: true,
}))

const PAGE_SIZE = 12
const CATEGORIES = ["Pizza", "Sides", "Drinks", "Desserts"]
const ACTIVE = { status: "approved", isActive: true }

let db
try {
  const client = new MongoClient(mongoUri)
  await client.connect()
  db = client.db("pizzahub")
  await db.command({ ping: 1 })
  console.log("Connected to MongoDB (pizzahub).")
} catch (error) {
  console.error("MongoDB connection failed:", error.message)
  process.exit(1)
}

app.locals.db = db
registerOrdersRoutes(app)

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined)

const objectId = (v) =>
  typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v)
    ? new ObjectId(v)
    : null

const escapeRegex = (v) =>
  v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const isPremium = (v) =>
  v?.plan === "premium" && new Date(v.planExpiresAt ?? 0).getTime() > Date.now()

const publicItem = (item, vendor) => ({
  id: item._id.toString(), vendorId: item.vendorId, name: item.name,
  category: item.category, description: item.description, price: item.price,
  area: item.area, city: item.city, imageUrl: item.imageUrl,
  vendorName: vendor.restaurantName, vendorCuisine: vendor.cuisine,
  premium: isPremium(vendor),
})

/** Vendors allowed to appear publicly: profile exists and account is not banned. */
async function activeVendors(ids) {
  const [vendors, banned] = await Promise.all([
    db.collection("vendors").find({ userId: { $in: ids } }).toArray(),
    db.collection("user").find({ _id: { $in: ids }, banned: true }).toArray(),
  ])
  const bannedIds = new Set(banned.map((u) => u._id.toString()))
  return new Map(
    vendors
      .filter((v) => !bannedIds.has(v.userId.toString()))
      .map((v) => [v.userId.toString(), v])
  )
}

async function listMenu({ q, category, area, city, page }) {
  const query = { ...ACTIVE }
  if (category) query.category = category
  if (area) query.area = area
  if (city) query.city = city
  if (q) {
    const regex = new RegExp(escapeRegex(q), "i")
    query.$or = [{ name: regex }, { description: regex }, { category: regex }]
  }

  const items = await db.collection("menuItems").find(query).sort({ createdAt: -1 }).toArray()
  const vendors = await activeVendors([...new Set(items.map((i) => i.vendorId))])
  const visible = items
    .filter((i) => vendors.has(i.vendorId.toString()))
    .map((i) => publicItem(i, vendors.get(i.vendorId.toString())))
    .sort((a, b) => Number(b.premium) - Number(a.premium))

  const total = visible.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), pageCount)
  const start = (currentPage - 1) * PAGE_SIZE
  return { items: visible.slice(start, start + PAGE_SIZE), total, page: currentPage, pageCount }
}

async function findMenuItem(id) {
  const itemId = objectId(id)
  if (!itemId) return null

  const item = await db.collection("menuItems").findOne({ _id: itemId, ...ACTIVE })
  if (!item) return null

  const vendor = (await activeVendors([item.vendorId])).get(item.vendorId.toString())
  if (!vendor) return null

  return {
    ...publicItem(item, vendor),
    vendor: {
      id: vendor.userId, name: vendor.restaurantName, description: vendor.description,
      cuisine: vendor.cuisine, phone: vendor.phone, address: vendor.address,
      area: vendor.area, city: vendor.city, logoUrl: vendor.logoUrl,
      premium: isPremium(vendor),
    },
  }
}

async function filterOptions() {
  const [areas, cities] = await Promise.all([
    db.collection("menuItems").distinct("area", ACTIVE),
    db.collection("menuItems").distinct("city", ACTIVE),
  ])
  return {
    categories: CATEGORIES,
    areas: areas.filter(Boolean).sort(),
    cities: cities.filter(Boolean).sort(),
  }
}

// Handlers stay on the happy path; errors go to one middleware.
const route = (fn) => async (req, res, next) => {
  try {
    await fn(req, res)
  } catch (error) {
    next(error)
  }
}

app.get("/", (_req, res) => res.json({ name: "pizzarush-server", status: "ok" }))

app.get("/health", async (_req, res) => {
  try {
    await db.command({ ping: 1 })
    res.json({ ok: true, db: "connected" })
  } catch {
    res.status(503).json({ ok: false, db: "unavailable" })
  }
})

app.get("/api/menu", route(async (req, res) => {
  res.json(await listMenu({
    q: text(req.query.q), category: text(req.query.category),
    area: text(req.query.area), city: text(req.query.city),
    page: Number.parseInt(req.query.page, 10) || 1,
  }))
}))

// Above "/api/menu/:id" so "filters" is not treated as an item id.
app.get("/api/menu/filters", route(async (_req, res) => res.json(await filterOptions())))

app.get("/api/menu/:id", route(async (req, res) => {
  const item = await findMenuItem(req.params.id)
  if (!item) return res.status(404).json({ error: "Menu item not found" })
  res.json(item)
}))

// Disabled unless ADMIN_API_KEY is set, then requires an x-admin-key header.
app.get("/users", route(async (req, res) => {
  const key = process.env.ADMIN_API_KEY
  if (!key) return res.status(404).json({ error: "Not found" })
  if (req.get("x-admin-key") !== key) return res.status(401).json({ error: "Unauthorized" })

  res.json(await db.collection("user")
    .find({}, { projection: { email: 1, name: 1, role: 1, banned: 1 } })
    .toArray())
}))

app.use((_req, res) => res.status(404).json({ error: "Not found" }))
app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ error: "Internal server error" })
})

app.listen(port, () => console.log(`pizzarush-server listening on http://localhost:${port}`))
