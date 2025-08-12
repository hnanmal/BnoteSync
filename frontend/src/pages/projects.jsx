import { useParams } from "react-router-dom";
export default function ProjectPage() {
  const { id } = useParams();
  return <div className="p-4 bg-white rounded shadow">Project #{id} – 준비중</div>;
}
