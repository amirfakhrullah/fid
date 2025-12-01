"use node";
/**
 * Transcription Action
 *
 * Transcribes video audio using Groq's Whisper API (ultra-fast).
 * Extracts audio from video first to stay under 25MB limit.
 *
 * Required env var: GROQ_API_KEY
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

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

    console.log(`[Transcription] Downloading video: ${video.url}`);

    // Download video
    const videoResponse = await fetch(video.url);
    const videoBuffer = await videoResponse.arrayBuffer();
    const videoSizeMB = videoBuffer.byteLength / 1024 / 1024;

    console.log(`[Transcription] Video size: ${videoSizeMB.toFixed(2)}MB`);

    // Extract audio using FFmpeg (much smaller than video)
    const inputPath = join(tmpdir(), `video-${args.videoId}.mp4`);
    const outputPath = join(tmpdir(), `audio-${args.videoId}.mp3`);

    try {
      // Write video to temp file
      await writeFile(inputPath, Buffer.from(videoBuffer));

      console.log(`[Transcription] Extracting audio with FFmpeg...`);

      // Extract audio as MP3 (compressed)
      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioCodec("libmp3lame")
          .audioBitrate("128k") // Compressed audio
          .toFormat("mp3")
          .on("end", () => resolve())
          .on("error", (err) => reject(err))
          .save(outputPath);
      });

      // Read extracted audio
      const { readFile } = await import("fs/promises");
      const audioBuffer = await readFile(outputPath);
      const audioSizeMB = audioBuffer.byteLength / 1024 / 1024;

      console.log(
        `[Transcription] Audio extracted: ${audioSizeMB.toFixed(2)}MB (${((audioSizeMB / videoSizeMB) * 100).toFixed(1)}% of video size)`
      );

      // Check if audio is under 25MB limit
      if (audioSizeMB > 25) {
        throw new Error(
          `Audio file too large: ${audioSizeMB.toFixed(2)}MB (limit: 25MB). Consider using a lower bitrate.`
        );
      }

      // Create form data with audio file
      const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });
      const formData = new FormData();
      formData.append("file", audioBlob, `${video.filename}.mp3`);
      formData.append("model", WHISPER_MODEL);
      formData.append("response_format", "verbose_json");
      formData.append("language", "en");

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
    } finally {
      // Clean up temp files
      try {
        await unlink(inputPath);
        await unlink(outputPath);
      } catch (err) {
        console.warn(`[Transcription] Failed to clean up temp files:`, err);
      }
    }
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

    // Download video and extract audio (same as transcribeVideo)
    const videoResponse = await fetch(video.url);
    const videoBuffer = await videoResponse.arrayBuffer();

    const inputPath = join(tmpdir(), `video-seg-${args.videoId}.mp4`);
    const outputPath = join(tmpdir(), `audio-seg-${args.videoId}.mp3`);

    try {
      await writeFile(inputPath, Buffer.from(videoBuffer));

      // Extract audio as MP3
      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioCodec("libmp3lame")
          .audioBitrate("128k")
          .toFormat("mp3")
          .on("end", () => resolve())
          .on("error", (err) => reject(err))
          .save(outputPath);
      });

      const { readFile } = await import("fs/promises");
      const audioBuffer = await readFile(outputPath);

      const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });
      const formData = new FormData();
      formData.append("file", audioBlob, `${video.filename}.mp3`);
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
    } finally {
      // Clean up temp files
      try {
        await unlink(inputPath);
        await unlink(outputPath);
      } catch (err) {
        console.warn(`[Transcription] Failed to clean up temp files:`, err);
      }
    }
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
