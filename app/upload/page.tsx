"use client";

import { useState, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ videoId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateUploadUrl = useMutation(api.videos.generateUploadUrl);
  const createVideo = useMutation(api.videos.createVideo);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setProgress("Getting upload URL...");
    setError(null);

    try {
      // Step 1: Get upload URL from Convex
      const uploadUrl = await generateUploadUrl();

      // Step 2: Upload file to Convex storage
      setProgress("Uploading file...");
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const { storageId } = await response.json();

      // Step 3: Create video record
      setProgress("Creating video record...");
      const videoId = await createVideo({
        filename: file.name,
        storageId,
      });

      setResult({ videoId });
      setProgress("Done!");
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setProgress("");
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Upload Video</h1>

        <div className="bg-slate-100 dark:bg-slate-800 p-6 rounded-xl">
          {/* File Input */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              Select video file
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              disabled={uploading}
              className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-500 file:text-white hover:file:bg-blue-600 file:cursor-pointer"
            />
          </div>

          {/* Selected file info */}
          {file && (
            <div className="mb-4 p-3 bg-white dark:bg-slate-900 rounded-lg text-sm">
              <p><strong>File:</strong> {file.name}</p>
              <p><strong>Size:</strong> {(file.size / 1024 / 1024).toFixed(2)} MB</p>
              <p><strong>Type:</strong> {file.type}</p>
            </div>
          )}

          {/* Upload button */}
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full py-3 px-4 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>

          {/* Progress */}
          {progress && (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
              {progress}
            </p>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Success */}
          {result && (
            <div className="mt-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm">
              <p className="font-medium">Upload successful!</p>
              <p className="mt-1 font-mono text-xs break-all">
                Video ID: {result.videoId}
              </p>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-8 text-sm text-slate-600 dark:text-slate-400">
          <h2 className="font-medium text-slate-900 dark:text-slate-100 mb-2">
            Next steps after upload:
          </h2>
          <ol className="list-decimal list-inside space-y-1">
            <li>Extract frames: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">extractFrames</code></li>
            <li>Analyze frames: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">analyzeVideoFrames</code></li>
            <li>Transcribe: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">transcribeVideo</code></li>
            <li>Generate embeddings: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">embedVideoFrames</code></li>
            <li>Search!</li>
          </ol>
        </div>
      </div>
    </main>
  );
}
