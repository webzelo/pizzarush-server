import { ObjectId } from "mongodb"

export const CURRENCY = "USD"

const OBJECT_ID = /^[0-9a-fA-F]{24}$/

/** Strict 24-hex ids, same rule as the menu API. */
export function objectId(value) {
  return typeof value === "string" && OBJECT_ID.test(value)
    ? new ObjectId(value)
    : null
}

/** Trim a string; return undefined when it has no content. */
export function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function todayInputValue() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

/** Delivery date regex + "today or later", mirroring the frontend schema. */
export function deliveryDateError(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "Choose a delivery date."
  }
  return value < todayInputValue()
    ? "Delivery date must be today or later."
    : null
}

export const ORDER_STATUSES = ["pending", "accepted", "rejected", "cancelled"]
export const PAYMENT_STATUSES = ["paid", "pending", "failed"]
export const MENU_PAGE_SIZE = 12
export const FREE_ACTIVE_ITEM_LIMIT = 3
export const CATEGORIES = ["Pizza", "Sides", "Drinks", "Desserts"]
export const IMAGE_HOSTS = ["i.ibb.co", "ibb.co"]
export const PREMIUM_PRICE = 9.99
export const PREMIUM_DURATION_DAYS = 30
