import { api } from "./index";

export const ingestWms = async (payload) => {
  const { data } = await api.post("/wms/ingest", payload);
  return data;
};

export const listBatches = async () => {
  const { data } = await api.get("/wms/batches");
  return data;
};

export const previewBatch = async (batchId, { limit = 50, offset = 0 } = {}) => {
  const { data } = await api.get(`/wms/batches/${batchId}/preview`, { params: { limit, offset } });
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
