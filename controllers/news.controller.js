const { listNews, getNews, SECTIONS } = require("../services/news.service");

// Envía el error con su status propio (400/404/502) en vez de caer al 500 genérico.
function fail(res, err) {
  const status = err && err.status ? err.status : 500;
  return res.status(status).json({ success: false, message: err.message });
}

const list = async (req, res) => {
  try {
    const { section, page, perPage } = req.query;
    if (!section) {
      return res.status(400).json({
        success: false,
        message: `Falta 'section'. Válidas: ${Object.keys(SECTIONS).join(", ")}`,
      });
    }
    const data = await listNews({ section, page, perPage });
    res.json({ success: true, ...data });
  } catch (err) {
    fail(res, err);
  }
};

const getOne = async (req, res) => {
  try {
    const article = await getNews(req.params.id);
    res.json({ success: true, article });
  } catch (err) {
    fail(res, err);
  }
};

const sections = (req, res) => {
  res.json({ success: true, sections: Object.keys(SECTIONS) });
};

module.exports = { list, getOne, sections };
