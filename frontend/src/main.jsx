import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App.jsx";

import StandardsPage from "./pages/standards.jsx";
import ProjectPage from "./pages/projects.jsx";
import CalcPage from "./pages/calc.jsx";
import WmsPage from "./pages/wms.jsx";
import ReportingPage from "./pages/reporting.jsx";
import LoginPage from "./pages/login.jsx";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { path: "/standards", element: <StandardsPage /> },
      { path: "/projects/:id", element: <ProjectPage /> },
      { path: "/calc", element: <CalcPage /> },
      { path: "/wms", element: <WmsPage /> },
      { path: "/reporting", element: <ReportingPage /> },
      { path: "/auth/login", element: <LoginPage /> },
      { index: true, element: <StandardsPage /> },
    ],
  },
]);

const qc = new QueryClient();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
