const { uploadImage } = require("../services/uploads.service");

const uploadOne = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Falta el archivo (campo 'file')" });
    }
    const type=require('../services/image-file').imageType(req.file.buffer);
    if(!type)return res.status(400).json({success:false,message:'Usa una imagen PNG, JPEG, WebP, GIF o AVIF válida.'});
    const url = await uploadImage({...req.file,mimetype:type.mime,originalname:`image${type.ext}`});
    res.json({ success: true, url });
  } catch (err) {
    next(err);
  }
};

module.exports = { uploadOne };
