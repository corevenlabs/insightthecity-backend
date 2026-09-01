const express = require("express");
const router = express.Router();

const { list, getOne, sections } = require("../controllers/news.controller");

// Contenido público del WordPress del cliente (sin auth: son notas publicadas).
// GET /api/news?section=ny-al-dia&page=1&perPage=10
router.get("/", list);
// GET /api/news/sections  -> lista de secciones válidas
router.get("/sections", sections);
// GET /api/news/:id  -> una nota completa (con HTML)
router.get("/:id", getOne);

module.exports = router;
