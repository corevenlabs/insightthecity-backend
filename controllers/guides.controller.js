const service=require('../services/guides.service');
const {uploadPrivatePdf}=require('../services/uploads.service');
const list=async(req,res,next)=>{try{res.json(await service.list(Boolean(req.admin)));}catch(e){next(e)}};
const upload=async(req,res,next)=>{try{if(!req.file)return res.status(400).json({message:'Selecciona un PDF.'});res.json(await uploadPrivatePdf(req.file));}catch(e){next(e)}};
const create=async(req,res,next)=>{try{if(!req.body.title||!req.body.pdfKey)return res.status(400).json({message:'Título y PDF son obligatorios.'});res.status(201).json(await service.save(null,req.body));}catch(e){next(e)}};
const update=async(req,res,next)=>{try{const g=await service.save(req.params.id,req.body);if(!g)return res.status(404).json({message:'Guía no encontrada'});res.json(g);}catch(e){next(e)}};
const remove=async(req,res,next)=>{try{res.json({success:await service.remove(req.params.id)});}catch(e){next(e)}};
const download=async(req,res,next)=>{try{const data=await service.download(req.params.id,req.user.id);if(!data)return res.status(404).json({message:'Guía no encontrada'});res.json({url:data.url});}catch(e){next(e)}};
module.exports={list,upload,create,update,remove,download};
