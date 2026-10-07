const {json,requireEnv,supabase}=require('./_common');

module.exports=async function(req,res){
  if(req.method==='OPTIONS')return json(res,204,{});
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
  try{
    requireEnv();
    const orderId=String(req.query?.order_id||'').trim();
    const email=String(req.query?.email||'').trim().toLowerCase();
    if(!orderId||!email)return json(res,400,{error:'Order number and email are required.'});
    const rows=await supabase('orders?or=(gateway_order_id.eq.'+encodeURIComponent(orderId)+',order_number.eq.'+encodeURIComponent(orderId)+')&customer_email=eq.'+encodeURIComponent(email)+'&select=id,order_number,gateway_order_id,amount,currency,payment_status,order_status,customer_name,customer_email,customer_phone,address,city,state,pin,created_at,paid_at&limit=1');
    const order=Array.isArray(rows)?rows[0]:null;
    if(!order)return json(res,404,{error:'No order found for that order number and email.'});
    const items=await supabase('order_items?order_id=eq.'+encodeURIComponent(order.id)+'&select=title,unit_price,quantity&order=id.asc');
    const deadline=new Date(new Date(order.created_at).getTime()+3*86400000).toISOString();
    return json(res,200,{order:{...order,items,delivery_deadline:deadline}});
  }catch(error){
    console.error('Customer order error:',error);
    return json(res,500,{error:'Unable to load your order.'});
  }
};
