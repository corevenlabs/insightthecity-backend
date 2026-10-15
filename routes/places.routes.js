const express = require("express");
const router = express.Router();

const { getPlaces } = require("../controllers/places.controller");

const security=require('../middleware/security-rate-limit');
router.post('/',require('../middleware/auth').requireUserAuth,security.limit('places-minute',30,60,security.user),security.limit('places-day',300,86400,security.user),getPlaces);

module.exports = router;