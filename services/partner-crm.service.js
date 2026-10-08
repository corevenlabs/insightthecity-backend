const db = require("../config/db");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const R = require("./partner-rules");
const mail = require("./partner-email.service");
async function transaction(fn) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function get(c, id, actor, lock = false) {
  if (!/^[\da-f-]{36}$/i.test(id || "")) R.fail("Cliente no encontrado", 404);
  const row = (
    await c.query(
      `SELECT * FROM partner_clients WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!row || (actor && !R.canSee(actor, row)))
    R.fail("Cliente no encontrado", 404);
  return row;
}
function manage(actor) {
  if (!["admin", "executive"].includes(actor.role))
    R.fail("Sin permiso para gestionar clientes", 403);
}
function publicToken(row) {
  return jwt.sign(
    {
      type: "partner",
      id: row.id,
      v: row.link_version,
      exp: Math.floor(new Date(row.link_expires_at).getTime() / 1000),
    },
    process.env.JWT_SECRET,
  );
}
const link = (row) => `${mail.PANEL()}/partner#${publicToken(row)}`;
async function fromToken(token, c = db, lock = false) {
  let p;
  try {
    p = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    R.fail("El enlace venció o no es válido", 401);
  }
  if (p.type !== "partner") R.fail("Enlace inválido", 401);
  const row = await get(c, p.id, null, lock);
  if (row.link_version !== p.v || new Date(row.link_expires_at) <= new Date())
    R.fail("El enlace venció", 401);
  return row;
}
async function activity(c, row, actor, kind, note = "") {
  await c.query(
    "INSERT INTO partner_activity(client_id,actor_id,kind,note) VALUES($1,$2,$3,$4)",
    [row.id, actor?.id || null, kind, R.clean(note, 10000)],
  );
}
async function owner(c, row) {
  return (
    await c.query(
      "SELECT id,email,name,phone,language FROM admins WHERE id=$1",
      [row.owner_id],
    )
  ).rows[0];
}
async function enqueue(c, row, kind, key, note = "", extra = {}) {
  const who = await owner(c, row);
  await mail.queue(c, {
    key,
    clientId: row.id,
    to: row.email,
    kind,
    data: {
      client: row,
      owner: who,
      url: link(row),
      language: row.language,
      note,
      ...extra,
    },
  });
}
async function sendPending(id) {
  await mail
    .flush(id)
    .catch((e) => console.error("[partner mail]", e.code || "delivery failed"));
}
async function list(actor) {
  return (
    await db.query(
      `SELECT p.id,p.business_name,p.contact_name,p.form_status,p.activated_at,p.expires_at,p.experience_id,a.name AS owner_name,a.email AS owner_email${actor.role === "editor" ? "" : ",p.email,p.owner_id,p.category,p.offer,p.amount_cents,p.payment_method,p.payment_status,p.renewal_status,p.next_followup"} FROM partner_clients p JOIN admins a ON a.id=p.owner_id WHERE ($1::boolean OR p.owner_id=$2) ORDER BY p.updated_at DESC`,
      [actor.role !== "executive", actor.id],
    )
  ).rows;
}
async function detail(id, actor) {
  const row = await get(db, id, actor);
  const files = (
    await db.query(
      "SELECT id,kind,name,mime,size FROM partner_files WHERE client_id=$1 ORDER BY created_at",
      [id],
    )
  ).rows;
  const who = await owner(db, row);
  if (actor.role === "editor")
    return {
      id: row.id,
      business_name: row.business_name,
      form_status: row.form_status,
      content: row.content,
      experience_id: row.experience_id,
      activated_at: row.activated_at,
      expires_at: row.expires_at,
      files,
      owner: who,
    };
  const [events, acceptances, emails, periods] = await Promise.all(
    [
      "SELECT p.*,a.name AS actor_name FROM partner_activity p LEFT JOIN admins a ON a.id=p.actor_id WHERE client_id=$1 ORDER BY created_at DESC",
      "SELECT * FROM partner_acceptances WHERE client_id=$1 ORDER BY accepted_at",
      "SELECT id,recipient,status,error_code,created_at,sent_at FROM partner_mail WHERE client_id=$1 ORDER BY created_at DESC",
      "SELECT * FROM partner_periods WHERE client_id=$1 ORDER BY starts_at DESC",
    ].map((q) => db.query(q, [id])),
  );
  return {
    ...row,
    files,
    owner: who,
    activity: events.rows,
    acceptances: acceptances.rows,
    emails: emails.rows,
    periods: periods.rows,
    link: link(row),
  };
}
async function create(input, actor) {
  manage(actor);
  const config = R.offer(input.category, input.offer, input.payment_method);
  const ownerId =
    actor.role === "admin" ? Number(input.owner_id || actor.id) : actor.id;
  const who = (
    await db.query(
      "SELECT id FROM admins WHERE id=$1 AND is_active AND role IN ('admin','executive')",
      [ownerId],
    )
  ).rows[0];
  if (!who) R.fail("Selecciona un ejecutivo activo");
  const business = R.clean(input.business_name, 200),
    contact = R.clean(input.contact_name, 150);
  if (!business || !contact) R.fail("Completa negocio y contacto");
  const row = (
    await db.query(
      `INSERT INTO partner_clients(business_name,contact_name,email,phone,language,owner_id,category,offer,amount_cents,payment_method,payment_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        business,
        contact,
        R.email(input.email),
        R.clean(input.phone, 60),
        R.language(input.language),
        ownerId,
        config.category,
        config.offer,
        config.amount_cents,
        config.payment_method,
        config.payment_status,
      ],
    )
  ).rows[0];
  await activity(db, row, actor, "created");
  return detail(row.id, actor);
}
async function termsSnapshot(c, row) {
  if (Object.keys(row.terms_snapshot).length) return row.terms_snapshot;
  const docs = (
    await c.query(
      "SELECT DISTINCT ON(language) * FROM partner_terms WHERE variant=$1 AND approved_at IS NOT NULL ORDER BY language,version DESC",
      [row.offer],
    )
  ).rows;
  if (docs.length !== 3)
    R.fail(
      "Faltan términos aprobados para esta oferta en inglés, español y portugués",
      409,
    );
  const snapshot = Object.fromEntries(docs.map((d) => [d.language, d]));
  await c.query("UPDATE partner_clients SET terms_snapshot=$2 WHERE id=$1", [
    row.id,
    JSON.stringify(snapshot),
  ]);
  row.terms_snapshot = snapshot;
  return snapshot;
}
async function action(id, input, actor) {
  const result = await transaction(async (c) => {
    const row = await get(c, id, actor, true);
    const op = input.action;
    if (!["ready", "activate"].includes(op)) manage(actor);
    if (op === "invite") {
      await termsSnapshot(c, row);
      if (row.form_status !== "not_sent")
        R.fail("La invitación ya fue creada; usa reenviar", 409);
      await c.query(
        "UPDATE partner_clients SET form_status='invited',updated_at=NOW() WHERE id=$1",
        [id],
      );
      await enqueue(
        c,
        row,
        row.payment_status === "pending" ? "payment" : "invite",
        `invite:${id}`,
      );
    } else if (op === "resend") {
      await c.query(
        "UPDATE partner_mail SET status='canceled' WHERE client_id=$1 AND recipient=$2 AND status IN ('pending','failed') AND strpos(message->>'html','/partner#')>0",
        [id, row.email],
      );
      if (
        row.payment_method === "stripe" &&
        row.payment_status === "pending" &&
        row.stripe_session_id
      ) {
        const stripe = require("./stripe.service");
        const session = await stripe.retrieveCheckoutSession(
          row.stripe_session_id,
        );
        if (session.payment_status === "paid")
          R.fail("Primero verifica el pago en Stripe", 409);
        if (session.status === "open")
          await stripe.expireCheckoutSession(session.id);
      }
      if (row.form_status === "not_sent") R.fail("Envía primero la invitación");
      await c
        .query(
          "UPDATE partner_clients SET link_version=gen_random_uuid(),link_expires_at=NOW()+INTERVAL '90 days' WHERE id=$1 RETURNING *",
          [id],
        )
        .then((r) => Object.assign(row, r.rows[0]));
      await enqueue(
        c,
        row,
        row.payment_status === "pending" ? "payment" : "invite",
        `resend:${id}:${row.link_version}`,
      );
    } else if (op === "external-paid") {
      if (
        row.payment_method !== "external" ||
        row.payment_status !== "pending" ||
        input.confirm !== true
      )
        R.fail("Confirma el pago externo pendiente");
      const reference = R.clean(input.reference, 500);
      if (!reference) R.fail("Indica la referencia de pago");
      await termsSnapshot(c, row);
      Object.assign(
        row,
        (
          await c.query(
            "UPDATE partner_clients SET payment_status='paid',payment_reference=$2,payment_verified_by=$3,payment_verified_at=NOW(),form_status='invited',updated_at=NOW() WHERE id=$1 RETURNING *",
            [id, reference, actor.id],
          )
        ).rows[0],
      );
      await enqueue(c, row, "invite", `paid:${id}`);
    } else if (op === "stripe-verify") {
      if (row.payment_method !== "stripe" || row.payment_status !== "pending")
        R.fail("No hay un pago Stripe pendiente", 409);
      const sessionId = R.clean(input.session_id || row.stripe_session_id, 200);
      if (!/^cs_/.test(sessionId))
        R.fail("Indica el ID de la sesión de Checkout");
      const session =
        await require("./stripe.service").retrieveCheckoutSession(sessionId);
      if (
        session.id !== sessionId ||
        session.mode !== "payment" ||
        session.currency !== "usd" ||
        session.amount_total !== row.amount_cents ||
        session.payment_status !== "paid" ||
        !session.payment_intent ||
        (
          session.customer_details?.email ||
          session.customer_email ||
          ""
        ).toLowerCase() !== row.email ||
        (session.metadata?.purchase_type &&
          session.metadata.purchase_type !== "partner") ||
        (session.metadata?.partner_id && session.metadata.partner_id !== row.id)
      )
        R.fail("El pago no coincide con este cliente y su acuerdo", 409);
      await termsSnapshot(c, row);
      Object.assign(
        row,
        (
          await c.query(
            "UPDATE partner_clients SET stripe_session_id=$2,stripe_payment_intent=$3,payment_status='paid',payment_verified_by=$4,payment_verified_at=NOW(),form_status='invited',updated_at=NOW() WHERE id=$1 RETURNING *",
            [
              id,
              session.id,
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent.id,
              actor.id,
            ],
          )
        ).rows[0],
      );
      await enqueue(c, row, "invite", `paid:${id}`);
    } else if (op === "corrections") {
      if (!["submitted", "ready"].includes(row.form_status) || row.activated_at)
        R.fail("El formulario no admite correcciones");
      const note = R.clean(input.note, 5000);
      if (!note) R.fail("Indica los cambios solicitados");
      await c.query(
        "UPDATE partner_clients SET form_status='changes_requested',updated_at=NOW() WHERE id=$1",
        [id],
      );
      await enqueue(
        c,
        row,
        "changes",
        `changes:${id}:${row.submission_version}`,
        note,
      );
    } else if (op === "ready") {
      if (
        !["admin", "editor", "executive"].includes(actor.role) ||
        row.form_status !== "submitted"
      )
        R.fail("Primero revisa un formulario enviado");
      await c.query(
        "UPDATE partner_clients SET form_status='ready',updated_at=NOW() WHERE id=$1",
        [id],
      );
    } else if (op === "activate") {
      if (!["admin", "editor"].includes(actor.role))
        R.fail("Solo un editor o administrador puede activar", 403);
      if (
        row.activated_at ||
        row.form_status !== "ready" ||
        row.payment_status === "pending"
      )
        R.fail("Revisa el pago, la aprobación y la activación previa", 409);
      const exp = (
        await c.query("SELECT * FROM experiences WHERE id=$1", [
          R.clean(input.experience_id, 120),
        ])
      ).rows[0];
      if (!exp || !exp.is_published || exp.access !== "premium")
        R.fail("Vincula una experiencia premium publicada");
      const validators = require("../controllers/experiences.controller");
      const images = [
        exp.image_url,
        ...(Array.isArray(exp.gallery_urls) ? exp.gallery_urls : []),
      ].filter(Boolean);
      const invalid =
        validators.validateGallery(
          { images, access: "premium", isPublished: true },
          true,
        ) ||
        validators.validateMemberBenefit(
          {
            memberBenefit: exp.member_benefit,
            benefitAction: exp.benefit_action,
            benefitUrl: exp.benefit_url,
            couponInventoryMode: exp.coupon_inventory_mode,
            couponTotal: exp.coupon_total,
            couponPerUser: exp.coupon_per_user,
          },
          true,
        );
      if (invalid || !["qr", "external"].includes(exp.benefit_action))
        R.fail(invalid || "Configura el canje QR o enlace de la experiencia");
      const starts = new Date(),
        ends = R.addSixMonths(starts);
      await c.query(
        "UPDATE partner_clients SET experience_id=$2,activated_at=$3,expires_at=$4,updated_at=NOW() WHERE id=$1",
        [id, exp.id, starts, ends],
      );
      await c.query(
        "INSERT INTO partner_periods(client_id,starts_at,ends_at,amount_cents,reference,actor_id) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          starts,
          ends,
          row.amount_cents,
          row.payment_reference ||
            row.stripe_payment_intent ||
            "Strategic Partner",
          actor.id,
        ],
      );
      await enqueue(c, row, "published", `published:${id}`, "", {
        preview: exp,
        url: `${mail.BASE()}/business/${encodeURIComponent(exp.id)}`,
      });
    } else if (op === "note") {
      const note = R.clean(input.note, 10000);
      if (!note) R.fail("Escribe una nota");
      await activity(c, row, actor, "note", note);
    } else if (op === "followup") {
      if (
        !["pending", "contacted", "negotiating", "renewed"].includes(
          input.status,
        )
      )
        R.fail("Estado inválido");
      if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date))
        R.fail("Fecha inválida");
      await c.query(
        "UPDATE partner_clients SET renewal_status=$2,next_followup=$3,updated_at=NOW() WHERE id=$1",
        [id, input.status, input.date || null],
      );
    } else if (op === "renew") {
      if (!row.activated_at || input.confirm !== true)
        R.fail("Confirma la renovación acordada");
      const amount = Number(input.amount_cents),
        reference = R.clean(input.reference, 500);
      if (
        !Number.isInteger(amount) ||
        amount < 0 ||
        amount > 100000000 ||
        !reference
      )
        R.fail("Indica importe y referencia del acuerdo");
      const start = new Date(
          Math.max(Date.now(), new Date(row.expires_at).getTime()),
        ),
        end = R.addSixMonths(start);
      await c.query(
        "INSERT INTO partner_periods(client_id,starts_at,ends_at,amount_cents,reference,actor_id) VALUES($1,$2,$3,$4,$5,$6)",
        [id, start, end, amount, reference, actor.id],
      );
      await c.query(
        "UPDATE partner_clients SET expires_at=$2,renewal_status='renewed',next_followup=NULL,updated_at=NOW() WHERE id=$1",
        [id, end],
      );
    } else if (op === "assign") {
      if (actor.role !== "admin")
        R.fail("Solo el administrador puede reasignar", 403);
      const who = (
        await c.query(
          "SELECT id FROM admins WHERE id=$1 AND is_active AND role IN ('admin','executive')",
          [Number(input.owner_id)],
        )
      ).rows[0];
      if (!who) R.fail("Ejecutivo inválido");
      await c.query(
        "UPDATE partner_clients SET owner_id=$2,updated_at=NOW() WHERE id=$1",
        [id, who.id],
      );
    } else if (op === "contact") {
      const name = R.clean(input.contact_name, 150),
        business = R.clean(input.business_name, 200);
      if (!name || !business) R.fail("Completa negocio y contacto");
      await c.query(
        "UPDATE partner_clients SET business_name=$2,contact_name=$3,phone=$4,language=$5,updated_at=NOW() WHERE id=$1",
        [
          id,
          business,
          name,
          R.clean(input.phone, 60),
          R.language(input.language),
        ],
      );
    } else if (op === "retry-email") {
      await c.query(
        "UPDATE partner_mail SET attempts=0 WHERE client_id=$1 AND status='failed'",
        [id],
      );
      /* El envío se reintenta después de confirmar la transacción. */
    } else R.fail("Acción desconocida");
    if (op !== "note")
      await activity(
        c,
        row,
        actor,
        op,
        R.clean(input.note || input.reference, 5000),
      );
    return id;
  });
  await sendPending(result);
  return detail(id, actor);
}
async function publicView(token) {
  const row = await fromToken(token);
  if (row.form_status === "not_sent")
    R.fail("La invitación aún no está disponible", 403);
  const files = (
    await db.query(
      "SELECT id,kind,name,mime,size FROM partner_files WHERE client_id=$1 ORDER BY created_at",
      [row.id],
    )
  ).rows;
  return {
    business_name: row.business_name,
    contact_name: row.contact_name,
    language: row.language,
    category: row.category,
    offer: row.offer,
    amount_cents: row.amount_cents,
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    form_status: row.form_status,
    terms: row.terms_snapshot,
    owner: await owner(db, row),
    content:
      row.payment_status === "pending"
        ? {}
        : {
            contactName: row.contact_name,
            businessPhone: row.phone,
            businessEmail: row.email,
            ...row.content,
          },
    files: row.payment_status === "pending" ? [] : files,
  };
}
function editable(row) {
  if (
    row.payment_status === "pending" ||
    !["invited", "draft", "changes_requested"].includes(row.form_status) ||
    row.activated_at
  )
    R.fail("El formulario no está disponible para editar", 409);
}
async function save(token, input, submit = false) {
  const id = await transaction(async (c) => {
    const row = await fromToken(token, c, true);
    editable(row);
    const data = R.content(input.content, submit),
      lang = R.language(input.language);
    if (submit) {
      if (input.accept !== true || input.authorize !== true)
        R.fail("Acepta los términos y autoriza el uso del material");
      if (!row.terms_snapshot[lang])
        R.fail("Faltan los términos aprobados", 409);
      const files = (
        await c.query(
          "SELECT kind,bytes FROM partner_files WHERE client_id=$1",
          [row.id],
        )
      ).rows;
      if (
        !files.some((f) => f.kind === "logo") ||
        new Set(
          files.filter((f) => f.kind === "photo").map((f) => R.hash(f.bytes)),
        ).size < 4
      )
        R.fail("Adjunta el logo y al menos cuatro fotografías diferentes");
      await c.query(
        "INSERT INTO partner_acceptances(client_id,stage,language,signer_name,signer_email,document,material_authorized,submission_version) VALUES($1,'submission',$2,$3,$4,$5,TRUE,$6)",
        [
          row.id,
          lang,
          data.signerName,
          row.email,
          JSON.stringify({
            ...row.terms_snapshot[lang],
            materialAuthorization: require("./partner-public-copy")
              .authorization[lang],
          }),
          row.submission_version + 1,
        ],
      );
    }
    await c.query(
      `UPDATE partner_clients SET content=$2,language=$3,form_status=$4,submitted_at=CASE WHEN $5 THEN NOW() ELSE submitted_at END,submission_version=submission_version+CASE WHEN $5 THEN 1 ELSE 0 END,updated_at=NOW() WHERE id=$1`,
      [
        row.id,
        JSON.stringify(data),
        lang,
        submit
          ? "submitted"
          : row.form_status === "changes_requested"
            ? "changes_requested"
            : "draft",
        submit,
      ],
    );
    if (submit) {
      row.language = lang;
      await activity(c, row, null, "submitted");
      await enqueue(
        c,
        row,
        "received",
        `received:${row.id}:${row.submission_version + 1}`,
      );
      const who = await owner(c, row);
      await mail.queue(c, {
        key: `executive:${row.id}:${row.submission_version + 1}`,
        clientId: row.id,
        to: who.email,
        kind: "executive",
        data: {
          client: row,
          owner: who,
          language: who.language,
          url: `${mail.PANEL()}/clientes/${row.id}`,
        },
      });
    }
    return row.id;
  });
  if (submit) await sendPending(id);
  return publicView(token);
}
async function acceptCommercial(c, row, input) {
  const lang = R.language(input.language),
    name = R.clean(input.signerName, 150);
  if (input.accept !== true || !name || !row.terms_snapshot[lang])
    R.fail("Acepta el acuerdo e indica tu nombre");
  await c.query(
    "INSERT INTO partner_acceptances(client_id,stage,language,signer_name,signer_email,document) VALUES($1,'commercial',$2,$3,$4,$5)",
    [row.id, lang, name, row.email, JSON.stringify(row.terms_snapshot[lang])],
  );
  await c.query("UPDATE partner_clients SET language=$2 WHERE id=$1", [
    row.id,
    lang,
  ]);
}
async function checkout(token, input) {
  return transaction(async (c) => {
    const row = await fromToken(token, c, true);
    if (
      row.form_status === "not_sent" ||
      row.payment_method !== "stripe" ||
      row.payment_status !== "pending"
    )
      R.fail("No hay un pago pendiente por Stripe", 409);
    await acceptCommercial(c, row, input);
    const stripe = require("./stripe.service");
    if (row.stripe_session_id) {
      const existing = await stripe.retrieveCheckoutSession(
        row.stripe_session_id,
      );
      if (existing.status === "open") return { url: existing.url };
      if (existing.payment_status === "paid")
        R.fail("El pago está en verificación; actualiza su estado", 409);
    }
    const session = await stripe.createPartnerCheckout({
      row,
      returnUrl: link(row),
      key: `partner:${row.id}:${row.link_version}:${row.stripe_session_id || "first"}`,
    });
    await c.query(
      "UPDATE partner_clients SET stripe_session_id=$2 WHERE id=$1",
      [row.id, session.id],
    );
    return { url: session.url };
  });
}
async function confirmPayment(session) {
  if (session.metadata?.purchase_type !== "partner") return false;
  const id = session.metadata.partner_id;
  await transaction(async (c) => {
    const row = await get(c, id, null, true);
    if (
      row.payment_method !== "stripe" ||
      session.id !== row.stripe_session_id ||
      session.mode !== "payment" ||
      session.currency !== "usd" ||
      session.amount_total !== row.amount_cents ||
      session.payment_status !== "paid" ||
      !session.payment_intent
    )
      R.fail("El pago no coincide con el acuerdo", 409);
    if (row.payment_status === "paid") return;
    await c.query(
      "UPDATE partner_clients SET payment_status='paid',stripe_payment_intent=$2,payment_verified_at=NOW(),updated_at=NOW() WHERE id=$1",
      [
        id,
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent.id,
      ],
    );
    await activity(c, row, null, "stripe-paid");
    await enqueue(c, row, "invite", `paid:${id}`);
  });
  await sendPending(id);
  return true;
}
async function sync(token) {
  const row = await fromToken(token);
  if (
    row.payment_method === "stripe" &&
    row.payment_status === "pending" &&
    row.stripe_session_id
  ) {
    const session = await require("./stripe.service").retrieveCheckoutSession(
      row.stripe_session_id,
    );
    if (session.payment_status === "paid") await confirmPayment(session);
  }
  return publicView(token);
}
async function filePut(token, file, kind) {
  return transaction(async (c) => {
    const row = await fromToken(token, c, true);
    editable(row);
    if (!file || !["logo", "photo"].includes(kind))
      R.fail("Selecciona un logo o una fotografía");
    const mime = R.imageMime(file.buffer);
    if (!mime) R.fail("Usa PNG, JPEG o WebP");
    const stats = (
      await c.query(
        "SELECT COUNT(*)::int AS count,COALESCE(SUM(size),0)::int AS size FROM partner_files WHERE client_id=$1",
        [row.id],
      )
    ).rows[0];
    if (stats.count >= 13 || stats.size + file.size > 40 * 1024 * 1024)
      R.fail("Máximo 13 archivos y 40 MB por cliente");
    const exists = (
      await c.query("SELECT bytes,kind FROM partner_files WHERE client_id=$1", [
        row.id,
      ])
    ).rows;
    if (exists.some((f) => R.hash(f.bytes) === R.hash(file.buffer)))
      R.fail("Este archivo ya fue adjuntado");
    if (kind === "logo" && exists.some((f) => f.kind === "logo"))
      R.fail("Elimina el logo anterior primero");
    return (
      await c.query(
        "INSERT INTO partner_files(client_id,kind,name,mime,size,bytes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,kind,name,mime,size",
        [
          row.id,
          kind,
          require("path")
            .basename(file.originalname.replace(/\\/g, "/"))
            .replace(/[\x00-\x1f]/g, "")
            .slice(0, 180),
          mime,
          file.size,
          file.buffer,
        ],
      )
    ).rows[0];
  });
}
async function fileDelete(token, id) {
  return transaction(async (c) => {
    const row = await fromToken(token, c, true);
    editable(row);
    await c.query("DELETE FROM partner_files WHERE id=$1 AND client_id=$2", [
      id,
      row.id,
    ]);
    return { ok: true };
  });
}
async function fileGet(clientId, id, actor, token) {
  const row = token ? await fromToken(token) : await get(db, clientId, actor);
  if (token && row.payment_status === "pending") R.fail("Sin acceso", 403);
  if (!/^[\da-f-]{36}$/i.test(id || "")) R.fail("Archivo no encontrado", 404);
  const file = (
    await db.query("SELECT * FROM partner_files WHERE client_id=$1 AND id=$2", [
      row.id,
      id,
    ])
  ).rows[0];
  if (!file) R.fail("Archivo no encontrado", 404);
  return file;
}
module.exports = {
  transaction,
  get,
  list,
  detail,
  create,
  action,
  publicView,
  save,
  checkout,
  sync,
  confirmPayment,
  filePut,
  fileDelete,
  fileGet,
  link,
  fromToken,
  manage,
  sendPending,
};
