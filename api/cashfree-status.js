const {json,requireEnv,supabase,dbHeaders,sendConfirmationEmail,sendAdminOrderAlert}=require('./_common');

async function getPayments(orderId){
  const base=process.env.CASHFREE_ENV==='sandbox'?'https://sandbox.cashfree.com/pg':'https://api.cashfree.com/pg';
  const r=await fetch(base+'/orders/'+encodeURIComponent(orderId)+'/payments',{
    headers:{'x-client-id':process.env.CASHFREE_CLIENT_ID,'x-client-secret':process.env.CASHFREE_CLIENT_SECRET,'x-api-version':'2025-01-01','Accept':'application/json'}
  });
  const data=await r.json().catch(()=>[]);
  if(!r.ok)throw new Error(data.message||'Unable to fetch Cashfree payment status.');
  return Array.isArray(data)?data:[];
}

async function syncPaid(orderId,payments){
  const success=payments.find(p=>String(p.payment_status).toUpperCase()==='SUCCESS');
  const rows=await supabase('orders?gateway_order_id=eq.'+encodeURIComponent(orderId)+'&select=*&limit=1');
  const order=Array.isArray(rows)?rows[0]:null;
  if(!order)return null;
  if(success){
    const updated=await supabase('orders?id=eq.'+encodeURIComponent(order.id),{
      method:'PATCH',headers:dbHeaders('return=representation'),
      body:JSON.stringify({
        gateway_payment_id:success.cf_payment_id||success.payment_id||null,
        payment_status:'paid',order_status:order.order_status==='delivered'?'delivered':'confirmed',
        paid_at:order.paid_at||new Date().toISOString()
      })
    });
    const saved=Array.isArray(updated)?updated[0]:updated;
    if(saved && !saved.confirmation_email_sent_at){
      try{
        const sent=await sendConfirmationEmail(saved);
        if(sent)await supabase('orders?id=eq.'+encodeURIComponent(saved.id),{method:'PATCH',headers:dbHeaders('return=minimal'),body:JSON.stringify({confirmation_email_sent_at:new Date().toISOString()})});
      }catch(e){console.error('customer email:',e);}
      try{await sendAdminOrderAlert(saved);}catch(e){console.error('admin alert:',e);}
    }
    return saved;
  }
  return order;
}

module.exports=async function(req,res){
  if(req.method==='OPTIONS')return json(res,204,{});
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
  try{
    requireEnv();
    if(!process.env.CASHFREE_CLIENT_ID||!process.env.CASHFREE_CLIENT_SECRET)return json(res,500,{error:'Cashfree credentials are not configured.'});
    const orderId=String(req.query?.order_id||'').trim();
    if(!orderId)return json(res,400,{error:'Missing order_id.'});
    const payments=await getPayments(orderId);
    const success=payments.some(p=>String(p.payment_status).toUpperCase()==='SUCCESS');
    const pending=!success&&payments.some(p=>String(p.payment_status).toUpperCase()==='PENDING');
    const payment_status=success?'SUCCESS':pending?'PENDING':'FAILED';
    const saved=await syncPaid(orderId,payments);
    return json(res,200,{success:true,order_id:orderId,payment_status,order_status:saved?.order_status||null,order_amount:saved?Number(saved.amount)/100:null});
  }catch(error){
    console.error('Cashfree status error:',error);
    return json(res,500,{error:'Unable to verify Cashfree payment.'});
  }
};
