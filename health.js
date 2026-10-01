const {json}=require('./_common');
module.exports=async function(req,res){
  if(req.method==='OPTIONS') return json(res,204,{});
  return json(res,200,{ok:true,service:'MedShelf payments'});
};
