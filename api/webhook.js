const crypto=require('node:crypto');
const {json,requireEnv,supabase,dbHeaders,sendConfirmationEmail,sendAdminOrderAlert}=require('./_common');

async function rawBody(req){
  if(Buffer.isBuffer(req.body))return req.body.toString('utf8');
  if(typeof req.body==='string')return req.body;
  let data='';
  await new Promise((resolve,reject)=>{req.setEncoding('utf8');req.on('data',c=>data+=c);req.on('end',resolve);req.on('error',reject);});
  return data;
}
function verifySignature(raw,signature,timestamp,secret){
  const expected=crypto.createHmac('sha256',secret).update(String(timestamp)+raw).digest('base64');
  const a=Buffer.from(expected),b=Buffer.from(String(signature||''));return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

module.exports=async function(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});
  try{
    requireEnv();
    const raw=await rawBody(req);
    const signature=req.headers['x-webhook-signature'];
    const timestamp=req.headers['x-webhook-timestamp'];
    const secret=process.env.CASHFREE_CLIENT_SECRET;
    if(!secret||!verifySignature(raw,signature,timestamp,secret))return json(res,400,{error:'Invalid webhook signature.'});
    const event=JSON.parse(raw);
    const eventId=req.headers['x-webhook-id']||crypto.createHash('sha256').update(raw).digest('hex');
    const inserted=await supabase('webhook_events',{method:'POST',headers:dbHeaders('return=representation,resolution=ignore-duplicates'),body:JSON.stringify({event_id:eventId,payload:event})}).catch(()=>[]);
    if(Array.isArray(inserted)&&inserted.length===0)return json(res,200,{received:true,duplicate:true});

    const payment=event?.data?.payment||{};
    const orderInfo=event?.data?.order||{};
    if(String(payment.payment_status||'').toUpperCase()==='SUCCESS'&&orderInfo.order_id){
      const rows=await supabase('orders?gateway_order_id=eq.'+encodeURIComponent(orderInfo.order_id)+'&select=*&limit=1');
      const order=Array.isArray(rows)?rows[0]:null;
      if(order && Number(payment.payment_amount)===Number(order.amount)/100){
        const updated=await supabase('orders?id=eq.'+encodeURIComponent(order.id),{method:'PATCH',headers:dbHeaders('return=representation'),body:JSON.stringify({gateway_payment_id:payment.cf_payment_id||null,payment_status:'paid',order_status:order.order_status==='delivered'?'delivered':'confirmed',paid_at:order.paid_at||new Date().toISOString()})});
        const saved=Array.isArray(updated)?updated[0]:updated;
        if(saved&&!saved.confirmation_email_sent_at){
          try{const sent=await sendConfirmationEmail(saved);if(sent)await supabase('orders?id=eq.'+encodeURIComponent(saved.id),{method:'PATCH',headers:dbHeaders('return=minimal'),body:JSON.stringify({confirmation_email_sent_at:new Date().toISOString()})});}catch(e){console.error('customer email:',e);}
          try{await sendAdminOrderAlert(saved);}catch(e){console.error('admin alert:',e);}
        }
      }
    }
    return json(res,200,{received:true});
  }catch(err){console.error('Cashfree webhook:',err);return json(res,500,{error:'Webhook processing failed.'});}
};
module.exports.config={api:{bodyParser:false}};
