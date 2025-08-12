import { api } from "./index";

export const listStdReleases = async () => {
  const { data } = await api.get("/std/releases");
  return data; // [{id, version}, ...]
};

export const getStdTree = async (releaseId) => {
  const { data } = await api.get(`/std/releases/${releaseId}/tree`);
  return data; // [{ std_node_uid, name, children: [...] }, ...]
};
