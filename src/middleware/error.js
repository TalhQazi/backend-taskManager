function notFoundHandler(_req, res) {
  res.status(404).json({ error: { message: "Not found" } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  const status = typeof err?.status === "number" ? err.status : 500;
  const message = err?.message || "Internal server error";
  res.status(status).json({ error: { message } });
}

module.exports = { notFoundHandler, errorHandler };
