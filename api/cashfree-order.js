const crypto = require('node:crypto');

module.exports = async function(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const clientId = process.env.CASHFREE_CLIENT_ID;
    const clientSecret = process.env.CASHFREE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        error: 'Cashfree credentials are not configured.'
      });
    }

    const body = req.body || {};
    const amount = Number(body.amount);
    const customer = body.customer || {};

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid payment amount.' });
    }

    if (!/^\d{10}$/.test(String(customer.phone || ''))) {
      return res.status(400).json({ error: 'Invalid phone number.' });
    }

    const orderId =
      'MS_' +
      Date.now().toString(36).toUpperCase() +
      '_' +
      crypto.randomBytes(4).toString('hex').toUpperCase();

    const response = await fetch(
      'https://sandbox.cashfree.com/pg/orders',
      {
        method: 'POST',
        headers: {
          'x-client-id': clientId,
          'x-client-secret': clientSecret,
          'x-api-version': '2025-01-01',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_id: orderId,
          order_amount: Number(amount.toFixed(2)),
          order_currency: 'INR',

          customer_details: {
            customer_id: 'medshelf_' + String(customer.phone),
            customer_name: String(customer.name || '').slice(0, 100),
            customer_email: String(customer.email || '').slice(0, 100),
            customer_phone: String(customer.phone)
          },

          order_meta: {
            return_url:
              'https://hardikdilhor.github.io/Medshelf/?cashfree_order_id={order_id}'
          },

          order_note: 'MedShelf MBBS books order'
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('Cashfree error:', data);

      return res.status(response.status).json({
        error: data.message || 'Cashfree could not create the order.'
      });
    }

    return res.status(200).json({
      success: true,
      order_id: data.order_id,
      payment_session_id: data.payment_session_id
    });

  } catch (error) {
    console.error('Cashfree order error:', error);

    return res.status(500).json({
      error: 'Unable to create Cashfree payment order.'
    });
  }
};
