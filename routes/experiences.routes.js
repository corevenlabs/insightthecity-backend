const express = require("express");
const router = express.Router();

const {
  listExperiences,
  getExperience,
  createExperience,
  updateExperience,
  deleteExperience,
} = require("../controllers/experiences.controller");

const { requireAuth } = require("../middleware/auth");

// Públicas (las consume la app)
router.get("/", listExperiences);
router.get("/:id", getExperience);

// Protegidas (las usa el panel admin)
router.post("/", requireAuth, createExperience);
router.put("/:id", requireAuth, updateExperience);
router.delete("/:id", requireAuth, deleteExperience);

module.exports = router;
