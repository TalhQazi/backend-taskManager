const axios = require("axios");

const ASANA_BASE_URL = "https://app.asana.com/api/1.0";

function createAsanaClient(token) {
  if (!token) {
    throw new Error("Asana token is required");
  }

  return axios.create({
    baseURL: ASANA_BASE_URL,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    timeout: 30000,
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllPaginated(client, path, params, opts) {
  const pageSize = opts?.pageSize ?? 100;
  const delayMs = opts?.delayMs ?? 450;

  const out = [];
  let offset = undefined;

  while (true) {
    const res = await client.get(path, {
      params: {
        ...params,
        limit: pageSize,
        offset,
      },
    });

    const data = res?.data;
    const items = Array.isArray(data?.data) ? data.data : [];
    out.push(...items);

    const nextOffset = data?.next_page?.offset;
    if (!nextOffset) break;

    offset = nextOffset;
    await sleep(delayMs);
  }

  return out;
}

module.exports = { createAsanaClient, fetchAllPaginated, sleep };
