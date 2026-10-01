const {json,requireEnv,hmac,safeEqual,razorpay,supabase,sendConfirmationEmail}=require('./_common');

module.exports=async function(req,res){
  if(req.method==='OPTIONS') return json(res,204,{});
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
  try{
    requireEnv();
    const b=req.body||{};
    const orderNumber=String(b.orderNumber||'').trim();
    const orderId=String(b.razorpay_order_id||'').trim();
    const paymentId=String(b.razorpay_payment_id||'').trim();
    const signature=String(b.razorpay_signature||'').trim();
    if(!orderNumber||!orderId||!paymentId||!signature)
      return json(res,400,{verified:false,error:'Missing payment verification fields.'});

    const dbRows=await supabase('orders?order_number=eq.'+encodeURIComponent(orderNumber)+'&select=*&limit=1');
    const dbOrder=Array.isArray(dbRows)?dbRows[0]:null;
    if(!dbOrder) return json(res,404,{verified:false,error:'Order not found.'});
    if(dbOrder.gateway_order_id!==orderId)
      return json(res,400,{verified:false,error:'Payment/order reference mismatch.'});
    if(dbOrder.payment_status==='paid')
      return json(res,200,{verified:true,orderNumber,paymentId:dbOrder.gateway_payment_id||paymentId});

    const expected=hmac(orderId+'|'+paymentId,process.env.RAZORPAY_KEY_SECRET);
    if(!safeEqual(expected,signature))
      return json(res,400,{verified:false,error:'Invalid payment signature.'});

    const order=await razorpay('/orders/'+encodeURIComponent(orderId));
    const payment=await razorpay('/payments/'+encodeURIComponent(paymentId));

    if(order.receipt!==orderNumber || order.currency!=='INR' || payment.currency!=='INR' ||
       payment.order_id!==orderId || Number(payment.amount)!==Number(order.amount) ||
       Number(order.amount)!==Number(dbOrder.amount) || payment.status!=='captured')
      return json(res,400,{verified:false,error:'Payment verification checks failed.'});

    const updated=await supabase('orders?order_number=eq.'+encodeURIComponent(orderNumber)+'&payment_status=neq.paid',{
      method:'PATCH',headers:dbHeaders('return=representation'),
      body:JSON.stringify({
        gateway_payment_id:paymentId,gateway_signature:signature,
        payment_status:'paid',order_status:'confirmed',paid_at:new Date().toISOString()
      })
    });
    const saved=Array.isArray(updated)?updated[0]:updated;
    if(saved){
      try{
        const emailSent=await sendConfirmationEmail(saved);
        if(emailSent) await supabase('orders?id=eq.'+encodeURIComponent(saved.id),{
          method:'PATCH',headers:dbHeaders('return=minimal'),
          body:JSON.stringify({confirmation_email_sent_at:new Date().toISOString()})
        });
      }catch(emailErr){ console.error('email:',emailErr); }
    }
    return json(res,200,{verified:true,orderNumber,paymentId});
  }catch(err){
    console.error(err);
    return json(res,500,{verified:false,error:err.message||'Unable to verify payment.'});
  }
};
