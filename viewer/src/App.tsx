import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/Home";
import { SearchPage } from "./pages/Search";
import { EntryPage } from "./pages/Entry";
import { WritePage } from "./pages/Write";
import { ProjectsPage } from "./pages/Projects";
import { StatsPage } from "./pages/Stats";
import { useT } from "./i18n";

const GraphPage = lazy(() =>
  import("./pages/Graph").then((m) => ({ default: m.GraphPage })),
);

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/entry/:id" element={<EntryPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/write" element={<WritePage />} />
        <Route
          path="/graph"
          element={
            <Suspense fallback={<GraphLoading />}>
              <GraphPage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  const t = useT();
  return (
    <div className="px-10 py-16">
      <div className="text-xs uppercase text-[var(--color-ink-faint)]">404</div>
      <h1 className="mt-2 text-3xl display-rule">{t("common.not_found")}</h1>
    </div>
  );
}

function GraphLoading() {
  const t = useT();
  return (
    <div className="px-10 py-16 text-xs text-[var(--color-ink-faint)]">
      {t("common.loading_graph")}
    </div>
  );
}
