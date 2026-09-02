const axios = require("axios");

const LANGUAGE_CODES = { es: "es", en: "en", pt: "pt-BR" };

async function searchPlaces(query, options = {}) {
  const body = {
    textQuery: String(query || "").trim(),
    maxResultCount: Math.min(Math.max(Number(options.maxResults) || 5, 1), 10),
    languageCode: LANGUAGE_CODES[options.language] || "es",
    regionCode: "US",
  };
  if (Number.isFinite(options.lat) && Number.isFinite(options.lng)) {
    body.locationBias = { circle: { center: { latitude: options.lat, longitude: options.lng }, radius: 8000 } };
  }
  const response = await axios.post("https://places.googleapis.com/v1/places:searchText", body, {
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": [
        "places.id", "places.displayName", "places.formattedAddress", "places.location",
        "places.rating", "places.userRatingCount", "places.priceLevel",
        "places.primaryTypeDisplayName", "places.googleMapsUri", "places.websiteUri",
        "places.currentOpeningHours.openNow",
      ].join(","),
    },
    timeout: 10000,
  });
  return response.data.places || [];
}

module.exports = { searchPlaces };
