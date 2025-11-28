"use node";
/**
 * Claude Vision Action
 *
 * Analyzes videos using Claude's vision capabilities.
 * Extracts descriptions, key moments, and searchable content.
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

// System prompt for video analysis
const VIDEO_ANALYSIS_PROMPT = `You are an expert at analyzing videos for a video search system.
Your job is to extract comprehensive, searchable information from the entire video.

Provide:
1. A detailed summary (2-4 sentences) of what happens in the video
2. Key moments or scenes with approximate timestamps
3. A comprehensive list of searchable keywords covering:
   - People, objects, items visible
   - Colors, visual attributes
   - Actions and activities
   - Settings and locations
   - Any text or speech content
   - Emotions and tone
   - Technical aspects (camera angles, transitions, etc.)

Be thorough - this information will power video search and discovery.`;

/**
 * Analyze video by sampling key frames with Claude Vision
 * Samples 1 frame every 10 seconds of video
 * Much more cost-efficient than analyzing every frame
 */
export const analyzeVideoSampled = action({
  args: {
    videoId: v.id("videos"),
    intervalSeconds: v.optional(v.number()), // Sample interval (default 10s)
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    framesAnalyzed: number;
    summary: string;
    keywords: string[];
    categories: string[];
    keyMoments: Array<{ timestamp: number; description: string }>;
  }> => {
    const intervalSeconds = args.intervalSeconds || 10; // 1 frame per 10 seconds

    // Get video to check duration
    const video = await ctx.runQuery(api.videos.getVideo, {
      videoId: args.videoId,
    });

    if (!video) {
      throw new Error("Video not found");
    }

    // Get all frames for this video
    const allFrames = await ctx.runQuery(api.frames.getFramesByVideo, {
      videoId: args.videoId,
    });

    if (allFrames.length === 0) {
      throw new Error("No frames available for analysis");
    }

    // Sample frames at regular time intervals (e.g., every 10 seconds)
    const sampledFrames: typeof allFrames = [];
    const duration = video.duration || allFrames[allFrames.length - 1].timestamp;

    for (
      let targetTime = 0;
      targetTime <= duration;
      targetTime += intervalSeconds
    ) {
      // Find frame closest to target timestamp
      const closestFrame = allFrames.reduce((prev, curr) =>
        Math.abs(curr.timestamp - targetTime) <
        Math.abs(prev.timestamp - targetTime)
          ? curr
          : prev
      );

      // Avoid duplicates
      if (!sampledFrames.find((f) => f._id === closestFrame._id)) {
        sampledFrames.push(closestFrame);
      }
    }

    console.log(
      `[Claude Vision] Analyzing ${sampledFrames.length} frames (1 per ${intervalSeconds}s) from ${Math.round(duration)}s video`
    );

    // Analyze each sampled frame with Claude Vision
    const frameAnalyses: Array<{ timestamp: number; description: string }> = [];

    for (const frame of sampledFrames) {
      if (!frame.url) continue;

      const imageResponse = await fetch(frame.url);
      const imageBuffer = await imageResponse.arrayBuffer();
      const base64Image = Buffer.from(imageBuffer).toString("base64");
      const mediaType = frame.url.includes(".png") ? "image/png" : "image/jpeg";

      const anthropic = getAnthropicClient();
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
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
                text: `Describe this video frame at ${frame.timestamp}s in 1-2 sentences. Focus on key visual elements, actions, and context.`,
              },
            ],
          },
        ],
      });

      const textContent = response.content.find((c) => c.type === "text");
      if (textContent && textContent.type === "text") {
        frameAnalyses.push({
          timestamp: frame.timestamp,
          description: textContent.text.trim(),
        });
      }
    }

    // Generate overall video summary from sampled frames
    const frameDescriptions = frameAnalyses
      .map((f) => `[${f.timestamp}s] ${f.description}`)
      .join("\n");

    const anthropic = getAnthropicClient();
    const summaryResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: VIDEO_ANALYSIS_PROMPT,
      messages: [
        {
          role: "user",
          content: `Based on these key moments from a video, provide a comprehensive analysis.

Key moments:
${frameDescriptions}

Respond in this exact JSON format:
{
  "summary": "Detailed 2-4 sentence summary of the video",
  "keywords": ["keyword1", "keyword2", "keyword3", ...],
  "categories": ["category1", "category2"]
}`,
        },
      ],
    });

    const summaryText = summaryResponse.content.find((c) => c.type === "text");
    if (!summaryText || summaryText.type !== "text") {
      throw new Error("No summary response from Claude");
    }

    // Parse JSON response
    let jsonStr = summaryText.text;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const analysis = JSON.parse(jsonStr.trim()) as {
      summary: string;
      keywords: string[];
      categories: string[];
    };

    // Store the analysis
    await ctx.runMutation(api.videos.storeVideoAnalysis, {
      videoId: args.videoId,
      summary: analysis.summary,
      keyMoments: frameAnalyses,
      keywords: analysis.keywords,
      categories: analysis.categories,
    });

    console.log(`[Claude Vision] Video analysis complete`);

    return {
      success: true,
      framesAnalyzed: sampledFrames.length,
      ...analysis,
      keyMoments: frameAnalyses,
    };
  },
});
