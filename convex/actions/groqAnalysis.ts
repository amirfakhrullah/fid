"use node";
/**
 * Groq Analysis Action
 *
 * Uses Groq's Llama models to analyze video transcripts
 * and generate summaries, keywords, and categories.
 *
 * Required env var: GROQ_API_KEY
 */

import Groq from "groq-sdk";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";

// Initialize Groq client
const getGroqClient = () => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is required");
  }
  return new Groq({ apiKey });
};

const ANALYSIS_SYSTEM_PROMPT = `You are an expert at analyzing video transcripts for a video search system.
Extract comprehensive, searchable information from the transcript.

Provide:
1. A detailed summary (2-4 sentences) of what happens in the video
2. Key topics and themes discussed
3. A comprehensive list of searchable keywords covering:
   - Main topics and subjects
   - People, names, organizations mentioned
   - Technical terms or jargon
   - Actions and activities described
   - Locations mentioned
   - Important concepts

Be thorough - this information will power video search and discovery.`;

/**
 * Analyze video transcript with Groq Llama
 */
export const analyzeTranscript = action({
  args: {
    videoId: v.id("videos"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    summary: string;
    keywords: string[];
    categories: string[];
  }> => {
    // Get video with transcript
    const video = await ctx.runQuery(api.videos.getVideo, {
      videoId: args.videoId,
    });

    if (!video) {
      throw new Error(`Video ${args.videoId} not found`);
    }

    if (!video.transcript) {
      throw new Error(
        `Video ${args.videoId} has no transcript. Run transcription first.`
      );
    }

    console.log(`[Groq Analysis] Analyzing transcript for video...`);

    const groq = getGroqClient();

    // Call Groq Llama to analyze transcript
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile", // Fast, high-quality model
      messages: [
        {
          role: "system",
          content: ANALYSIS_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Analyze this video transcript and provide a comprehensive breakdown.

Transcript:
${video.transcript}

Respond in this exact JSON format:
{
  "summary": "Detailed 2-4 sentence summary of the video content",
  "keywords": ["keyword1", "keyword2", "keyword3", ...],
  "categories": ["category1", "category2"]
}

Categories should be broad content types like: "tutorial", "interview", "review", "vlog", "educational", "entertainment", "news", etc.`,
        },
      ],
      temperature: 0.3, // Lower temperature for more consistent JSON
      max_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from Groq");
    }

    // Parse JSON response
    let jsonStr = content;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const analysis = JSON.parse(jsonStr.trim()) as {
      summary: string;
      keywords: string[];
      categories: string[];
    };

    // Store analysis
    await ctx.runMutation(api.videos.storeGroqAnalysis, {
      videoId: args.videoId,
      summary: analysis.summary,
      keywords: analysis.keywords,
      categories: analysis.categories,
    });

    console.log(`[Groq Analysis] Analysis complete`);

    return {
      success: true,
      ...analysis,
    };
  },
});
