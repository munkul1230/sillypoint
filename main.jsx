import React from "react";
import { createRoot } from "react-dom/client";
import CricketAnalytics from "./CricketAnalytics.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <CricketAnalytics />
  </React.StrictMode>
);
