import {createRoot} from "react-dom/client";
import {App} from "./App";
import "./index.css";

const container = document.getElementById("react-root");
if (container) createRoot(container).render(<App />);
