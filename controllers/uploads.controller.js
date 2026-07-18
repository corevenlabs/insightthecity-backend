const { uploadImage } = require("../services/uploads.service");

const uploadOne = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Falta el archivo (campo 'file')" });
    }
    const url = await uploadImage(req.file);
    res.json({ success: true, url });
  } catch (err) {
    next(err);
  }
};

module.exports = { uploadOne };
