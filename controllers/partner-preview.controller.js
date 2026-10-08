const db = require("../config/db");
const { escape } = require("../services/membership-email.service");
module.exports = async (req, res, next) => {
  try {
    const row = (
      await db.query(
        "SELECT title,image_url,description,location,member_benefit FROM experiences WHERE id=$1 AND is_published=TRUE",
        [req.params.id],
      )
    ).rows[0];
    if (!row) return res.status(404).send("Profile not available");
    res
      .set(
        "Content-Security-Policy",
        "default-src 'none'; img-src https:; style-src 'unsafe-inline'",
      )
      .type("html")
      .send(
        `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(row.title)} · ITC CLUB</title><body style="margin:0;background:#0a0a0a;color:white;font-family:Arial;padding:24px"><main style="max-width:600px;margin:auto"><h1>ITC <span style="color:#FDDD56">CLUB</span></h1>${/^https:\/\//.test(row.image_url || "") ? `<img alt="${escape(row.title)}" src="${escape(row.image_url)}" style="width:100%;border-radius:16px">` : ""}<h2>${escape(row.title)}</h2><p>${escape(row.location || "")}</p><p style="color:#FDDD56">${escape(row.member_benefit || "")}</p><p style="white-space:pre-wrap">${escape(row.description || "")}</p><a style="display:inline-block;padding:16px;background:#FDDD56;color:#111;border-radius:12px;text-decoration:none" href="itcclub://experience-detail?id=${encodeURIComponent(req.params.id)}">Open in ITC CLUB</a></main></body></html>`,
      );
  } catch (e) {
    next(e);
  }
};
