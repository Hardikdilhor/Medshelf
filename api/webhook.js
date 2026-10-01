const {json,requireEnv,hmac,safeEqual,razorpay,supabase,sendConfirmationEmail}=require('./_common');
const crypto=require('node:crypto');

async function rawBody(req){
  if(Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if(typeof req.body==='string') return req.body;
  let data='';
  await new Promise((resolve,reject)=>{
    req.setEncoding('utf8');
    req.on('data',c=>data+=c);
    req.on('end',resolve);
    req.on('error',reject);
  });
  return data;
}

module.exports=async function(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
  try{
    requireEnv();
    const secret=process.env.RAZORPAY_WEBHOOK_SECRET;
    if(!secret) return json(res,500,{error:'Webhook secret is not configured.'});
    const raw=await rawBody(req);
    const signature=req.headers['x-razorpay-signature'];
    const expected=hmac(raw,secret);
    if(!safeEqual(expected,signature)) return json(res,400,{error:'Invalid webhook signature.'});

    const eventId=req.headers['x-razorpay-event-id']||crypto.createHash('sha256').update(raw).digest('hex');
    const inserted=await supabase('webhook_events',{
      method:'POST',
      headers:dbHeaders('return=representation,resolution=ignore-duplicates'),
      body:JSON.stringify({event_id:eventId,payload:JSON.parse(raw),received_at:new Date().toISOString()})
    }).catch(()=>[]);
    if(Array.isArray(inserted)&&inserted.length===0) return json(res,200,{received:true,duplicate:true});

    const event=JSON.parse(raw);
    const payment=event.payload?.payment?.entity;
    if(payment?.order_id && payment.status==='captured'){
      const rows=await supabase('orders?gateway_order_id=eq.'+encodeURIComponent(payment.order_id)+'&select=*&limit=1');
      const order=Array.isArray(rows)?rows[0]:null;
      if(order && Number(payment.amount)===Number(order.amount)){
        const updated=await supabase('orders?gateway_order_id=eq.'+encodeURIComponent(payment.order_id)+'&payment_status=neq.paid',{
          method:'PATCH',headers:dbHeaders('return=representation'),
          body:JSON.stringify({
            gateway_payment_id:payment.id,payment_status:'paid',order_status:'confirmed',
            paid_at:new Date().toISOString()
          })
        });
        const saved=Array.isArray(updated)?updated[0]:updated;
        if(saved){
          try{
            const sent=await sendConfirmationEmail(saved);
            if(sent) await supabase('orders?id=eq.'+encodeURIComponent(saved.id),{
              method:'PATCH',headers:dbHeaders('return=minimal'),
              body:JSON.stringify({confirmation_email_sent_at:new Date().toISOString()})
            });
          }catch(e){console.error('email:',e);}
        }
      }
    }
    return json(res,200,{received:true});
  }catch(err){
    console.error(err);
    return json(res,500,{error:'Webhook processing failed.'});
  }
};

module.exports.config={api:{bodyParser:false}};
