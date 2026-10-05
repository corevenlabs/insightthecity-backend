const express = require("express");
const router = express.Router();

const legal = require("../controllers/legal.controller");
const { requireAuth } = require("../middleware/auth");

// --- Administración (panel); literales antes que "/:slug" ---
router.get("/admin/documents", requireAuth, legal.list);
router.post("/admin/documents", requireAuth, legal.create);
router.put("/admin/documents/:id", requireAuth, legal.update);
router.post("/admin/documents/:id/publish", requireAuth, legal.publish);
router.delete("/admin/documents/:id", requireAuth, legal.remove);

// --- Público (app) ---
router.get("/:slug", legal.getCurrent);

module.exports = router;
