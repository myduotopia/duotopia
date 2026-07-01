import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardContent } from "../CardContent";

describe("CardContent — word variant", () => {
  it("renders ipa, word, part of speech and translation", () => {
    render(
      <CardContent
        variant="word"
        text="beautiful"
        ipa="/ˈbjuː.tɪ.fəl/"
        partOfSpeech="adj."
        translation="美麗的"
        showImage={false}
      />,
    );
    expect(screen.getByText("beautiful")).toBeInTheDocument();
    expect(screen.getByTestId("card-ipa").textContent).toBe("/ˈbjuː.tɪ.fəl/");
    expect(screen.getByTestId("card-pos").textContent).toBe("adj.");
    expect(screen.getByTestId("card-translation").textContent).toBe("美麗的");
  });

  it("hides translation when showTranslation is false", () => {
    render(
      <CardContent
        variant="word"
        text="beautiful"
        translation="美麗的"
        showTranslation={false}
        showImage={false}
      />,
    );
    expect(screen.queryByTestId("card-translation")).toBeNull();
  });

  it("uses no-image centered layout when no image", () => {
    render(<CardContent variant="word" text="cat" showImage={false} />);
    expect(
      screen.getByTestId("card-content").getAttribute("data-has-image"),
    ).toBe("false");
    expect(screen.queryByTestId("card-image")).toBeNull();
  });

  it("renders the image when provided", () => {
    render(
      <CardContent
        variant="word"
        text="cat"
        imageUrl="https://example.com/cat.jpg"
      />,
    );
    expect(
      screen.getByTestId("card-content").getAttribute("data-has-image"),
    ).toBe("true");
    expect(screen.getByTestId("card-image")).toHaveAttribute(
      "src",
      "https://example.com/cat.jpg",
    );
  });
});

describe("CardContent — sentence variant", () => {
  it("renders the sentence and translation, no ipa/pos", () => {
    render(
      <CardContent
        variant="sentence"
        text="The sunflowers are beautiful"
        ipa="ignored"
        partOfSpeech="ignored"
        translation="向日葵很美麗"
        showImage={false}
      />,
    );
    expect(
      screen.getByText("The sunflowers are beautiful"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-translation").textContent).toBe(
      "向日葵很美麗",
    );
    expect(screen.queryByTestId("card-ipa")).toBeNull();
    expect(screen.queryByTestId("card-pos")).toBeNull();
  });
});

describe("CardContent — score integration slots", () => {
  it("dims the translation during assessment", () => {
    render(
      <CardContent
        variant="sentence"
        text="hi"
        translation="嗨"
        translationDimmed
        showImage={false}
      />,
    );
    expect(
      screen.getByTestId("card-translation").getAttribute("data-dimmed"),
    ).toBe("true");
  });

  it("renders textSlot override instead of raw text", () => {
    render(
      <CardContent
        variant="sentence"
        text="raw"
        textSlot={<span data-testid="colored">COLORED</span>}
        showImage={false}
      />,
    );
    expect(screen.getByTestId("colored")).toBeInTheDocument();
    expect(screen.queryByText("raw")).toBeNull();
  });

  it("renders the score badge slot", () => {
    render(
      <CardContent
        variant="word"
        text="cat"
        showImage={false}
        scoreBadge={<div data-testid="badge">87</div>}
      />,
    );
    expect(screen.getByTestId("badge")).toBeInTheDocument();
  });
});
