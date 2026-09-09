import React from "react";
import { trackClient } from "./app/analytics";
import { createRoot } from "react-dom/client";
import { initializeTheme } from "./app/theme-toggle";
import "./styles.css";
const App = React.lazy(() => import('./app/app').then(module => ({ default: module.App })));
const DocsApp = React.lazy(() => import('./app/documentation').then(module => ({ default: module.DocsApp })));
const GuideApp = React.lazy(() => import('./app/guide').then(module => ({ default: module.GuideApp })));
initializeTheme();

class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch() { void trackClient({ event: "client_error", errorCode: "unexpected_error", outcome: "error" }); }
  render() {
    return this.state.error ? (
      <main className="fatal-error">
        <h1>Something interrupted the studio.</h1>
        <p>{this.state.error}</p>
        <button onClick={() => location.reload()}>Reload the workspace</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <React.Suspense fallback={<main className="fatal-error" aria-busy="true">Opening the studio…</main>}>
        {location.pathname === '/docs' || location.pathname.startsWith('/docs/') ? <DocsApp /> : location.pathname === '/guide' || location.pathname === '/guide/' ? <GuideApp /> : <App />}
      </React.Suspense>
    </ErrorBoundary>
  </React.StrictMode>,
);
