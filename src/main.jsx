import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import "./theme.css";
import { captureNotificationFromLocation } from "./utils/pushNavigation";

// Cold start from a tapped push notification (?n=<id>): remember the id; the app opens it after sign-in.
captureNotificationFromLocation();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
