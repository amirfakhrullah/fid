"use node";
/**
 * Video Processing Pipeline
 *
 * Internal actions that run automatically after video upload.
 * Scheduled by videos.createVideo mutation.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * Main processing pipeline - extracts frames after upload
 */
export const processVideo = action({
  args: {
    videoId: v.id("videos"),
  },
  handler: async (ctx, args) => {
    console.log(`[Processing] Starting processing for video: ${args.videoId}`);

    try {
      // Update status to processing
      await ctx.runMutation(api.videos.updateVideoStatus, {
        videoId: args.videoId,
        status: "processing",
      });

      // Step 1: Extract frames
      console.log(`[Processing] Extracting frames...`);
      const extractResult = await ctx.runAction(
        api.actions.frameExtraction.extractFrames,
        {
          videoId: args.videoId,
          intervalSeconds: 10, // 1 frame every 10 seconds
        }
      );

      if (!extractResult.success) {
        console.error(`[Processing] Frame extraction failed:`, extractResult.error);
        await ctx.runMutation(api.videos.updateVideoStatus, {
          videoId: args.videoId,
          status: "failed",
        });
        return;
      }

      console.log(`[Processing] Extracted ${extractResult.frameCount} frames`);

      // Update status to ready (frames extracted, ready for analysis)
      await ctx.runMutation(api.videos.updateVideoStatus, {
        videoId: args.videoId,
        status: "ready",
      });

      console.log(`[Processing] Video processing complete: ${args.videoId}`);
    } catch (error) {
      console.error(`[Processing] Error processing video:`, error);
      await ctx.runMutation(api.videos.updateVideoStatus, {
        videoId: args.videoId,
        status: "failed",
      });
    }
  },
});

/**
 * Full processing pipeline - extracts frames, analyzes, transcribes, embeds
 */
export const processVideoFull = action({
  args: {
    videoId: v.id("videos"),
  },
  handler: async (ctx, args) => {
    console.log(`[Processing] Starting FULL processing for video: ${args.videoId}`);

    try {
      // Update status to processing
      await ctx.runMutation(api.videos.updateVideoStatus, {
        videoId: args.videoId,
        status: "processing",
      });

      // Step 1: Extract frames
      console.log(`[Processing] Step 1: Extracting frames...`);
      const extractResult = await ctx.runAction(
        api.actions.frameExtraction.extractFrames,
        {
          videoId: args.videoId,
          intervalSeconds: 10, // 1 frame every 10 seconds
        }
      );

      if (!extractResult.success) {
        throw new Error(`Frame extraction failed: ${extractResult.error}`);
      }
      console.log(`[Processing] Extracted ${extractResult.frameCount} frames`);

      // Step 2: Transcribe video with Groq Whisper
      console.log(`[Processing] Step 2: Transcribing video...`);
      await ctx.runAction(api.actions.transcription.transcribeVideo, {
        videoId: args.videoId,
      });
      console.log(`[Processing] Transcription complete`);

      // Step 3: Analyze transcript with Groq Llama
      console.log(`[Processing] Step 3: Analyzing transcript with Groq...`);
      const analyzeResult = await ctx.runAction(
        api.actions.groqAnalysis.analyzeTranscript,
        {
          videoId: args.videoId,
        }
      );
      console.log(
        `[Processing] Analysis complete: ${analyzeResult.keywords.length} keywords, ${analyzeResult.categories.length} categories`
      );

      // Step 4: Generate embeddings (OpenAI Vision for frames, OpenAI for text)
      console.log(`[Processing] Step 4: Generating frame embeddings with OpenAI Vision...`);
      await ctx.runAction(api.actions.embeddings.embedVideoFrames, {
        videoId: args.videoId,
        embedImages: true,
        useOpenAIVision: true, // Use OpenAI Vision instead of CLIP (uses your credits, no rate limits)
      });

      console.log(`[Processing] Step 5: Generating text embeddings with OpenAI...`);
      await ctx.runAction(api.actions.embeddings.embedVideoText, {
        videoId: args.videoId,
      });
      console.log(`[Processing] All embeddings generated`);

      // Update status to ready
      await ctx.runMutation(api.videos.updateVideoStatus, {
        videoId: args.videoId,
        status: "ready",
      });

      console.log(`[Processing] FULL video processing complete: ${args.videoId}`);
    } catch (error) {
      console.error(`[Processing] Error in full processing:`, error);
      await ctx.runMutation(api.videos.updateVideoStatus, {
        videoId: args.videoId,
        status: "failed",
      });
    }
  },
});
