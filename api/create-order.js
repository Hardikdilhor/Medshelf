const {json,requireEnv,razorpay,supabase,dbHeaders}=require('./_common');
const catalog=require('./_catalog');

function clean(v,max=500){return String(v??'').trim().slice(0,max);}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}
function validPhone(v){return /^\d{10}$/.test(v);}
function validPin(v){return /^\d{6}$/.test(v);}

module.exports=async function(req,res){
  if(req.method==='OPTIONS') return json(res,204,{});
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});

  try{
    requireEnv();
    const body=req.body||{};
    const c=body.customer||{};
    const items=Array.isArray(body.items)?body.items:[];
    const checkoutAttemptId=clean(body.checkoutAttemptId,100);

    const customer={
      name:clean(c.name,120), email:clean(c.email,180).toLowerCase(),
      phone:clean(c.phone,20).replace(/\D/g,''),
      address:clean(c.address,500), city:clean(c.city,100),
      state:clean(c.state,100), pin:clean(c.pin,10).replace(/\D/g,''),
      college:clean(c.college,180)
    };
    if(!checkoutAttemptId || !customer.name || !validEmail(customer.email) || !validPhone(customer.phone) ||
       !customer.address || !customer.city || !customer.state || !validPin(customer.pin) || !customer.college)
      return json(res,400,{error:'Please provide valid customer and delivery details.'});
    if(!items.length) return json(res,400,{error:'Cart is empty.'});

    const existing=await supabase('orders?checkout_attempt_id=eq.'+encodeURIComponent(checkoutAttemptId)+'&select=order_number,gateway_order_id,amount,currency,payment_status&limit=1');
    if(Array.isArray(existing)&&existing[0]&&existing[0].gateway_order_id){
      return json(res,200,{
        keyId:process.env.RAZORPAY_KEY_ID,
        amount:existing[0].amount,
        currency:existing[0].currency,
        gatewayOrderId:existing[0].gateway_order_id,
        orderNumber:existing[0].order_number,
        customer
      });
    }

    let total=0;
    const cleanItems=[];
    for(const item of items){
      const id=Number(item.productId), quantity=Number(item.quantity);
      if(!Number.isInteger(id)||!Number.isInteger(quantity)||quantity<1||quantity>20)
        return json(res,400,{error:'Invalid cart item.'});
      const product=catalog.find(p=>p.id===id);
      if(!product) return json(res,400,{error:'A selected book is no longer available.'});
      total += product.price*quantity;
      cleanItems.push({productId:id,title:product.title,price:product.price,quantity});
    }

    const amount=Math.round(total*100);
    const orderNumber='MS-'+new Date().getFullYear()+'-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,7).toUpperCase();

    const inserted=await supabase('orders',{
      method:'POST',
      headers:dbHeaders('return=representation'),
      body:JSON.stringify({
        checkout_attempt_id:checkoutAttemptId,
        order_number:orderNumber,
        amount,currency:'INR',
        payment_status:'created',order_status:'pending',
        customer_name:customer.name,customer_email:customer.email,customer_phone:customer.phone,
        address:customer.address,city:customer.city,state:customer.state,pin:customer.pin,college:customer.college
      })
    });
    const dbOrder=Array.isArray(inserted)?inserted[0]:inserted;

    await supabase('order_items',{
      method:'POST',
      headers:dbHeaders('return=minimal'),
      body:JSON.stringify(cleanItems.map(i=>({
        order_id:dbOrder.id,product_id:i.productId,title:i.title,unit_price:i.price,quantity:i.quantity
      })))
    });

    let gatewayOrder;
    try{
      gatewayOrder=await razorpay('/orders',{
        method:'POST',
        body:JSON.stringify({amount,currency:'INR',receipt:orderNumber,partial_payment:false})
      });
    }catch(err){
      await supabase('orders?id=eq.'+encodeURIComponent(dbOrder.id),{
        method:'PATCH',headers:dbHeaders('return=minimal'),
        body:JSON.stringify({payment_status:'gateway_error',order_status:'cancelled'})
      }).catch(()=>{});
      throw err;
    }

    await supabase('orders?id=eq.'+encodeURIComponent(dbOrder.id),{
      method:'PATCH',headers:dbHeaders('return=minimal'),
      body:JSON.stringify({gateway_order_id:gatewayOrder.id})
    });

    return json(res,200,{
      keyId:process.env.RAZORPAY_KEY_ID,amount:gatewayOrder.amount,currency:gatewayOrder.currency,
      gatewayOrderId:gatewayOrder.id,orderNumber,customer,items:cleanItems
    });
  }catch(err){
    console.error(err);
    return json(res,500,{error:err.message||'Unable to create payment order.'});
  }
};
