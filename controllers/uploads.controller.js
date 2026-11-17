const { uploadImage } = require("../services/uploads.service");

const uploadOne = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Falta el archivo (campo 'file')" });
    }
    const type=require('../services/image-file').imageType(req.file.buffer);
    if(!type)return res.status(400).json({success:false,message:'Usa una imagen PNG, JPEG, WebP, GIF o AVIF válida.'});
    // Public experience photos are resized before storage (see services/image-optimize).
    const image = await require('../services/image-optimize').optimizeImage(req.file.buffer, type.mime);
    const url = await uploadImage({...req.file,buffer:image.buffer,size:image.buffer.length,mimetype:image.mime,originalname:`image${image.ext}`});
    res.json({ success: true, url });
  } catch (err) {
    next(err);
  }
};

module.exports = { uploadOne };
