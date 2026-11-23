import { requireRole, verifyToken } from "../middleware/auth.js"
import {
  PAGE_SIZE,
  escapeRegex,
  formatCurrency,
  text,
} from "../util.js"

export function registerAdminTransactionsRoutes(app) {
  const transactionsCollection = app.locals.db.collection("transactions")

  /** Port of TransactionView. */
  function transactionView(transaction) {
    return {
      id: transaction._id.toString(),
      vendorId: transaction.vendorId,
      vendorName: transaction.vendorName,
      vendorEmail: transaction.vendorEmail,
      plan: transaction.plan,
      amount: formatCurrency(transaction.amount),
      paymentStatus: transaction.paymentStatus,
      reference: transaction.reference,
      createdAt: transaction.createdAt,
    }
  }

  // — GET /api/admin/transactions —
  app.get(
    "/api/admin/transactions",
    verifyToken,
    requireRole("admin"),
    async (req, res) => {
      const page = Math.max(1, Number(req.query.page) || 1)
      const status = text(req.query.status)
      const q = text(req.query.q)

      const query = {}
      if (status) query.paymentStatus = status
      if (q) {
        const regex = new RegExp(escapeRegex(q), "i")
        query.$or = [
          { vendorName: regex },
          { vendorEmail: regex },
          { reference: regex },
          { checkoutSessionId: regex },
          { paymentIntentId: regex },
        ]
      }

      const [transactions, total] = await Promise.all([
        transactionsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * PAGE_SIZE)
          .limit(PAGE_SIZE)
          .toArray(),
        transactionsCollection.countDocuments(query),
      ])

      return res.json({
        transactions: transactions.map(transactionView),
        total,
        page,
        pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      })
    }
  )
}
