const crypto=require('node:crypto');
const {json,requireEnv,supabase,dbHeaders}=require('./_common');
const catalog=require('./_catalog');

function clean(v,max=500){return String(v??'').trim().slice(0,max);}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}
function validPhone(v){return /^\d{10}$/.test(v);}
function validPin(v){return /^\d{6}$/.test(v);}
function decodeImage(dataUrl){
  const m=String(dataUrl||'').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if(!m) throw new Error('Please upload a PNG, JPG or WebP payment screenshot.');
  const buf=Buffer.from(m[2],'base64');
  if(buf.length>2*1024*1024) throw new Error('Payment screenshot must be 2 MB or smaller.');
  return {mime:m[1],buf};
}
async function storageUpload(path,mime,buf){
  const base=process.env.SUPABASE_URL+'/storage/v1/object/manual-payment-screenshots/'+encodeURIComponent(path);
  const r=await fetch(base,{method:'POST',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':mime,'x-upsert':'true'},body:buf});
  const t=await r.text(); if(!r.ok) throw new Error(t||'Could not store payment screenshot.');
}

module.exports=async function(req,res){
  if(req.method==='OPTIONS') return json(res,204,{});
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
  try{
    if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Payment server is not configured: Supabase credentials are missing.');
    const b=req.body||{}, c=b.customer||{}, items=Array.isArray(b.items)?b.items:[];
    const customer={name:clean(c.name,120),email:clean(c.email,180).toLowerCase(),phone:clean(c.phone,20).replace(/\D/g,''),address:clean(c.address,500),city:clean(c.city,100),state:clean(c.state,100),pin:clean(c.pin,10).replace(/\D/g,''),college:clean(c.college,180)};
    if(!customer.name||!validEmail(customer.email)||!validPhone(customer.phone)||!customer.address||!customer.city||!customer.state||!validPin(customer.pin)||!customer.college) return json(res,400,{error:'Please provide valid delivery details.'});
    if(!items.length) return json(res,400,{error:'Cart is empty.'});
    const utr=clean(b.utr,80).replace(/\s+/g,'');
    const paidAt=clean(b.paidAt,80);
    if(!utr) return json(res,400,{error:'Please enter the UPI transaction/reference ID (UTR).'});
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(paidAt)) return json(res,400,{error:'Please enter the payment date and time.'});
    const image=decodeImage(b.screenshot);
    let total=0,cleanItems=[];
    for(const item of items){
      const id=Number(item.productId),quantity=Number(item.quantity); if(!Number.isInteger(id)||!Number.isInteger(quantity)||quantity<1||quantity>20) return json(res,400,{error:'Invalid cart item.'});
      const product=catalog.find(p=>p.id===id); if(!product) return json(res,400,{error:'A selected book is no longer available.'});
      total+=product.price*quantity; cleanItems.push({productId:id,title:product.title,price:product.price,quantity});
    }
    const amount=Math.round(total*100);
    const checkoutAttemptId=clean(b.checkoutAttemptId,100)||('manual-'+crypto.randomUUID());
    const orderNumber='MS-'+new Date().getFullYear()+'-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,7).toUpperCase();
    const inserted=await supabase('orders',{method:'POST',headers:dbHeaders('return=representation'),body:JSON.stringify({checkout_attempt_id:checkoutAttemptId,order_number:orderNumber,amount,currency:'INR',payment_status:'manual_pending',order_status:'pending',customer_name:customer.name,customer_email:customer.email,customer_phone:customer.phone,address:customer.address,city:customer.city,state:customer.state,pin:customer.pin,college:customer.college})});
    const order=Array.isArray(inserted)?inserted[0]:inserted;
    await supabase('order_items',{method:'POST',headers:dbHeaders('return=minimal'),body:JSON.stringify(cleanItems.map(i=>({order_id:order.id,product_id:i.productId,title:i.title,unit_price:i.price,quantity:i.quantity})))});
    const ext=image.mime==='image/png'?'png':image.mime==='image/webp'?'webp':'jpg';
    const path=orderNumber+'.'+ext;
    await storageUpload(path,image.mime,image.buf);
    await supabase('manual_payment_submissions',{method:'POST',headers:dbHeaders('return=minimal'),body:JSON.stringify({order_id:order.id,utr,claimed_paid_at:paidAt,screenshot_path:path,status:'pending'})});
    return json(res,200,{submitted:true,orderNumber,amount,currency:'INR',status:'manual_pending'});
  }catch(err){console.error(err);return json(res,500,{error:err.message||'Unable to submit payment proof.'});}
};
