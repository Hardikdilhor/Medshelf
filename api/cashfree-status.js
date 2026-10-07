function cors(res) {
  const origin = process.env.FRONTEND_ORIGIN || 'https://hardikdilhor.github.io';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed.'
    });
  }

  try {
    const clientId = process.env.CASHFREE_CLIENT_ID;
    const clientSecret = process.env.CASHFREE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        error: 'Cashfree credentials are not configured.'
      });
    }

    const orderId = String(
      (req.query && (req.query.order_id || req.query.orderId)) || ''
    ).trim();

    if (!orderId) {
      return res.status(400).json({
        error: 'Missing order_id.'
      });
    }

    const base =
      process.env.CASHFREE_ENV === 'sandbox'
        ? 'https://sandbox.cashfree.com/pg'
        : 'https://api.cashfree.com/pg';

    const response = await fetch(
      base + '/orders/' + encodeURIComponent(orderId),
      {
        method: 'GET',
        headers: {
          'x-client-id': clientId,
          'x-client-secret': clientSecret,
          'x-api-version': '2025-01-01',
          'Accept': 'application/json'
        }
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('Cashfree status error:', data);

      return res.status(response.status).json({
        error:
          data.message ||
          'Unable to verify Cashfree payment.'
      });
    }

    return res.status(200).json({
      success: true,
      order_id: data.order_id,
      order_status: data.order_status,
      order_amount: data.order_amount,
      order_currency: data.order_currency,
      payment_session_id: data.payment_session_id
    });

  } catch (error) {
    console.error('Cashfree status error:', error);

    return res.status(500).json({
      error: 'Unable to verify Cashfree payment.'
    });
  }
};
