import { describe, it, expect, vi, afterEach } from "vitest";
import {
  TTS_ACCENTS,
  TTS_GENDERS,
  TTS_SPEEDS,
  resolveRandomOptions,
  getVoiceAndRate,
} from "../ttsVoiceResolver";

describe("ttsVoiceResolver", () => {
  describe("constants", () => {
    it("TTS_ACCENTS includes Random as first option", () => {
      expect(TTS_ACCENTS[0]).toBe("Random");
      expect(TTS_ACCENTS.length).toBeGreaterThan(1);
    });

    it("TTS_GENDERS includes Random as first option", () => {
      expect(TTS_GENDERS[0]).toBe("Random");
      expect(TTS_GENDERS.length).toBeGreaterThan(1);
    });

    it("TTS_SPEEDS has expected values", () => {
      expect(TTS_SPEEDS).toContain("Normal x1");
    });
  });

  describe("resolveRandomOptions", () => {
    it("passes through non-Random accent and gender", () => {
      const result = resolveRandomOptions("American English", "Male");
      expect(result.resolvedAccent).toBe("American English");
      expect(result.resolvedGender).toBe("Male");
    });

    it("resolves Random accent to a valid concrete accent", () => {
      const validAccents = TTS_ACCENTS.filter((a) => a !== "Random");
      for (let i = 0; i < 20; i++) {
        const { resolvedAccent } = resolveRandomOptions("Random", "Male");
        expect(validAccents).toContain(resolvedAccent);
      }
    });

    it("resolves Random gender to Male or Female", () => {
      const validGenders = ["Male", "Female"];
      for (let i = 0; i < 20; i++) {
        const { resolvedGender } = resolveRandomOptions(
          "American English",
          "Random",
        );
        expect(validGenders).toContain(resolvedGender);
      }
    });

    it("resolves both Random accent and gender", () => {
      const validAccents = TTS_ACCENTS.filter((a) => a !== "Random");
      const validGenders = ["Male", "Female"];
      for (let i = 0; i < 20; i++) {
        const { resolvedAccent, resolvedGender } = resolveRandomOptions(
          "Random",
          "Random",
        );
        expect(validAccents).toContain(resolvedAccent);
        expect(validGenders).toContain(resolvedGender);
      }
    });
  });

  describe("getVoiceAndRate", () => {
    it("returns correct voice for American English Male", () => {
      const { voice, rate } = getVoiceAndRate(
        "American English",
        "Male",
        "Normal x1",
      );
      expect(voice).toBe("en-US-ChristopherNeural");
      expect(rate).toBe("+0%");
    });

    it("returns correct voice for American English Female", () => {
      const { voice } = getVoiceAndRate(
        "American English",
        "Female",
        "Normal x1",
      );
      expect(voice).toBe("en-US-JennyNeural");
    });

    it("returns correct voice for British English", () => {
      expect(
        getVoiceAndRate("British English", "Male", "Normal x1").voice,
      ).toBe("en-GB-RyanNeural");
      expect(
        getVoiceAndRate("British English", "Female", "Normal x1").voice,
      ).toBe("en-GB-SoniaNeural");
    });

    it("returns correct voice for Indian English", () => {
      expect(getVoiceAndRate("Indian English", "Male", "Normal x1").voice).toBe(
        "en-IN-PrabhatNeural",
      );
      expect(
        getVoiceAndRate("Indian English", "Female", "Normal x1").voice,
      ).toBe("en-IN-NeerjaNeural");
    });

    it("returns correct voice for Australian English", () => {
      expect(
        getVoiceAndRate("Australian English", "Male", "Normal x1").voice,
      ).toBe("en-AU-WilliamNeural");
      expect(
        getVoiceAndRate("Australian English", "Female", "Normal x1").voice,
      ).toBe("en-AU-NatashaNeural");
    });

    it("falls back to en-US-JennyNeural for unknown accent", () => {
      const { voice } = getVoiceAndRate("Unknown Accent", "Male", "Normal x1");
      expect(voice).toBe("en-US-JennyNeural");
    });

    it("falls back to en-US-JennyNeural for unknown gender", () => {
      const { voice } = getVoiceAndRate(
        "American English",
        "Unknown",
        "Normal x1",
      );
      expect(voice).toBe("en-US-JennyNeural");
    });

    it("returns correct rate for each speed option", () => {
      expect(
        getVoiceAndRate("American English", "Female", "Slow x0.75").rate,
      ).toBe("-25%");
      expect(
        getVoiceAndRate("American English", "Female", "Normal x1").rate,
      ).toBe("+0%");
      expect(
        getVoiceAndRate("American English", "Female", "Fast x1.5").rate,
      ).toBe("+50%");
    });

    it("falls back to +0% for unknown speed", () => {
      const { rate } = getVoiceAndRate("American English", "Female", "Unknown");
      expect(rate).toBe("+0%");
    });

    it("resolves Random to a valid voice on each call", () => {
      const voices = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const { voice } = getVoiceAndRate("Random", "Random", "Normal x1");
        voices.add(voice);
        expect(voice).toMatch(/Neural$/);
      }
      // With 50 iterations, we should see more than 1 unique voice
      expect(voices.size).toBeGreaterThan(1);
    });

    describe("deterministic Random resolution (spied Math.random)", () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it("picks first accent and Male when Math.random returns 0", () => {
        vi.spyOn(Math, "random").mockReturnValue(0);
        const { voice } = getVoiceAndRate("Random", "Random", "Normal x1");
        // ACCENT_CHOICES[0] = "American English", GENDER_CHOICES[0] = "Male"
        expect(voice).toBe("en-US-ChristopherNeural");
      });

      it("picks last accent and Female when Math.random returns 0.9999", () => {
        vi.spyOn(Math, "random").mockReturnValue(0.9999);
        const { voice } = getVoiceAndRate("Random", "Random", "Normal x1");
        // ACCENT_CHOICES[3] = "Australian English", GENDER_CHOICES[1] = "Female"
        expect(voice).toBe("en-AU-NatashaNeural");
      });
    });
  });
});
