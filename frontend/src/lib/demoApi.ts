/**
 * Demo API Client for public demo assignments
 * No authentication required - uses public demo endpoints
 */

import { API_URL } from "../config/api";
import { appendAudioToFormData } from "@/utils/audioFormatDetection";

export class DemoApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "DemoApiError";
  }
}

interface DemoConfig {
  demo_reading_assignment_id?: string;
  demo_rearrangement_assignment_id?: string;
  demo_vocabulary_assignment_id?: string;
  demo_word_selection_listening_assignment_id?: string;
  demo_word_selection_writing_assignment_id?: string;
}

interface AssessmentRequest {
  assignment_id: number;
  sentence_id: number;
  audio_blob: Blob;
  reference_text: string;
  locale?: string;
}

interface RearrangementSubmitRequest {
  question_id: number;
  user_answer: string[];
  time_spent: number;
}

interface WordSelectionSubmitRequest {
  activity_id: number;
  selected_option: string;
  time_spent: number;
}

/**
 * Demo API Client
 * All methods use public demo endpoints without authentication
 */
class DemoApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_URL;
  }

  /**
   * Get demo configuration (assignment IDs for each practice mode)
   */
  async getConfig(): Promise<DemoConfig> {
    const response = await fetch(`${this.baseUrl}/api/demo/config`);

    if (!response.ok) {
      throw new DemoApiError(
        response.status,
        "Failed to load demo configuration",
      );
    }

    return response.json();
  }

  /**
   * Get demo assignment preview data
   */
  async getPreview(assignmentId: number): Promise<unknown> {
    const response = await fetch(
      `${this.baseUrl}/api/demo/assignments/${assignmentId}/preview`,
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new DemoApiError(404, "Demo assignment not found");
      }
      throw new DemoApiError(response.status, "Failed to load demo assignment");
    }

    return response.json();
  }

  /**
   * Assess speech for demo mode (no authentication, no recording saved)
   */
  async assessSpeech(data: AssessmentRequest): Promise<unknown> {
    const formData = new FormData();
    formData.append("assignment_id", data.assignment_id.toString());
    formData.append("sentence_id", data.sentence_id.toString());
    await appendAudioToFormData(formData, "audio", data.audio_blob);
    formData.append("reference_text", data.reference_text);
    if (data.locale) {
      formData.append("locale", data.locale);
    }

    const response = await fetch(
      `${this.baseUrl}/api/demo/assignments/preview/assess-speech`,
      {
        method: "POST",
        body: formData,
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new DemoApiError(
        response.status,
        errorData.detail || "Speech assessment failed",
      );
    }

    return response.json();
  }

  /**
   * Get rearrangement questions for demo
   */
  async getRearrangementQuestions(assignmentId: number): Promise<unknown> {
    const response = await fetch(
      `${this.baseUrl}/api/demo/assignments/${assignmentId}/preview/rearrangement-questions`,
    );

    if (!response.ok) {
      throw new DemoApiError(
        response.status,
        "Failed to load rearrangement questions",
      );
    }

    return response.json();
  }

  /**
   * Submit rearrangement answer (demo mode - no progress saved)
   */
  async submitRearrangementAnswer(
    assignmentId: number,
    data: RearrangementSubmitRequest,
  ): Promise<unknown> {
    const response = await fetch(
      `${this.baseUrl}/api/demo/assignments/${assignmentId}/preview/rearrangement-answer`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new DemoApiError(
        response.status,
        errorData.detail || "Failed to submit answer",
      );
    }

    return response.json();
  }

  /**
   * Retry rearrangement question (demo mode)
   */
  async retryRearrangement(assignmentId: number): Promise<unknown> {
    const response = await fetch(
      `${this.baseUrl}/api/demo/assignments/${assignmentId}/preview/rearrangement-retry`,
      {
        method: "POST",
      },
    );

    if (!response.ok) {
      throw new DemoApiError(response.status, "Failed to retry");
    }

    return response.json();
  }

  /**
   * Complete rearrangement practice (demo mode)
   */
  async completeRearrangement(assignmentId: number): Promise<unknown> {
    const response = await fetch(
      `${this.baseUrl}/api/demo/assignments/${assignmentId}/preview/rearrangement-complete`,
      {
        method: "POST",
      },
    );

    if (!response.ok) {
      throw new DemoApiError(response.status, "Failed to complete practice");
    }

    return response.json();
  }

  /**
   * Get vocabulary activities for demo
   */
  async getVocabularyActivities(assignmentId: number): Promise<unknown> {
    const response = await fetch(
      `${this.baseUrl}/api/demo/assignments/${assignmentId}/preview/vocabulary/activities`,
    );

    if (!response.ok) {
      throw new DemoApiError(
        response.status,
        "Failed to load vocabulary activities",
      );
    }

    return response.json();
  }

  /**
   * Start word selection practice (demo mode)
   */
  async startWordSelection(assignmentId: number): Promise<unknown> {
    const response = await fetch(
      `${this.baseUrl}/api/demo/assignments/${assignmentId}/preview/word-selection-start`,
    );

    if (!response.ok) {
      throw new DemoApiError(response.status, "Failed to start word selection");
    }

    return response.json();
  }

  /**
   * Submit word selection answer (demo mode - no progress saved)
   */
  async submitWordSelectionAnswer(
    assignmentId: number,
    data: WordSelectionSubmitRequest,
  ): Promise<unknown> {
    const response = await fetch(
      `${this.baseUrl}/api/demo/assignments/${assignmentId}/preview/word-selection-answer`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new DemoApiError(
        response.status,
        errorData.detail || "Failed to submit answer",
      );
    }

    return response.json();
  }
}

// Export singleton instance
export const demoApi = new DemoApiClient();
