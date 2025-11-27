"use node";
/**
 * Frame Extraction Action
 *
 * Extracts frames from a video at regular intervals using FFmpeg.
 * Requires ffmpeg-static to be listed in convex.json externalPackages.
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import ffmpeg from "fluent-ffmpeg";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath = require("ffmpeg-static") as string;

// Set FFmpeg path
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

// Configuration
const FRAME_INTERVAL_SECONDS = 2; // Extract a frame every 2 seconds

/**
 * Extract frames from a video using FFmpeg
 */
export const extractFrames = action({
  args: {
    videoId: v.id("videos"),
    intervalSeconds: v.optional(v.number()), // Default: 2 seconds
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    frameCount?: number;
    error?: string;
  }> => {
    const interval = args.intervalSeconds ?? FRAME_INTERVAL_SECONDS;

    try {
      // Get video from database
      const video = await ctx.runQuery(api.videos.getVideo, {
        videoId: args.videoId,
      });

      if (!video) {
        return { success: false, error: "Video not found" };
      }

      if (!video.url) {
        return { success: false, error: "Video has no URL" };
      }

      console.log(`[FrameExtraction] Processing video: ${video.filename}`);
      console.log(`[FrameExtraction] Interval: ${interval}s`);

      // Create temp directory
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "frames-"));
      const videoPath = path.join(tempDir, "video.mp4");
      const framePattern = path.join(tempDir, "frame-%04d.jpg");

      try {
        // Download video to temp file
        console.log(`[FrameExtraction] Downloading video...`);
        const videoResponse = await fetch(video.url);
        if (!videoResponse.ok) {
          throw new Error(`Failed to download video: ${videoResponse.status}`);
        }
        const videoBuffer = await videoResponse.arrayBuffer();
        fs.writeFileSync(videoPath, Buffer.from(videoBuffer));
        console.log(`[FrameExtraction] Video downloaded: ${(videoBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

        // Extract frames using FFmpeg
        console.log(`[FrameExtraction] Extracting frames...`);
        await new Promise<void>((resolve, reject) => {
          ffmpeg(videoPath)
            .outputOptions([
              `-vf fps=1/${interval}`, // Extract 1 frame every N seconds
              "-q:v 2", // High quality JPEG
            ])
            .output(framePattern)
            .on("start", (cmd: string) => {
              console.log(`[FrameExtraction] FFmpeg command: ${cmd}`);
            })
            .on("progress", (progress: { percent?: number }) => {
              if (progress.percent) {
                console.log(`[FrameExtraction] Progress: ${progress.percent.toFixed(1)}%`);
              }
            })
            .on("end", () => {
              console.log(`[FrameExtraction] FFmpeg finished`);
              resolve();
            })
            .on("error", (err: Error) => {
              console.error(`[FrameExtraction] FFmpeg error:`, err);
              reject(err);
            })
            .run();
        });

        // Find extracted frames
        const frameFiles = fs.readdirSync(tempDir)
          .filter((f) => f.startsWith("frame-") && f.endsWith(".jpg"))
          .sort();

        console.log(`[FrameExtraction] Extracted ${frameFiles.length} frames`);

        // Upload frames and create records
        const frameRecords: Array<{ timestamp: number; storageId: string }> = [];

        for (let i = 0; i < frameFiles.length; i++) {
          const frameFile = frameFiles[i];
          const framePath = path.join(tempDir, frameFile);
          const timestamp = i * interval;

          // Read frame file
          const frameData = fs.readFileSync(framePath);
          const frameBlob = new Blob([frameData], { type: "image/jpeg" });

          // Upload to Convex storage
          const storageId = await ctx.storage.store(frameBlob);

          frameRecords.push({
            timestamp,
            storageId: storageId as string,
          });

          console.log(`[FrameExtraction] Uploaded frame ${i + 1}/${frameFiles.length} at ${timestamp}s`);
        }

        // Create frame records in batch
        if (frameRecords.length > 0) {
          await ctx.runMutation(api.frames.createFramesBatch, {
            frames: frameRecords.map((f) => ({
              videoId: args.videoId,
              timestamp: f.timestamp,
              storageId: f.storageId as Id<"_storage">,
            })),
          });
        }

        // Update processing step
        await ctx.runMutation(api.videos.updateProcessingStep, {
          videoId: args.videoId,
          step: "framesExtracted",
          value: true,
        });

        // Store video duration
        if (frameRecords.length > 0) {
          const estimatedDuration = (frameRecords.length - 1) * interval;
          await ctx.runMutation(api.videos.updateVideoDuration, {
            videoId: args.videoId,
            duration: estimatedDuration,
          });
        }

        return {
          success: true,
          frameCount: frameRecords.length,
        };
      } finally {
        // Cleanup temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error("[FrameExtraction] Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Store extracted frames (called after client-side extraction)
 */
export const storeExtractedFrames = action({
  args: {
    videoId: v.id("videos"),
    frames: v.array(
      v.object({
        timestamp: v.number(),
        storageId: v.id("_storage"),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Create frame records in batch
    await ctx.runMutation(api.frames.createFramesBatch, {
      frames: args.frames.map((f) => ({
        videoId: args.videoId,
        timestamp: f.timestamp,
        storageId: f.storageId,
      })),
    });

    // Update processing step
    await ctx.runMutation(api.videos.updateProcessingStep, {
      videoId: args.videoId,
      step: "framesExtracted",
      value: true,
    });

    return {
      success: true,
      frameCount: args.frames.length,
    };
  },
});

/**
 * Get recommended frame timestamps for a video duration
 */
export const getFrameTimestamps = action({
  args: {
    duration: v.number(), // Video duration in seconds
    intervalSeconds: v.optional(v.number()), // Override default interval
  },
  handler: async (_ctx, args) => {
    const interval = args.intervalSeconds ?? FRAME_INTERVAL_SECONDS;
    const frameCount = Math.ceil(args.duration / interval);
    const timestamps: number[] = [];

    for (let i = 0; i < frameCount; i++) {
      timestamps.push(i * interval);
    }

    return {
      intervalSeconds: interval,
      frameCount,
      timestamps,
    };
  },
});
