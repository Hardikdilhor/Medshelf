const crypto = require('node:crypto');

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://hardikdilhor.github.io';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
}
function json(res,status,payload){ cors(res); return res.status(status).json(payload); }

function requireEnv(){
  const missing=[];
  if(!process.env.RAZORPAY_KEY_ID) missing.push('RAZORPAY_KEY_ID');
  if(!process.env.RAZORPAY_KEY_SECRET) missing.push('RAZORPAY_KEY_SECRET');
  if(!SUPABASE_URL) missing.push('SUPABASE_URL');
  if(!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if(missing.length) throw new Error('Payment server is not configured: '+missing.join(', '));
}
function hmac(value,secret){
  return crypto.createHmac('sha256',secret).update(value).digest('hex');
}
function safeEqual(a,b){
  const aa=Buffer.from(a||'','utf8'), bb=Buffer.from(b||'','utf8');
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
async function razorpay(path,options={}){
  const auth=Buffer.from(process.env.RAZORPAY_KEY_ID+':'+process.env.RAZORPAY_KEY_SECRET).toString('base64');
  const r=await fetch('https://api.razorpay.com/v1'+path,{
    ...options,
    headers:{Authorization:'Basic '+auth,'Content-Type':'application/json',...(options.headers||{})}
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error?.description || 'Razorpay API request failed.');
  return data;
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
function dbHeaders(prefer=''){
  return prefer ? {'Prefer':prefer} : {};
}
async function sendConfirmationEmail(order){
  const key=process.env.RESEND_API_KEY;
  const from=process.env.EMAIL_FROM;
  if(!key || !from) return false;
  const html=`<div style="font-family:Arial,sans-serif;line-height:1.6">
    <h2>MedShelf order confirmed</h2>
    <p>Thank you, ${escapeHtml(order.customer_name)}.</p>
    <p><b>Order:</b> ${escapeHtml(order.order_number)}</p>
    <p><b>Total:</b> ₹${(Number(order.amount)/100).toFixed(2)}</p>
    <p><b>Delivery:</b> ${escapeHtml(order.address)}, ${escapeHtml(order.city)}, ${escapeHtml(order.state)} - ${escapeHtml(order.pin)}</p>
    <p>Your payment has been verified and your order is recorded.</p>
  </div>`;
  const r=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({from,to:[order.customer_email],subject:'MedShelf order '+order.order_number+' confirmed',html})
  });
  if(!r.ok) throw new Error('Confirmation email could not be sent.');
  return true;
}
function escapeHtml(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
module.exports={cors,json,requireEnv,hmac,safeEqual,razorpay,supabase,dbHeaders,sendConfirmationEmail};
