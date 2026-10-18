// Apply the same self-hosted typography to every backend-owned HTML page.
// JSON, webhooks, files, email copy and payment data are untouched.
module.exports=function brandTypography(_req,res,next){
 const send=res.send;
 res.send=function(body){
  if(typeof body==='string'&&/<(?:!doctype html|html)[\s>]/i.test(body)&&!body.includes('data-itc-typography')){
   body=body.replace(/<\/head>/i,'<link data-itc-typography="v1" rel="stylesheet" href="/brand-assets/typography.css"></head>');
   let csp=res.get('Content-Security-Policy');
   if(csp){
    if(/style-src\s/.test(csp))csp=csp.replace(/style-src([^;]*)/,(_,sources)=>`style-src${sources.includes("'self'")?sources:sources+" 'self'"}`);
    csp=/font-src\s/.test(csp)?csp.replace(/font-src[^;]*/,"font-src 'self'"):csp+"; font-src 'self'";
    res.set('Content-Security-Policy',csp);
   }
  }
  return send.call(this,body);
 };next();
};
