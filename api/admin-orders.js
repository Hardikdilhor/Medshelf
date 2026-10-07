const {json,requireEnv,supabase,dbHeaders}=require('./_common');
function auth(req){return String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')===String(process.env.ADMIN_REVIEW_TOKEN||'');}
function statusFor(o){
  if(o.order_status==='delivered')return 'Delivered';
  const d=new Date(o.created_at).getTime()+3*86400000,now=Date.now();
  if(now>d)return 'Overdue — '+Math.floor((now-d)/86400000+1)+' day'+(Math.floor((now-d)/86400000+1)===1?'':'s');
  if(new Date(d).toDateString()===new Date().toDateString())return 'Due Today';
  if(new Date(d).toDateString()===new Date(Date.now()+86400000).toDateString())return 'Due Tomorrow';
  return 'Upcoming';
}
module.exports=async function(req,res){
  if(req.method==='OPTIONS')return json(res,204,{});
  if(!process.env.ADMIN_REVIEW_TOKEN||!auth(req))return json(res,401,{error:'Unauthorized.'});
  try{
    requireEnv();
    if(req.method==='GET'){
      const rows=await supabase('orders?payment_status=eq.paid&select=id,order_number,gateway_order_id,amount,currency,payment_status,order_status,customer_name,customer_email,customer_phone,address,city,state,pin,created_at,paid_at,confirmation_email_sent_at&order=created_at.desc');
      for(const o of rows){
        o.delivery_deadline=new Date(new Date(o.created_at).getTime()+3*86400000).toISOString();
        o.delivery_label=statusFor(o);
        o.items=await supabase('order_items?order_id=eq.'+encodeURIComponent(o.id)+'&select=title,unit_price,quantity&order=id.asc');
      }
      return json(res,200,{orders:rows});
    }
    if(req.method==='POST'){
      const b=req.body||{},id=String(b.id||''),action=String(b.action||'');
      if(!id||action!=='delivered')return json(res,400,{error:'Invalid request.'});
      const updated=await supabase('orders?id=eq.'+encodeURIComponent(id)+'&payment_status=eq.paid',{method:'PATCH',headers:dbHeaders('return=representation'),body:JSON.stringify({order_status:'delivered',delivered_at:new Date().toISOString()})});
      return json(res,200,{updated:true,order:Array.isArray(updated)?updated[0]:updated});
    }
    return json(res,405,{error:'Method not allowed.'});
  }catch(e){console.error('Admin orders:',e);return json(res,500,{error:e.message||'Admin request failed.'});}
};
