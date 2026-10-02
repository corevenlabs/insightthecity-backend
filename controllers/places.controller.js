const { searchPlaces } = require("../services/places.service");

const getPlaces = async (req, res, next) => {
  try {
    const { message } = req.body;

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
