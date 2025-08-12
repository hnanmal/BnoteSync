export default function LoginPage() {
  return (
    <div className="p-6 bg-white rounded shadow w-full max-w-md">
      <h2 className="text-xl font-semibold mb-4">로그인</h2>
      <div className="space-y-3">
        <input className="w-full border rounded px-3 py-2" placeholder="Email" />
        <input className="w-full border rounded px-3 py-2" type="password" placeholder="Password" />
        <button className="px-4 py-2 rounded bg-blue-600 text-white">Sign in</button>
      </div>
    </div>
  );
}
