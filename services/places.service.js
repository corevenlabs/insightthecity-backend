const axios = require("axios");

const searchPlaces = async (query) => {
  const url = "https://places.googleapis.com/v1/places:searchText";

  const response = await axios.post(
    url,
    {
      textQuery: query,
    },
    {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.location",
      },
    }
  );

  return response.data.places;
};

module.exports = {
  searchPlaces,
};