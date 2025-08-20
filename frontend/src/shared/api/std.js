// src/shared/api/std.js
import { api } from "./index";

export const listStdReleases = async () => {
  const { data } = await api.get("/std/releases");
  return data; // [{ id, version }, ...]
};

// ✅ kind 쿼리 전달 지원
export const getStdTree = async (releaseId, { kind } = {}) => {
  const params = {};
  if (kind) params.kind = kind; // "GWM" | "SWM"
  const { data } = await api.get(`/std/releases/${releaseId}/tree`, { params });
  return data; // { children: [...] }
};

// ✅ 루트 생성 시에만 kind 전달(자식은 부모 상속)
export const createStdNode = async (rid, payload, { kind } = {}) => {
  const params = {};
  if (!payload?.parent_uid && kind) params.kind = kind; // 루트일 때만
  return (await api.post(`/std/releases/${rid}/nodes`, payload, { params })).data;
};

export const updateStdNode = async (rid, uid, payload) =>
  (await api.patch(`/std/releases/${rid}/nodes/${uid}`, payload)).data;

export const deleteStdNode = async (rid, uid) =>
  (await api.delete(`/std/releases/${rid}/nodes/${uid}`)).data;


// wms.js (추가)
export const listWmsItems = async ({ sources, search, limit, offset=0 } = {}) => {
  const params = {};
  if (sources?.length) params.sources = sources.join(",");
  if (search) params.search = search;
  if (limit != null) params.limit = limit;
  if (offset) params.offset = offset;
  return (await api.get("/wms/items", { params })).data;
};

export const listLinks = async ({ rid, uid }) =>
  (await api.get("/wms/links", { params: { std_release_id: rid, std_node_uid: uid } })).data;

export const assignLinks = async ({ rid, uid, row_ids }) =>
  (await api.post("/wms/links/assign", { std_release_id: rid, std_node_uid: uid, row_ids })).data;

export const unassignLinks = async ({ rid, uid, row_ids }) =>
  (await api.post("/wms/links/unassign", { std_release_id: rid, std_node_uid: uid, row_ids })).data;
