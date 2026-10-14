const express = require("express");
const router = express.Router();

const legal = require("../controllers/legal.controller");
const { requireAuth } = require("../middleware/auth");

// --- Administración (panel); literales antes que "/:slug" ---
router.get("/admin/documents", requireAuth, legal.list);
router.get("/admin/acceptances", requireAuth, legal.acceptances);
router.get("/admin/acceptances/:id/pdf", requireAuth, async (req,res,next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.sendStatus(400);
    const row=await require("../services/legal.service").acceptance(req.params.id);
    if(!row) return res.sendStatus(404);
    res.set("Cache-Control","no-store").type("application/pdf").attachment(`ITC-acceptance-${row.id}.pdf`).send(await require("../services/legal-evidence-pdf").render(row));
  } catch(e){next(e);}
});
router.get("/admin/documents/:id", requireAuth, legal.documentVersion);
router.post("/admin/documents", requireAuth, legal.create);
router.put("/admin/documents/:id", requireAuth, legal.update);
router.post("/admin/documents/:id/publish", requireAuth, legal.publish);
router.delete("/admin/documents/:id", requireAuth, legal.remove);

// --- Público (app) ---
router.get("/:slug", legal.getCurrent);

module.exports = router;
