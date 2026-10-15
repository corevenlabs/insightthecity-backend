const helmet=require('helmet');
const cors=require('cors');
const defaults=[
 'https://itc-panel-1031252664334.us-east1.run.app',
 'https://itc-panel-y6mpnwbt6q-ue.a.run.app',
 'https://itc-backend-1031252664334.us-east1.run.app',
 'https://insightthecity.com','https://www.insightthecity.com'
];
function allowedOrigins(){
 const configured=[process.env.PANEL_PUBLIC_URL,process.env.PUBLIC_BASE_URL,...(process.env.CORS_ALLOWED_ORIGINS||'').split(',')];
 const result=new Set(defaults);
 for(const value of configured){try{if(value)result.add(new URL(value.trim()).origin);}catch{}}
 return result;
}
const corsOptions={exposedHeaders:['Content-Range','Retry-After'],origin(origin,callback){
 if(!origin||allowedOrigins().has(origin)|| (process.env.NODE_ENV!=='production'&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))return callback(null,true);
 callback(Object.assign(Error('Origen no autorizado'),{status:403}));
}};
// HTML pages define their own CSP. Images must still load in mail clients and the app.
const headers=helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:'cross-origin'},crossOriginEmbedderPolicy:false,crossOriginOpenerPolicy:false});
module.exports={headers,cors:cors(corsOptions),corsOptions,allowedOrigins};
