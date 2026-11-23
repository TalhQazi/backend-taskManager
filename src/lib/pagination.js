/**
 * Standardized pagination helper for all list endpoints.
 */

/**
 * Parse pagination params from request query.
 * @param {object} query - req.query
 * @returns {{ page: number, limit: number, skip: number }}
 */
function parsePagination(query = {}) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const rawLimit = parseInt(query.limit) || 25;
  const maxAllowed = query.all === "true" || rawLimit > 100 ? 5000 : 100;
  const limit = Math.min(maxAllowed, Math.max(1, rawLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

/**
 * Build paginated response envelope.
 * @param {Array} items
 * @param {number} total
 * @param {number} page
 * @param {number} limit
 */
function paginatedResponse(items, total, page, limit) {
  return {
    items,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

module.exports = { parsePagination, paginatedResponse };
