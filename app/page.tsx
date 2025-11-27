"use client";

import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export default function Home() {
  const videos = useQuery(api.videos.listVideos);

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Video Finder</h1>

        <div className="bg-slate-100 dark:bg-slate-800 p-6 rounded-xl mb-8">
          <h2 className="text-xl font-semibold mb-4">Backend Status</h2>
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            The Convex backend is set up for video processing experiments.
            Use the Convex Dashboard to test individual functions.
          </p>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-lg">
              <h3 className="font-medium mb-2">Processing Functions</h3>
              <ul className="text-slate-600 dark:text-slate-400 space-y-1">
                <li>• claudeVision.analyzeFrame</li>
                <li>• transcription.transcribeVideo</li>
                <li>• embeddings.embedText</li>
                <li>• embeddings.embedImage</li>
              </ul>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-lg">
              <h3 className="font-medium mb-2">Search Functions</h3>
              <ul className="text-slate-600 dark:text-slate-400 space-y-1">
                <li>• search.hybridSearch</li>
                <li>• search.simpleTextSearch</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="bg-slate-100 dark:bg-slate-800 p-6 rounded-xl">
          <h2 className="text-xl font-semibold mb-4">
            Videos ({videos?.length ?? 0})
          </h2>
          {videos === undefined ? (
            <p className="text-slate-500">Loading...</p>
          ) : videos.length === 0 ? (
            <p className="text-slate-500">
              No videos uploaded yet. Use the Convex Dashboard to upload test videos.
            </p>
          ) : (
            <div className="grid gap-4">
              {videos.map((video) => (
                <div
                  key={video._id}
                  className="bg-white dark:bg-slate-900 p-4 rounded-lg"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{video.filename}</p>
                      <p className="text-sm text-slate-500">
                        Status: {video.status}
                      </p>
                    </div>
                    {video.processingSteps && (
                      <div className="text-xs text-slate-500 space-y-1">
                        <p>
                          Frames:{" "}
                          {video.processingSteps.framesExtracted ? "✓" : "○"}
                        </p>
                        <p>
                          Analyzed:{" "}
                          {video.processingSteps.framesAnalyzed ? "✓" : "○"}
                        </p>
                        <p>
                          Transcribed:{" "}
                          {video.processingSteps.transcribed ? "✓" : "○"}
                        </p>
                        <p>
                          Embedded:{" "}
                          {video.processingSteps.embedded ? "✓" : "○"}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
