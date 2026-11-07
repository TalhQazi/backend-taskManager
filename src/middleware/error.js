function notFoundHandler(_req, res) {
  res.status(404).json({ error: { message: "Not found" } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  let status = typeof err?.status === "number" ? err.status : 500;
  let message = err?.message || "Internal server error";

  if (err?.code === "LIMIT_FILE_SIZE") {
    status = 413;
    message = "Uploaded file exceeds maximum allowed size (1GB).";
  } else if (err?.type === "entity.too.large" || status === 413) {
    status = 413;
    message = "Request entity too large. Maximum payload size is 1GB.";
  }

  res.status(status).json({ error: { message } });
}

module.exports = { notFoundHandler, errorHandler };
