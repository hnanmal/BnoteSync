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
