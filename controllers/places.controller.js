const { searchPlaces } = require("../services/places.service");

const getPlaces = async (req, res, next) => {
  try {
    console.log("🔥 BODY RECIBIDO:", req.body);

    const { message } = req.body;

    const places = await searchPlaces(message);

    console.log("🏁 RESULTADO GOOGLE:", places);

    res.json({
      success: true,
      places,
    });
  } catch (error) {
    console.log("❌ ERROR:", error);
    next(error);
  }
};

module.exports = { getPlaces };
