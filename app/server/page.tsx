import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export default async function ServerPage() {
  const preloaded = await preloadQuery(api.videos.listVideos);
  const videos = preloadedQueryResult(preloaded);

  return (
    <main className="p-8 flex flex-col gap-6 mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold">Server-Side Rendered</h1>

      <div className="bg-slate-100 dark:bg-slate-800 p-6 rounded-xl">
        <h2 className="text-xl font-semibold mb-4">
          Videos (Server Loaded)
        </h2>
        <code className="bg-white dark:bg-slate-900 p-4 rounded-lg border block overflow-x-auto">
          <pre className="text-sm">
            {JSON.stringify(videos, null, 2)}
          </pre>
        </code>
      </div>
    </main>
  );
}
