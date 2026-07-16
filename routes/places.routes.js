const express = require("express");
const router = express.Router();

const { getPlaces } = require("../controllers/places.controller");

router.post("/", getPlaces);

module.exports = router;