// Best-effort per-instance protection. Tokens remain random, expiring and revocable.
module.exports = function rateLimit(max = 60) {
  const attempts = new Map();
  return (req, _res, next) => {
    const key = req.ip,
      now = Date.now();
    let value = attempts.get(key);
    if (!value || value.until < now) value = { count: 0, until: now + 60000 };
    value.count++;
    attempts.set(key, value);
    if (attempts.size > 5000)
      for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    if (value.count > max)
      return next(
        Object.assign(new Error("Espera un momento e inténtalo de nuevo"), {
          status: 429,
        }),
      );
    next();
  };
};
