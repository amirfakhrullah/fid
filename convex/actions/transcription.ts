"use node";
/**
 * Transcription Action
 *
 * Transcribes video audio using Groq's Whisper API (ultra-fast).
 *
 * Required env var: GROQ_API_KEY
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";

// Groq API configuration
const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-large-v3-turbo"; // Fast and accurate

interface GroqTranscriptionResponse {
  text: string;
  duration?: number;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

/**
 * Transcribe video audio using Groq Whisper
 */
export const transcribeVideo = action({
  args: {
    videoId: v.id("videos"),
  },
  handler: async (ctx, args) => {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      throw new Error("GROQ_API_KEY environment variable is required");
    }

    // Get video data
    const video = await ctx.runQuery(api.videos.getVideo, {
      videoId: args.videoId,
    });

    if (!video) {
      throw new Error(`Video ${args.videoId} not found`);
    }

    if (!video.url) {
      throw new Error(`Video ${args.videoId} has no URL`);
    }

    console.log(`[Transcription] Fetching video from ${video.url}`);

    // Fetch the video file
    const videoResponse = await fetch(video.url);
    const videoBlob = await videoResponse.blob();

    console.log(
      `[Transcription] Video size: ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`
    );

    // Create form data for Groq API
    const formData = new FormData();
    formData.append("file", videoBlob, video.filename);
    formData.append("model", WHISPER_MODEL);
    formData.append("response_format", "verbose_json"); // Get segments with timestamps
    formData.append("language", "en"); // Optional: specify language

    console.log(`[Transcription] Sending to Groq Whisper API...`);

    // Call Groq Whisper API
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as GroqTranscriptionResponse;

    console.log(`[Transcription] Received transcript: ${result.text.length} chars`);

    // Store transcript
    await ctx.runMutation(api.videos.storeTranscript, {
      videoId: args.videoId,
      transcript: result.text,
      duration: result.duration,
    });

    // Update processing step
    await ctx.runMutation(api.videos.updateProcessingStep, {
      videoId: args.videoId,
      step: "transcribed",
      value: true,
    });

    return {
      success: true,
      transcript: result.text,
      duration: result.duration,
      segmentCount: result.segments?.length ?? 0,
    };
  },
});

/**
 * Transcribe with detailed segments (for timestamp-level search)
 */
export const transcribeWithSegments = action({
  args: {
    videoId: v.id("videos"),
  },
  handler: async (ctx, args) => {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      throw new Error("GROQ_API_KEY environment variable is required");
    }

    // Get video data
    const video = await ctx.runQuery(api.videos.getVideo, {
      videoId: args.videoId,
    });

    if (!video || !video.url) {
      throw new Error(`Video ${args.videoId} not found or has no URL`);
    }

    // Fetch the video file
    const videoResponse = await fetch(video.url);
    const videoBlob = await videoResponse.blob();

    // Create form data for Groq API
    const formData = new FormData();
    formData.append("file", videoBlob, video.filename);
    formData.append("model", WHISPER_MODEL);
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "segment");

    // Call Groq Whisper API
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as GroqTranscriptionResponse;

    // Store full transcript
    await ctx.runMutation(api.videos.storeTranscript, {
      videoId: args.videoId,
      transcript: result.text,
      duration: result.duration,
    });

    await ctx.runMutation(api.videos.updateProcessingStep, {
      videoId: args.videoId,
      step: "transcribed",
      value: true,
    });

    return {
      success: true,
      transcript: result.text,
      duration: result.duration,
      segments: result.segments ?? [],
    };
  },
});

/**
 * Test transcription with a simple message (for debugging)
 */
export const testGroqConnection = action({
  args: {},
  handler: async () => {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      return {
        success: false,
        error: "GROQ_API_KEY not set",
      };
    }

    // Test with Groq's models endpoint
    const response = await fetch("https://api.groq.com/openai/v1/models", {
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `API error: ${response.status}`,
      };
    }

    const models = await response.json();
    const whisperModels = models.data?.filter((m: { id: string }) =>
      m.id.includes("whisper")
    );

    return {
      success: true,
      message: "Groq API connection successful",
      availableWhisperModels: whisperModels?.map((m: { id: string }) => m.id) ?? [],
    };
  },
});
