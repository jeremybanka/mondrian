import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { GuideApp } from "./GuideApp.tsx"
import "./globals.css"

const root = document.getElementById("root")
if (root === null) throw new Error("The guide needs a root element")
createRoot(root).render(
	<StrictMode>
		<GuideApp />
	</StrictMode>,
)
