const RESEND_API_URL = "https://api.resend.com/emails"

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]
  )
}

/**
 * Optional Resend notification. Without RESEND_API_KEY the API keeps working
 * and only logs a warning — the same behaviour as the Next.js email helper.
 */
export async function sendOrderStatusEmail({
  to,
  customerName,
  orderId,
  itemName,
  status,
}) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn("RESEND_API_KEY is not set; order status email was skipped.")
    return false
  }
  if (!to) return false

  const accepted = status === "accepted"
  const subject = accepted
    ? "Your Pizzarush order was accepted"
    : "Your Pizzarush order was rejected"
  const message = accepted
    ? `Good news, ${customerName}! The restaurant accepted your order for ${itemName}.`
    : `Sorry, ${customerName}. The restaurant could not accept your order for ${itemName}.`
  const safeMessage = escapeHtml(message)

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Pizzarush <onboarding@resend.dev>",
        to: [to],
        subject,
        text: `${message}\n\nOrder reference: ${orderId}`,
        html: `<p>${safeMessage}</p><p>Order reference: <strong>${orderId}</strong></p>`,
      }),
    })

    if (!response.ok) {
      console.error("Resend rejected the order status email", response.status)
      return false
    }
    return true
  } catch (error) {
    console.error("Failed to send order status email", error)
    return false
  }
}
