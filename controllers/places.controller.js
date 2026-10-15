const { searchPlaces } = require("../services/places.service");

const getPlaces = async (req, res, next) => {
  try {
    const message=req.body?.message;
    if(typeof message!=='string'||!message.trim()||message.length>300)return res.status(400).json({success:false,message:'La búsqueda debe tener entre 1 y 300 caracteres.'});

    const places = await searchPlaces(message);

    res.json({
      success: true,
      places,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getPlaces };
