module.exports=function authInput(req,res,next){
 const {email,password}=req.body||{};
 if(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email.trim())||typeof password!=='string'||!password.length||password.length>128){
  return res.status(400).json({success:false,message:'Revisa tu correo y contraseña.'});
 }
 next();
};
