const {json,supabase,dbHeaders,sendConfirmationEmail}=require('./_common');
async function signedUrl(path){
  const r=await fetch(process.env.SUPABASE_URL+'/storage/v1/object/sign/manual-payment-screenshots',{method:'POST',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({paths:[path],expiresIn:1800})});
  const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.message||'Could not create screenshot link.');
  return process.env.SUPABASE_URL+'/storage/v1'+(d?.[0]?.signedURL||'');
}
function auth(req){return String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')===String(process.env.ADMIN_REVIEW_TOKEN||'');}
module.exports=async function(req,res){
  if(req.method==='OPTIONS') return json(res,204,{});
  if(!process.env.ADMIN_REVIEW_TOKEN||!auth(req)) return json(res,401,{error:'Unauthorized.'});
  try{
    if(req.method==='GET'){
      const rows=await supabase('manual_payment_submissions?status=eq.pending&select=id,order_id,utr,claimed_paid_at,screenshot_path,submitted_at,status,orders(order_number,amount,currency,customer_name,customer_email,customer_phone,address,city,state,pin,college)&order=submitted_at.desc');
      for(const x of rows) x.screenshotUrl=await signedUrl(x.screenshot_path);
      return json(res,200,{orders:rows});
    }
    if(req.method==='POST'){
      const b=req.body||{}; const id=String(b.id||''); const action=String(b.action||'');
      if(!id||!['approve','reject'].includes(action)) return json(res,400,{error:'Invalid review request.'});
      const rows=await supabase('manual_payment_submissions?id=eq.'+encodeURIComponent(id)+'&select=id,order_id,status,orders(*)');
      const sub=Array.isArray(rows)?rows[0]:null; if(!sub) return json(res,404,{error:'Submission not found.'});
      if(sub.status!=='pending') return json(res,409,{error:'This submission has already been reviewed.'});
      const approved=action==='approve';
      await supabase('manual_payment_submissions?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers:dbHeaders('return=minimal'),body:JSON.stringify({status:approved?'approved':'rejected',reviewed_at:new Date().toISOString()})});
      await supabase('orders?id=eq.'+encodeURIComponent(sub.order_id),{method:'PATCH',headers:dbHeaders('return=minimal'),body:JSON.stringify({payment_status:approved?'manual_verified':'manual_rejected',order_status:approved?'confirmed':'cancelled',paid_at:approved?new Date().toISOString():null})});
      if(approved && sub.orders) await sendConfirmationEmail(sub.orders).catch(()=>{});
      return json(res,200,{reviewed:true,status:approved?'approved':'rejected'});
    }
    return json(res,405,{error:'Method not allowed.'});
  }catch(err){console.error(err);return json(res,500,{error:err.message||'Admin request failed.'});}
};
