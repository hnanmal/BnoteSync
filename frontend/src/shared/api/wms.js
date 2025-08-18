import { api } from "./index";

export const ingestWms = async (payload) => {
  const { data } = await api.post("/wms/ingest", payload);
  return data;
};

export const listBatches = async () => {
  const { data } = await api.get("/wms/batches");
  return data;
};

export const previewBatch = async (batchId, { limit, offset = 0 } = {}) => {
  const params = {};
  if (limit != null) params.limit = limit; // ✅ undefined/null 이면 안 보냄 → 전체 반환
  if (offset) params.offset = offset;
  const { data } = await api.get(`/wms/batches/${batchId}/preview`, { params });
  return data;
};


export const validateBatch = async (batchId, required_fields) => {
  const { data } = await api.post(`/wms/batches/${batchId}/validate`, { required_fields });
  return data;
};

export const listErrors = async (batchId) => {
  const { data } = await api.get(`/wms/batches/${batchId}/errors`);
  return data;
};


export const uploadExcel = async ({ file, source, project_id, sheet, dry_run=false }) => {
  const form = new FormData();
  form.append("file", file);
  if (source) form.append("source", source);
  if (project_id != null) form.append("project_id", String(project_id));
  if (sheet) form.append("sheet", sheet);
  form.append("dry_run", String(dry_run));
  const { data } = await api.post("/wms/upload-excel", form, { headers: { "Content-Type": "multipart/form-data" }});
  return data;
};


export const deleteBatch = async (batchId) => {
  const { data } = await api.delete(`/wms/batches/${batchId}`);
  return data; // { deleted: true, batch_id }
};

// --- StdGWM용 신규 함수들 ---
export const listWmsItems = async ({ sources, search, limit, offset = 0, order = "asc" } = {}) => {
  const params = {};
  if (sources?.length) params.sources = sources.join(",");
  if (search) params.search = search;
  if (Number.isFinite(limit)) params.limit = limit;
  if (offset) params.offset = offset;
  if (order) params.order = order;           // ✅ asc|desc
  return (await api.get("/wms/items", { params })).data;
};

// export const listWmsItems = async ({ sources, search, limit, offset = 0 } = {}) => {
//   const params = {};
//   if (sources?.length) params.sources = sources.join(",");
//   if (search) params.search = search;
//   // if (limit != null) params.limit = limit;
//   if (Number.isFinite(limit)) params.limit = limit;
//   if (offset) params.offset = offset;
//   return (await api.get("/wms/items", { params })).data;
// };

// export async function listWmsItems({ sources, search, limit }) {
//   const params = {
//     sources,
//     ...(search ? { search } : {}),
//     // ✅ number일 때만 전송 (ALL이면 undefined라서 빠짐)
//     ...(Number.isFinite(limit) ? { limit } : {}),
//   };
//   const { data } = await axiosInstance.get("/wms/items", { params });
//   return data;
// }

export const listLinks = async ({ rid, uid, order = "asc" }) =>
  (await api.get("/wms/links", { params: { rid, uid, order } })).data;

// export const listLinks = async ({ rid, uid }) =>
//   (await api.get("/wms/links", { params: { std_release_id: rid, std_node_uid: uid } })).data;

export const assignLinks = async ({ rid, uid, row_ids }) =>
  (await api.post("/wms/links/assign", { std_release_id: rid, std_node_uid: uid, row_ids })).data;

export const unassignLinks = async ({ rid, uid, row_ids }) =>
  (await api.post("/wms/links/unassign", { std_release_id: rid, std_node_uid: uid, row_ids })).data;