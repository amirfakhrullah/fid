"use client";

import { Preloaded, usePreloadedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function ServerInner({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.videos.listVideos>;
}) {
  const videos = usePreloadedQuery(preloaded);

  return (
    <div className="bg-slate-100 dark:bg-slate-800 p-6 rounded-xl">
      <h2 className="text-xl font-semibold mb-4">
        Videos (Client Hydrated)
      </h2>
      <p className="text-sm text-slate-600 mb-4">
        {videos.length} videos loaded
      </p>
    </div>
  );
}
