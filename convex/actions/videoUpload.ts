"use node";
/**
 * Video Upload Actions
 *
 * Functions for uploading videos from external URLs to Convex storage.
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";

/**
 * Upload a video from a URL to Convex storage
 */
export const uploadFromUrl = action({
  args: {
    url: v.string(),
    filename: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    videoId?: string;
    error?: string;
  }> => {
    try {
      console.log(`[VideoUpload] Fetching video from: ${args.url}`);

      // Fetch the video from the URL
      const response = await fetch(args.url);

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to fetch video: ${response.status} ${response.statusText}`,
        };
      }

      // Get content type and validate it's a video
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.startsWith("video/") && !contentType.includes("octet-stream")) {
        console.log(`[VideoUpload] Content-Type: ${contentType}`);
        // Allow it anyway for flexibility, but log warning
        console.warn(`[VideoUpload] Warning: Content-Type "${contentType}" may not be a video`);
      }

      // Extract filename from URL or use provided one
      let filename = args.filename;
      if (!filename) {
        const urlPath = new URL(args.url).pathname;
        filename = urlPath.split("/").pop() || "video";
        // Ensure it has an extension
        if (!filename.includes(".")) {
          // Try to infer from content-type
          const ext = contentType.includes("mp4")
            ? ".mp4"
            : contentType.includes("webm")
              ? ".webm"
              : contentType.includes("mov")
                ? ".mov"
                : ".mp4";
          filename += ext;
        }
      }

      console.log(`[VideoUpload] Filename: ${filename}`);

      // Get the video data as a blob
      const videoBlob = await response.blob();
      console.log(`[VideoUpload] Downloaded ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`);

      // Upload to Convex storage
      const storageId = await ctx.storage.store(videoBlob);
      console.log(`[VideoUpload] Stored with ID: ${storageId}`);

      // Create the video record
      const videoId = await ctx.runMutation(api.videos.createVideo, {
        filename,
        storageId,
      });

      console.log(`[VideoUpload] Created video record: ${videoId}`);

      return {
        success: true,
        videoId,
      };
    } catch (error) {
      console.error("[VideoUpload] Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Upload multiple videos from URLs
 */
export const uploadMultipleFromUrls = action({
  args: {
    videos: v.array(
      v.object({
        url: v.string(),
        filename: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{
    results: Array<{
      url: string;
      success: boolean;
      videoId?: string;
      error?: string;
    }>;
  }> => {
    const results: Array<{
      url: string;
      success: boolean;
      videoId?: string;
      error?: string;
    }> = [];

    for (const video of args.videos) {
      // Fetch the video
      const fetchResult = await fetchVideoFromUrl(video.url, video.filename);

      if ("error" in fetchResult) {
        results.push({
          url: video.url,
          success: false,
          error: fetchResult.error,
        });
        continue;
      }

      // Store and create record
      try {
        const storageId = await ctx.storage.store(fetchResult.blob);
        const videoId = await ctx.runMutation(api.videos.createVideo, {
          filename: fetchResult.filename,
          storageId,
        });
        results.push({
          url: video.url,
          success: true,
          videoId: videoId as string,
        });
      } catch (error) {
        results.push({
          url: video.url,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { results };
  },
});

/**
 * Internal helper to fetch and process video from URL
 */
async function fetchVideoFromUrl(url: string, filename?: string): Promise<{
  blob: Blob;
  filename: string;
} | { error: string }> {
  try {
    console.log(`[VideoUpload] Fetching video from: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      return {
        error: `Failed to fetch video: ${response.status} ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("video/") && !contentType.includes("octet-stream")) {
      console.warn(`[VideoUpload] Warning: Content-Type "${contentType}" may not be a video`);
    }

    let resolvedFilename = filename;
    if (!resolvedFilename) {
      const urlPath = new URL(url).pathname;
      resolvedFilename = urlPath.split("/").pop() || "video";
      if (!resolvedFilename.includes(".")) {
        const ext = contentType.includes("mp4")
          ? ".mp4"
          : contentType.includes("webm")
            ? ".webm"
            : contentType.includes("mov")
              ? ".mov"
              : ".mp4";
        resolvedFilename += ext;
      }
    }

    console.log(`[VideoUpload] Filename: ${resolvedFilename}`);

    const videoBlob = await response.blob();
    console.log(`[VideoUpload] Downloaded ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`);

    return {
      blob: videoBlob,
      filename: resolvedFilename,
    };
  } catch (error) {
    console.error("[VideoUpload] Error:", error);
    return {
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
