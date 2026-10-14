// Validate the agreed participation fee separately from Stripe-calculated tax.
function paymentAmounts(session, row) {
  if (!session.livemode && !session.total_details) {
    return session.amount_total === row.amount_cents
      ? { subtotal: null, discount: null, tax: 0, total: session.amount_total, currency: session.currency }
      : null;
  }
  const subtotal = session.amount_subtotal;
  const { amount_discount: discount, amount_tax: tax, amount_shipping: shipping } = session.total_details || {};
  const total = session.amount_total;
  const expectedSubtotal = row.offer === 'strategic' ? 180000 : 120000;
  const expectedDiscount = expectedSubtotal - row.amount_cents;
  if (![subtotal, discount, tax, shipping, total].every(value => Number.isSafeInteger(value) && value >= 0) ||
      subtotal !== expectedSubtotal || discount !== expectedDiscount || shipping !== 0 ||
      total !== row.amount_cents + tax ||
      (row.offer === 'strategic' && total !== 0) ||
      (session.livemode && (!session.automatic_tax?.enabled || session.automatic_tax.status !== 'complete'))) return null;
  return { subtotal, discount, tax, total, currency: session.currency };
}
function settledPayment(session, free) {
  return free
    ? session.amount_total === 0 && !session.payment_intent && ['paid', 'no_payment_required'].includes(session.payment_status)
    : session.payment_status === 'paid' && Boolean(session.payment_intent);
}
module.exports = { paymentAmounts, settledPayment };
