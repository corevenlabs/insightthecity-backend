const router = require("express").Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const { requireStaff } = require("../middleware/staff");
const R = require("../services/partner-rules");
const S = require("../services/partner-crm.service");
const mail = require("../services/partner-email.service");
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
router.get("/me", requireStaff("admin", "editor", "executive"), (req, res) =>
  res.json(req.admin),
);
router.get(
  "/",
  requireStaff("admin"),
  wrap(async (_req, res) =>
    res.json(
      (
        await db.query(
          "SELECT a.id,a.email,a.name,a.role,a.language,a.phone,a.is_active,(SELECT status FROM partner_mail m WHERE m.dedupe_key LIKE 'staff:%' AND m.recipient=a.email ORDER BY m.created_at DESC LIMIT 1) AS invite_status FROM admins a ORDER BY a.id",
        )
      ).rows,
    ),
  ),
);
async function invitation(c, staff, actor) {
  await c.query(
    "UPDATE partner_mail SET status='canceled' WHERE status IN ('pending','failed') AND dedupe_key IN (SELECT 'staff:'||id::text FROM staff_invitations WHERE admin_id=$1)",
    [staff.id],
  );
  const token = crypto.randomBytes(32).toString("base64url");
  await c.query(
    "UPDATE staff_invitations SET used_at=NOW() WHERE admin_id=$1 AND used_at IS NULL",
    [staff.id],
  );
  const invite = (
    await c.query(
      "INSERT INTO staff_invitations(admin_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '48 hours') RETURNING id",
      [staff.id, R.hash(token)],
    )
  ).rows[0];
  await mail.queue(c, {
    key: `staff:${invite.id}`,
    to: staff.email,
    kind: "staff",
    data: {
      language: staff.language,
      owner: actor,
      url: `${mail.PANEL()}/staff-invite#${token}`,
    },
  });
}
router.post(
  "/",
  requireStaff("admin"),
  wrap(async (req, res) => {
    const { role } = req.body;
    if (
      !["admin", "editor", "executive"].includes(role) ||
      !R.clean(req.body.name, 150)
    )
      R.fail("Nombre y rol requeridos");
    const row = await S.transaction(async (c) => {
      const existing = (
        await c.query("SELECT id FROM admins WHERE email=$1", [
          R.email(req.body.email),
        ])
      ).rows[0];
      if (existing) R.fail("Este correo ya tiene una cuenta", 409);
      const row = (
        await c.query(
          "INSERT INTO admins(email,name,password_hash,role,language,phone) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,email,name,role,language,phone,is_active",
          [
            R.email(req.body.email),
            R.clean(req.body.name, 150),
            await bcrypt.hash(crypto.randomBytes(40).toString("hex"), 12),
            role,
            R.language(req.body.language),
            R.clean(req.body.phone, 60),
          ],
        )
      ).rows[0];
      await invitation(c, row, req.admin);
      return row;
    });
    await S.sendPending(null);
    res.status(201).json(row);
  }),
);
router.post(
  "/:id",
  requireStaff("admin"),
  wrap(async (req, res) => {
    const row = await S.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(731924)");
      const staff = (
        await c.query("SELECT * FROM admins WHERE id=$1 FOR UPDATE", [
          Number(req.params.id),
        ])
      ).rows[0];
      if (!staff) R.fail("Usuario no encontrado", 404);
      if (req.body.action === "invite") {
        if (!staff.is_active) R.fail("Activa la cuenta antes de invitar");
        await invitation(c, staff, req.admin);
        return { ok: true };
      }
      if (
        !["admin", "editor", "executive"].includes(req.body.role) ||
        typeof req.body.is_active !== "boolean"
      )
        R.fail("Rol o estado inválido");
      if (
        staff.role === "admin" &&
        staff.is_active &&
        (req.body.role !== "admin" || !req.body.is_active)
      ) {
        const count = Number(
          (
            await c.query(
              "SELECT COUNT(*) FROM admins WHERE role='admin' AND is_active",
            )
          ).rows[0].count,
        );
        if (count <= 1) R.fail("Debe quedar un administrador activo", 409);
      }
      return (
        await c.query(
          "UPDATE admins SET role=$2,is_active=$3,name=$4,phone=$5,language=$6 WHERE id=$1 RETURNING id,email,name,role,language,phone,is_active",
          [
            staff.id,
            req.body.role,
            req.body.is_active,
            R.clean(req.body.name, 150) || staff.name,
            R.clean(req.body.phone, 60),
            R.language(req.body.language),
          ],
        )
      ).rows[0];
    });
    await S.sendPending(null);
    res.json(row);
  }),
);
router.post(
  "/accept/invitation",
  require("../middleware/partner-rate-limit")(10),
  wrap(async (req, res) => {
    if (
      typeof req.body.password !== "string" ||
      req.body.password.length < 12 ||
      Buffer.byteLength(req.body.password) > 72
    )
      R.fail("Usa una contraseña de 12 a 72 bytes");
    if (typeof req.body.token !== "string" || req.body.token.length > 100)
      R.fail("Invitación inválida", 400);
    await S.transaction(async (c) => {
      const invitation = (
        await c.query(
          "SELECT * FROM staff_invitations WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE",
          [R.hash(req.body.token)],
        )
      ).rows[0];
      if (!invitation) R.fail("La invitación venció o ya fue utilizada", 400);
      const staff = (
        await c.query("SELECT id FROM admins WHERE id=$1 AND is_active", [
          invitation.admin_id,
        ])
      ).rows[0];
      if (!staff) R.fail("Cuenta inactiva", 403);
      await c.query("UPDATE admins SET password_hash=$2 WHERE id=$1", [
        staff.id,
        await bcrypt.hash(req.body.password, 12),
      ]);
      await c.query("UPDATE staff_invitations SET used_at=NOW() WHERE id=$1", [
        invitation.id,
      ]);
    });
    res.json({ ok: true });
  }),
);
module.exports = router;
