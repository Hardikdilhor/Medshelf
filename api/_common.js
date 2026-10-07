const crypto = require('node:crypto');

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://hardikdilhor.github.io';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
}
function json(res,status,payload){ cors(res); return res.status(status).json(payload); }

function requireEnv(){
  const missing=[];
  if(!SUPABASE_URL) missing.push('SUPABASE_URL');
  if(!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if(missing.length) throw new Error('Payment server is not configured: '+missing.join(', '));
}
function hmac(value,secret){ return crypto.createHmac('sha256',secret).update(value).digest('hex'); }
function safeEqual(a,b){
  const aa=Buffer.from(a||'','utf8'), bb=Buffer.from(b||'','utf8');
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
async function supabase(path, options={}){
  const r=await fetch(SUPABASE_URL+'/rest/v1/'+path,{
    ...options,
    headers:{
      apikey:SUPABASE_SERVICE_ROLE_KEY,
      Authorization:'Bearer '+SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type':'application/json',
      ...(options.headers||{})
    }
  });
  const text=await r.text();
  let data={};
  try{ data=text?JSON.parse(text):{}; }catch{ data={raw:text}; }
  if(!r.ok) throw new Error(data.message||data.error_description||data.error||'Database request failed.');
  return data;
}
function dbHeaders(prefer=''){ return prefer ? {'Prefer':prefer} : {}; }

async function getOrderItems(orderId){
  return supabase('order_items?order_id=eq.'+encodeURIComponent(orderId)+'&select=title,unit_price,quantity&order=id.asc');
}
async function sendConfirmationEmail(order){
  const key=process.env.RESEND_API_KEY,from=process.env.EMAIL_FROM;
  if(!key||!from||!order?.customer_email)return false;
  const items=await getOrderItems(order.id).catch(()=>[]);
  const itemHtml=items.length?'<ul>'+items.map(x=>'<li>'+escapeHtml(x.title)+' × '+Number(x.quantity)+' — ₹'+(Number(x.unit_price*x.quantity)/100).toFixed(2)+'</li>').join('')+'</ul>':'<p>Order items are available on the MedShelf website.</p>';
  const html=`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>MedShelf order confirmed</h2><p>Thank you, ${escapeHtml(order.customer_name)}.</p><p>Your payment has been verified successfully.</p><p><b>Order:</b> ${escapeHtml(order.order_number)}</p><p><b>Total:</b> ₹${(Number(order.amount)/100).toFixed(2)}</p><p><b>Books / notes ordered:</b></p>${itemHtml}<p><b>Delivery:</b> ${escapeHtml(order.address)}, ${escapeHtml(order.city)}, ${escapeHtml(order.state)} - ${escapeHtml(order.pin)}</p><p>You can view your order status on the MedShelf website using your order number and email.</p></div>`;
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from,to:[order.customer_email],subject:'MedShelf order '+order.order_number+' confirmed',html})});
  if(!r.ok)throw new Error('Confirmation email could not be sent.');
  return true;
}
async function sendAdminOrderAlert(order){
  const key=process.env.RESEND_API_KEY,from=process.env.EMAIL_FROM,to=process.env.ADMIN_EMAIL;
  if(!key||!from||!to||!order?.id)return false;
  const items=await getOrderItems(order.id).catch(()=>[]);
  const itemHtml=items.length?items.map(x=>escapeHtml(x.title)+' × '+Number(x.quantity)).join('<br>'):'Items not available';
  const deadline=new Date(new Date(order.created_at).getTime()+3*86400000).toLocaleDateString('en-IN');
  const html=`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>🔔 New MedShelf order paid</h2><p><b>Order:</b> ${escapeHtml(order.order_number)}</p><p><b>Total:</b> ₹${(Number(order.amount)/100).toFixed(2)}</p><p><b>Items:</b><br>${itemHtml}</p><p><b>Customer:</b> ${escapeHtml(order.customer_name)} · ${escapeHtml(order.customer_phone)}</p><p><b>Delivery:</b> ${escapeHtml(order.address)}, ${escapeHtml(order.city)}, ${escapeHtml(order.state)} - ${escapeHtml(order.pin)}</p><p><b>Delivery target:</b> ${deadline}</p></div>`;
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject:'🔔 New MedShelf paid order '+order.order_number,html})});
  if(!r.ok)throw new Error('Admin order alert could not be sent.');
  return true;
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
module.exports={cors,json,requireEnv,hmac,safeEqual,supabase,dbHeaders,sendConfirmationEmail,sendAdminOrderAlert,getOrderItems};
