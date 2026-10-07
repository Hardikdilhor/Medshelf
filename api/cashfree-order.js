const crypto=require('node:crypto');
const catalog=require('./_catalog');
const {json,requireEnv,supabase,dbHeaders}=require('./_common');

function clean(v,max=500){return String(v??'').trim().slice(0,max);}
function validEmail(v){return /^\S+@\S+\.\S+$/.test(String(v||''));}
function validPhone(v){return /^\d{10}$/.test(String(v||''));}
function validPin(v){return /^\d{6}$/.test(String(v||''));}

module.exports=async function(req,res){
  if(req.method==='OPTIONS')return json(res,204,{});
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});
  try{
    requireEnv();
    const clientId=process.env.CASHFREE_CLIENT_ID;
    const clientSecret=process.env.CASHFREE_CLIENT_SECRET;
    if(!clientId||!clientSecret)return json(res,500,{error:'Cashfree credentials are not configured.'});

    const body=req.body||{};
    const customer=body.customer||{};
    const requestedItems=Array.isArray(body.items)?body.items:[];
    const checkoutAttemptId=clean(body.checkoutAttemptId,120)||('ms-'+Date.now()+'-'+crypto.randomBytes(5).toString('hex'));

    const name=clean(customer.name,100), email=clean(customer.email,120).toLowerCase();
    const phone=clean(customer.phone,20), address=clean(customer.address,500);
    const city=clean(customer.city,80), state=clean(customer.state,80), pin=clean(customer.pin,10);
    if(!name||!validEmail(email)||!validPhone(phone)||!address||city!=='Patiala'||state!=='Punjab'||!validPin(pin))
      return json(res,400,{error:'Please provide valid delivery details.'});

    const items=[];
    for(const raw of requestedItems){
      const productId=Number(raw?.productId), quantity=Number(raw?.quantity);
      const product=catalog.find(x=>Number(x.id)===productId);
      if(!product||!Number.isInteger(quantity)||quantity<1||quantity>20)
        return json(res,400,{error:'Invalid order item.'});
      items.push({productId,quantity,title:product.title,unitPrice:Number(product.price)});
    }
    if(!items.length)return json(res,400,{error:'Your cart is empty.'});

    const total=items.reduce((sum,x)=>sum+x.unitPrice*x.quantity,0);
    if(!Number.isFinite(total)||total<=0)return json(res,400,{error:'Invalid order total.'});

    const orderId='MS_'+Date.now().toString(36).toUpperCase()+'_'+crypto.randomBytes(4).toString('hex').toUpperCase();
    const orderNumber=orderId;
    const now=new Date().toISOString();

    const inserted=await supabase('orders',{
      method:'POST',
      headers:dbHeaders('return=representation'),
      body:JSON.stringify({
        checkout_attempt_id:checkoutAttemptId,
        order_number:orderNumber,
        gateway_order_id:null,
        amount:Math.round(total*100),
        currency:'INR',
        payment_status:'created',
        order_status:'pending',
        customer_name:name,customer_email:email,customer_phone:phone,
        address,city,state,pin,college:'GMC Patiala',created_at:now
      })
    });
    const order=Array.isArray(inserted)?inserted[0]:inserted;
    if(!order?.id)throw new Error('Could not save order.');

    await supabase('order_items',{
      method:'POST',
      headers:dbHeaders('return=minimal'),
      body:JSON.stringify(items.map(x=>({order_id:order.id,product_id:x.productId,title:x.title,unit_price:Math.round(x.unitPrice*100),quantity:x.quantity})))
    });

    const base=process.env.CASHFREE_ENV==='sandbox'?'https://sandbox.cashfree.com/pg':'https://api.cashfree.com/pg';
    const cf=await fetch(base+'/orders',{
      method:'POST',
      headers:{'x-client-id':clientId,'x-client-secret':clientSecret,'x-api-version':'2025-01-01','Accept':'application/json','Content-Type':'application/json'},
      body:JSON.stringify({
        order_id:orderId,order_amount:Number(total.toFixed(2)),order_currency:'INR',
        customer_details:{customer_id:'medshelf_'+phone,customer_name:name,customer_email:email,customer_phone:phone},
        order_meta:{return_url:'https://hardikdilhor.github.io/Medshelf/?cashfree_order_id={order_id}'},
        order_note:'MedShelf MBBS books order'
      })
    });
    const data=await cf.json().catch(()=>({}));
    if(!cf.ok){
      await supabase('orders?id=eq.'+encodeURIComponent(order.id),{method:'PATCH',headers:dbHeaders('return=minimal'),body:JSON.stringify({payment_status:'creation_failed',order_status:'cancelled'})}).catch(()=>{});
      return json(res,cf.status,{error:data.message||'Cashfree could not create the order.'});
    }

    await supabase('orders?id=eq.'+encodeURIComponent(order.id),{
      method:'PATCH',headers:dbHeaders('return=minimal'),
      body:JSON.stringify({gateway_order_id:data.order_id||orderId})
    });

    return json(res,200,{success:true,order_id:data.order_id||orderId,payment_session_id:data.payment_session_id});
  }catch(error){
    console.error('Cashfree order error:',error);
    return json(res,500,{error:'Unable to create Cashfree payment order.'});
  }
};
