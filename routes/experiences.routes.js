const express = require("express");
const router = express.Router();

const {
  listExperiences,
  getExperience,
  createExperience,
  updateExperience,
  deleteExperience,
} = require("../controllers/experiences.controller");

const requireAuth = require('../middleware/staff').requireStaff('admin','editor');

// Públicas (las consume la app)
router.get("/", (req,res,next)=>req.query.published === "all" ? requireAuth(req,res,next) : next(), listExperiences);
router.get("/tags", requireAuth, async (req, res, next) => {
  try { res.json(await require("../services/experiences.service").listTags()); }
  catch (err) { next(err); }
});
router.get("/:id", async (req,res,next)=> { try { const row=await require("../services/experiences.service").getById(req.params.id); if(row && !row.is_published) return requireAuth(req,res,next); next(); } catch(e){next(e);} }, getExperience);

// Protegidas (las usa el panel admin)
router.post("/", requireAuth, createExperience);
router.put("/:id", requireAuth, updateExperience);
router.delete("/:id", requireAuth, deleteExperience);

module.exports = router;
