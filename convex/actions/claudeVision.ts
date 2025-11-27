"use node";
/**
 * Claude Vision Action
 *
 * Analyzes video frames using Claude's vision capabilities.
 * Extracts descriptions and keywords for semantic search.
 *
 * Required env var: ANTHROPIC_API_KEY
 */

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";

// Initialize Anthropic client
const getAnthropicClient = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }
  return new Anthropic({ apiKey });
};

// System prompt for frame analysis
const ANALYSIS_SYSTEM_PROMPT = `You are an expert at analyzing video frames for a video search system.
Your job is to extract detailed, searchable information from each frame.

For each frame, provide:
1. A concise description (1-2 sentences) of what's happening
2. A comprehensive list of keywords covering:
   - Objects visible (people, items, vehicles, etc.)
   - Colors (specific colors like "red shirt", "blue car")
   - Actions (walking, running, talking, etc.)
   - Setting/location (indoor, outdoor, office, park, etc.)
   - Attributes (tall, small, bright, dark, etc.)
   - Text visible (signs, labels, etc.)

Be thorough with keywords - they will be used for search matching.
Format keywords as lowercase, comma-separated values.`;

/**
 * Analyze a single frame with Claude Vision
 */
export const analyzeFrame = action({
  args: {
    frameId: v.id("frames"),
  },
  handler: async (ctx, args) => {
    // Get frame data
    const frame = await ctx.runQuery(api.frames.getFrame, {
      frameId: args.frameId,
    });

    if (!frame) {
      throw new Error(`Frame ${args.frameId} not found`);
    }

    if (!frame.url) {
      throw new Error(`Frame ${args.frameId} has no URL`);
    }

    // Fetch the image and convert to base64
    const imageResponse = await fetch(frame.url);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString("base64");

    // Determine media type from URL or default to jpeg
    const mediaType = frame.url.includes(".png") ? "image/png" : "image/jpeg";

    // Call Claude Vision API
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: "text",
              text: `Analyze this video frame (timestamp: ${frame.timestamp}s).

Respond in this exact JSON format:
{
  "description": "Brief description of what's happening",
  "keywords": ["keyword1", "keyword2", "keyword3", ...]
}`,
            },
          ],
        },
      ],
    });

    // Parse response
    const textContent = response.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude");
    }

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = textContent.text;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const analysis = JSON.parse(jsonStr.trim()) as {
      description: string;
      keywords: string[];
    };

    // Store analysis in database
    await ctx.runMutation(api.frames.updateFrameAnalysis, {
      frameId: args.frameId,
      description: analysis.description,
      keywords: analysis.keywords,
    });

    return {
      success: true,
      frameId: args.frameId,
      description: analysis.description,
      keywords: analysis.keywords,
    };
  },
});

/**
 * Analyze multiple frames for a video
 */
export const analyzeVideoFrames = action({
  args: {
    videoId: v.id("videos"),
    limit: v.optional(v.number()), // Max frames to analyze (for cost control)
  },
  handler: async (ctx, args) => {
    // Get unanalyzed frames
    const frames = await ctx.runQuery(api.frames.getFramesWithoutAnalysis, {
      videoId: args.videoId,
      limit: args.limit,
    });

    if (frames.length === 0) {
      return {
        success: true,
        message: "No frames to analyze",
        analyzed: 0,
      };
    }

    console.log(`[Claude Vision] Analyzing ${frames.length} frames...`);

    const results: Array<{
      frameId: string;
      success: boolean;
      error?: string;
    }> = [];

    // Process frames sequentially to avoid rate limits
    for (const frame of frames) {
      try {
        await ctx.runAction(api.actions.claudeVision.analyzeFrame, {
          frameId: frame._id,
        });
        results.push({ frameId: frame._id, success: true });
      } catch (error) {
        results.push({
          frameId: frame._id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    // Update processing step if all frames are now analyzed
    const remainingFrames = await ctx.runQuery(
      api.frames.getFramesWithoutAnalysis,
      { videoId: args.videoId }
    );

    if (remainingFrames.length === 0) {
      await ctx.runMutation(api.videos.updateProcessingStep, {
        videoId: args.videoId,
        step: "framesAnalyzed",
        value: true,
      });
    }

    return {
      success: true,
      analyzed: successCount,
      failed: results.length - successCount,
      results,
    };
  },
});

/**
 * Generate video summary from frame descriptions
 */
export const generateVideoSummary = action({
  args: {
    videoId: v.id("videos"),
  },
  handler: async (ctx, args): Promise<{ success: true; summary: string }> => {
    // Get all frames with descriptions
    const frames = await ctx.runQuery(api.frames.getFramesByVideo, {
      videoId: args.videoId,
    });

    type FrameType = (typeof frames)[number];
    const analyzedFrames: FrameType[] = frames.filter(
      (f: FrameType) => f.description
    );

    if (analyzedFrames.length === 0) {
      throw new Error("No analyzed frames available for summary");
    }

    // Build context from frame descriptions
    const frameDescriptions: string = analyzedFrames
      .sort((a: FrameType, b: FrameType) => a.timestamp - b.timestamp)
      .map((f: FrameType) => `[${f.timestamp}s] ${f.description}`)
      .join("\n");

    // Call Claude to generate summary
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Based on these video frame descriptions, write a concise summary (2-3 sentences) of what happens in this video:

${frameDescriptions}

Summary:`,
        },
      ],
    });

    const textContent = response.content.find(
      (c: Anthropic.ContentBlock) => c.type === "text"
    );
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude");
    }

    const summary: string = textContent.text.trim();

    // Store summary
    await ctx.runMutation(api.videos.storeSummary, {
      videoId: args.videoId,
      summary,
    });

    return {
      success: true,
      summary,
    };
  },
});
