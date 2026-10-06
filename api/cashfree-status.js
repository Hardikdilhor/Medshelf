module.exports = async function(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
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

    const orderId = String(req.query.order_id || '').trim();

    if (!orderId) {
      return res.status(400).json({
        error: 'Missing order_id.'
      });
    }

    const response = await fetch(
      'https://sandbox.cashfree.com/pg/orders/' +
        encodeURIComponent(orderId) +
        '/payments',
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

    const payments = await response.json().catch(() => []);

    if (!response.ok) {
      console.error('Cashfree status error:', payments);

      return res.status(response.status).json({
        error: 'Unable to check Cashfree payment status.'
      });
    }

    const list = Array.isArray(payments) ? payments : [];

    let status = 'FAILURE';

    if (list.some(p => p.payment_status === 'SUCCESS')) {
      status = 'SUCCESS';
    } else if (list.some(p => p.payment_status === 'PENDING')) {
      status = 'PENDING';
    }

    return res.status(200).json({
      success: true,
      order_id: orderId,
      payment_status: status,
      payments: list
    });

  } catch (error) {
    console.error('Cashfree status error:', error);

    return res.status(500).json({
      error: 'Unable to check Cashfree payment status.'
    });
  }
};
