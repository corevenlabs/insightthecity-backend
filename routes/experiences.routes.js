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
router.get("/tags", require('../middleware/staff').requireStaff('admin','editor','executive'), async (req, res, next) => {
  try { res.json(await require("../services/experiences.service").listTags()); }
  catch (err) { next(err); }
});
router.get("/:id", async (req,res,next)=> { try { const row=await require("../services/experiences.service").getById(req.params.id); if(row && !row.is_published) return requireAuth(req,res,next); next(); } catch(e){next(e);} }, getExperience);

// Linked partner drafts cannot bypass the final administrator review through generic endpoints.
const protectPartnerDraft = async (req,res,next) => {
  try {
    if(req.admin.role !== 'admin') {
      const result = await require('../config/db').query('SELECT 1 FROM partner_clients WHERE experience_id=$1 AND activated_at IS NULL AND deleted_at IS NULL LIMIT 1',[req.params.id]);
      if(result.rowCount) return res.status(403).json({message:'Solo un administrador puede publicar o eliminar un borrador de cliente'});
    }
    next();
  } catch(error){next(error);}
};
// Protegidas (las usa el panel admin)
router.post("/", requireAuth, createExperience);
router.put("/:id", requireAuth, protectPartnerDraft, updateExperience);
router.delete("/:id", requireAuth, protectPartnerDraft, deleteExperience);

module.exports = router;
